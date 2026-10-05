import { composeReply, currentBurst, mergeBrief, runIntakeAgent, unprocessedClientMessages } from '@/lib/agents/intake-agent';
import { runPatternAgent, templatePattern } from '@/lib/agents/pattern-agent';
import { assembleQuote } from '@/lib/agents/pricing';
import { executeGenerateMockupTool, type MockupToolArgs } from '@/lib/agents/tools';
import { isGenericMaterial, resolveGenericMaterial } from '@/lib/agents/inventory-agent';
import { getStore } from '@/lib/gcp/firestore';
import { currentAngles, renderRemainingAnglesInBackground, reusableRender } from '@/lib/mockups';
import { confirmationMockupAngles, defaultMockupAngles, MOCKUP_ANGLES } from '@/lib/spec/angles';
import {
  constructionDef,
  mergeCustomFields,
  emptySpecifications,
  finalizeSpecifications,
  isClassified,
  isTopicFilled,
  MAX_QUESTIONS_PER_TURN,
  normalizeSpecifications,
  planConversation,
  schemaOf,
  topicKey,
  topicsFor,
} from '@/lib/spec/catalog';
import { findGlossary } from '@/lib/spec/glossary';
import {
  LOOP_STRIKE_LIMIT,
  hasDesignContext,
  loopHandoverMessage,
  renderTemplate,
  mismatchMessage,
  refusalMessage,
  SESSION_TURN_CAP,
  SESSION_TURN_WARNING,
  sessionCapMessage,
  SILENT_PARSE_CAP,
  turnWarningMessage,
  VISUAL_REQUEST,
  CHANGE_REQUEST,
} from '@/lib/spec/guardrails';
import { isWithinScope, requestedItemLabel } from '@/lib/spec/offerings';
import { specCardText } from '@/lib/spec/describe';
import type { CategoryPreset, ChatMessage, ClientBrief, Dimensions, IntakeProgress, InventoryItem, OrchestratorResult, OrderPayload, Specifications } from '@/lib/types';
import { shapeBubbles } from '@/lib/utils/bubbles';
import { nowIso } from '@/lib/utils/format';
import {
  expirePartialPause,
  HANDOFF_MESSAGES,
  isAiBlocked,
  isFrustrated,
  setAutomationMode,
} from '@/lib/utils/takeover';
import { notifyCrafter, sendToClient } from '@/lib/whatsapp';

/**
 * Multi-agent execution engine:
 *   Intake (Flash vision + structured output) → planner → ask the next question(s)      ... until every required parameter
 *   is collected and each optional detail (embossing, thread, lining, ...) has been offered once, then
 *   [Pattern/BOM (Pro) ∥ Visual mockup] → Inventory match → Quote → PENDING_CRAFTER_APPROVAL
 *
 * Takeover is checked before the run and again before anything is sent, because
 * the crafter may take over while Gemini is still thinking. `force` lets the
 * crafter recompute spec/BOM/mockup during a takeover; the client still gets
 * no AI message while the takeover is active.
 */

type OrchestratorFields = Pick<
  OrderPayload,
  'craft_category' | 'specifications' | 'session_state' | 'material_sourcing' | 'pattern_and_bom' | 'media_assets' | 'intake' | 'client_brief'
>;

/**
 * Serialize runs per order; a request that arrives mid-run triggers exactly one rerun.
 * Kept on globalThis because each route handler may get its own module instance.
 */
const globalForRuns = globalThis as unknown as {
  __craftmindRuns?: Map<string, { promise: Promise<OrchestratorResult>; rerun: boolean }>;
};
const inflight = (globalForRuns.__craftmindRuns ??= new Map());

export function isOrchestratorRunning(orderId: string): boolean {
  return inflight.has(orderId);
}

/**
 * Silent background parse while a human has taken over (FULL_MANUAL / PARTIAL_PAUSE): re-reads the whole chat, client and
 * crafter messages, and keeps the specification and client brief current for the dashboard. Never replies, never locks
 * the spec card, never changes the takeover state.
 */
export async function runSilentParse(orderId: string): Promise<void> {
  if (inflight.has(orderId)) return;
  const store = getStore();
  const order = await store.getOrder(orderId);
  if (!order || order.session_state === 'APPROVED') return;
  const messages = await store.listMessages(orderId);
  const stored: IntakeProgress = order.intake ?? { asked_topics: [], last_asked: [], deferred_topics: [], question_rounds: 0 };
  // cost guardrail: background parses are Gemini calls too
  if ((stored.silent_parse_count ?? 0) >= SILENT_PARSE_CAP) return;
  // the AI asked nothing during the takeover, so short answers are not read against stale questions
  const profile = await store.getCrafterProfile(order.crafter_id);
  const intake = await runIntakeAgent({ messages, known: normalizeSpecifications(order.specifications), progress: { ...stored, last_asked: [] }, profile });
  // never let an injection attempt or an off-topic message rewrite the order, even silently
  if (intake.message_intent !== 'CRAFT_REQUEST') return;
  await commit(orderId, {
    craft_category: intake.specifications.category,
    specifications: intake.specifications,
    client_brief: mergeBrief(order.client_brief, intake.brief),
    intake: {
      ...stored,
      vision_notes: intake.vision_notes ?? stored.vision_notes,
      processed_message_id: newestClientId(messages) ?? stored.processed_message_id,
      silent_parse_count: (stored.silent_parse_count ?? 0) + 1,
    },
  });
}

/**
 * A newer client message arrived before the reply went out. The run is dropped (nothing is sent, its state changes are
 * rolled back) and the next debounce flush answers all the buffered messages together in ONE reply.
 */
class SupersededError extends Error {
  constructor(readonly result: OrchestratorResult) {
    super('superseded by a newer client message');
  }
}

function newestClientId(messages: ChatMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i].sender === 'CLIENT') return messages[i].id;
  return undefined;
}

async function runPipeline(orderId: string, opts: { force?: boolean }): Promise<OrchestratorResult> {
  try {
    return await executePipeline(orderId, opts);
  } catch (err) {
    if (!(err instanceof SupersededError)) throw err;
    console.info(`[orchestrator] ${orderId}: reply dropped, a newer client message arrived; the next flush answers them together`);
    return err.result;
  }
}

/**
 * One pipeline per order at a time (no overlapping LLM runs for a session). A flush that arrives mid-run marks the
 * entry for exactly one rerun, which picks up every message buffered in the meantime.
 */
export function runOrchestrator(orderId: string, opts: { force?: boolean } = {}): Promise<OrchestratorResult> {
  const current = inflight.get(orderId);
  if (current) {
    current.rerun = true;
    return current.promise;
  }
  const entry = { rerun: false } as { promise: Promise<OrchestratorResult>; rerun: boolean };
  entry.promise = (async () => {
    try {
      let result = await runPipeline(orderId, opts);
      while (entry.rerun) {
        entry.rerun = false;
        result = await runPipeline(orderId, opts);
      }
      return result;
    } finally {
      inflight.delete(orderId);
    }
  })();
  inflight.set(orderId, entry);
  return entry.promise;
}

/** Re-read the order and apply only the fields the orchestrator owns, preserving takeover state. */
async function commit(orderId: string, patch: Partial<OrchestratorFields>): Promise<OrderPayload> {
  const store = getStore();
  const latest = await store.getOrder(orderId);
  if (!latest) throw new Error(`Order ${orderId} disappeared mid-run`);
  const updated = { ...latest, ...patch };
  await store.saveOrder(updated);
  return updated;
}

/** Strap-like goods are measured length x width x thickness; thickness defaults to 0.3 cm. */
const FLAT_GOODS = new Set(['BELT', 'WATCH_STRAP']);

/**
 * Make a spec computable without asking the client for technical details:
 *  - dimensions: when at least one axis is known, missing axes take the form factor's typical value (e.g. a belt's
 *    0.3 cm thickness); for straps "110 x 4" means length x width, not length x height;
 *  - material: a generic "kulit" / "cokelat tua" / "kayu" becomes the closest stocked item (colour respected, else the
 *    category's house material), so stock matching and price work.
 */
function completeForBom(raw: Specifications, inventory: InventoryItem[], preset: CategoryPreset): Specifications {
  const spec = normalizeSpecifications(structuredClone(raw));
  const a = spec.attributes as unknown as Record<string, unknown>;
  const def = (constructionDef(spec.construction_type)?.defaults ?? {}) as { dimensions_cm?: Dimensions };
  // A long bifold always carries its tall size, so the spec form, the BOM and the mockup never fall back to a short
  // bifold: no size yet, or a short-wallet size the client never typed in cm → the long wallet standard (9.5 x 2 x 19).
  if (spec.construction_type === 'LONG_BIFOLD_WALLET' && def.dimensions_cm && spec.dimension_mode !== 'EXACT_CM') {
    const size = a.dimensions_cm as Dimensions | undefined;
    if (!size || Math.max(size.length, size.height) < 15) {
      a.dimensions_cm = { ...def.dimensions_cm };
      spec.dimension_mode = 'REFERENCE_BASED';
      spec.reference_object = 'ukuran standar dompet panjang (long bifold)';
    }
  }
  const d = a.dimensions_cm as Dimensions | undefined;
  if (d && def.dimensions_cm && (d.length > 0 || d.width > 0 || d.height > 0) && spec.dimension_mode !== 'PENDING_SITE_VISIT') {
    if (FLAT_GOODS.has(spec.construction_type) && d.width === 0 && d.height >= 1) {
      d.width = d.height;
      d.height = 0;
    }
    d.length ||= def.dimensions_cm.length;
    d.width ||= def.dimensions_cm.width;
    d.height ||= def.dimensions_cm.height;
  }

  const key = schemaOf(spec.category).material_field;
  const material = String(a[key] ?? '');
  const leatherish = spec.category !== 'FURNITURE' && (spec.category !== 'CUSTOM_GENERIC' || /kulit|leather/i.test(material));
  const woodish = spec.category === 'FURNITURE' || /kayu|wood/i.test(material);
  if (material && isGenericMaterial(material) && (leatherish || woodish)) {
    const color = String(a.color ?? a.color_stain ?? '');
    const item = resolveGenericMaterial(material, color, inventory, preset, woodish ? 'wood_metal' : 'leather');
    if (item) a[key] = item.name;
  }
  return spec;
}

function hasSizeAndMaterial(spec: Specifications): boolean {
  const a = spec.attributes as unknown as Record<string, unknown>;
  const material = String(a[schemaOf(spec.category).material_field] ?? '').trim();
  if (!material) return false;
  if (spec.category === 'FOOTWEAR') return Number(a.eu_size) > 0;
  const d = a.dimensions_cm as Dimensions | undefined;
  return !!d && d.length > 0 && d.width > 0 && d.height > 0;
}

/** Deterministic pattern + stock + price for the dashboard while gathering (the locked spec gets the full pass). */
function quickQuote(spec: Specifications, inventory: InventoryItem[], preset: CategoryPreset): Partial<OrchestratorFields> {
  const full = finalizeSpecifications(spec, preset.defaults);
  const quote = assembleQuote(templatePattern(full, preset), full, inventory, preset);
  return { material_sourcing: quote.material_sourcing, pattern_and_bom: quote.pattern_and_bom };
}

/** Patch the stored intake progress (cost counters) without touching anything else on the order. */
async function updateIntake(orderId: string, patch: Partial<IntakeProgress>): Promise<void> {
  const store = getStore();
  const latest = await store.getOrder(orderId);
  if (!latest) return;
  const intake: IntakeProgress = { asked_topics: [], last_asked: [], deferred_topics: [], question_rounds: 0, ...latest.intake, ...patch };
  await store.saveOrder({ ...latest, intake });
}

/**
 * Did this turn add a product detail? New or changed spec values (material, size, colours, counts, closures...), a new
 * form factor or category, a new custom request, or a new budget / deadline in the brief.
 */
function hasNewProductDetails(before: Specifications, after: Specifications, briefBefore?: ClientBrief, briefAfter?: ClientBrief): boolean {
  if (before.category !== after.category || before.construction_type !== after.construction_type) return true;
  if (before.dimension_mode !== after.dimension_mode || before.reference_object !== after.reference_object) return true;
  const a = before.attributes as unknown as Record<string, unknown>;
  const b = after.attributes as unknown as Record<string, unknown>;
  const norm = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : JSON.stringify(v));
  if (Object.keys(b).some((k) => norm(a[k]) !== norm(b[k]))) return true;
  const labels = new Set(before.custom_fields.map((f) => f.label.toLowerCase()));
  if (after.custom_fields.some((f) => !labels.has(f.label.toLowerCase()))) return true;
  return (['budget', 'target_deadline'] as const).some((k) => (briefAfter?.[k] ?? '').trim() && (briefAfter?.[k] ?? '') !== (briefBefore?.[k] ?? ''));
}

/** Sends the reply as 2-3 separate WhatsApp bubbles; stops if a takeover lands between bubbles. */
async function replyIfStillAllowed(orderId: string, text: string, sender: 'AI' | 'SYSTEM' = 'AI'): Promise<boolean> {
  const bubbles = shapeBubbles(text);
  if (!bubbles.length) return false;
  for (const bubble of bubbles) {
    const latest = await getStore().getOrder(orderId);
    if (!latest || isAiBlocked(latest)) return false;
    await sendToClient(latest, sender, bubble);
  }
  return true;
}

async function executePipeline(orderId: string, opts: { force?: boolean }): Promise<OrchestratorResult> {
  const store = getStore();
  const order = await store.getOrder(orderId);
  if (!order) throw new Error(`Order ${orderId} not found`);

  if (expirePartialPause(order)) await store.saveOrder(order);
  if (order.session_state === 'APPROVED' || (!opts.force && isAiBlocked(order))) {
    return { order, stage: 'SKIPPED_TAKEOVER' };
  }

  const [messages, conversation] = await Promise.all([
    store.listMessages(orderId),
    store.getConversation(order.client_info.phone_number),
  ]);
  const known = normalizeSpecifications(order.specifications);
  const stored: IntakeProgress = order.intake ?? { asked_topics: [], last_asked: [], deferred_topics: [], question_rounds: 0 };
  // This turn's input: every client message buffered since the last processed one, combined into one burst.
  const fresh = unprocessedClientMessages(messages, stored.processed_message_id);
  // Nothing new and the last message isn't an unanswered client message: the buffered messages were already answered
  // together by an earlier run, so a second reply would be a duplicate.
  if (!opts.force && !fresh.length && messages.at(-1)?.sender !== 'CLIENT') return { order, stage: 'NOTHING_NEW' };
  const burst = currentBurst(messages, stored.processed_message_id);
  const answeredUpTo = newestClientId(messages);
  const processed_message_id = answeredUpTo ?? stored.processed_message_id;
  const burstText = burst.map((m) => m.text ?? '').join('\n');
  const profile = await store.getCrafterProfile(order.crafter_id);

  // --- Cost guardrail 1: AI turn budget, checked BEFORE any Gemini call -------------------------------------
  const turn = (stored.session_turn_count ?? 0) + 1;
  if (turn >= SESSION_TURN_CAP) {
    const latest = await commit(orderId, { intake: { ...stored, processed_message_id, session_turn_count: turn } });
    const reply = sessionCapMessage(profile);
    if (!isAiBlocked(latest)) {
      setAutomationMode(latest, 'FULL_MANUAL', 'SESSION_LIMIT', undefined, undefined, `Batas ${SESSION_TURN_CAP} balasan AI untuk sesi ini tercapai; lanjutkan secara manual`);
      await store.saveOrder(latest);
      await Promise.all(burst.map((m) => store.updateMessage(orderId, m.id, { awaiting_crafter_review: true })));
      await sendToClient(latest, 'SYSTEM', reply);
      await notifyCrafter(latest, latest.escalation_note!);
    }
    return { order: latest, stage: 'ESCALATED', reply };
  }

  // A newer client message arrived mid-run? Then this reply is stale: drop it, restore what the run changed, and let the
  // next debounce flush answer the whole burst at once. Checked before the reply is composed and before it is sent.
  const strikesAtStart = conversation?.confusion_strikes ?? 0;
  // (a crafter-forced recompute is never dropped)
  const supersededByNewMessage = async () => !opts.force && newestClientId(await store.listMessages(orderId)) !== answeredUpTo;
  const dropRun = async (rollback = true): Promise<never> => {
    if (!rollback) throw new SupersededError({ order, stage: 'SUPERSEDED' });
    const { craft_category, specifications, session_state, material_sourcing, pattern_and_bom, intake, client_brief } = order;
    const restored = await commit(orderId, { craft_category, specifications, session_state, material_sourcing, pattern_and_bom, intake, client_brief });
    const conv = await store.getConversation(order.client_info.phone_number);
    if (conv && conv.confusion_strikes !== strikesAtStart) await store.saveConversation({ ...conv, confusion_strikes: strikesAtStart });
    throw new SupersededError({ order: restored, stage: 'SUPERSEDED' });
  };

  // --- Agent 1: vision + structured intake -----------------------------------
  const intake = await runIntakeAgent({ messages, known, progress: stored, profile });
  // nothing committed yet: skip composing the reply (saves the second Gemini call)
  if (await supersededByNewMessage()) await dropRun(false);
  const [inventory, presets] = await Promise.all([store.listInventory(), store.listPresets()]);
  const presetFor = (c: OrderPayload['craft_category']) => presets.find((p) => p.category === c)!;
  // Fill what the client never needs to say: missing axes (e.g. strap thickness) and the concrete stocked material
  // behind "kulit" / "cokelat tua". Pattern, BOM and price can then be computed straight away.
  const spec0 = completeForBom(intake.specifications, inventory, presetFor(intake.specifications.category));
  // Slot-filling check BEFORE planning: a topic the client already answered in everyday words ("saku celana belakang")
  // is settled. Deferrable topics then take the form factor's standard value; they are never asked again.
  const answeredDeferrable = intake.answered_topics.filter((key) => {
    const topic = topicsFor(spec0).find((t) => `${spec0.category}:${t.id}` === key);
    return topic?.deferrable && !isTopicFilled(spec0, topic);
  });
  const progress: IntakeProgress = {
    ...stored,
    deferred_topics: [...new Set([...stored.deferred_topics, ...intake.deferred_topics, ...answeredDeferrable])],
    // answered optional topics also count as asked, so the planner never brings them up later
    asked_topics: [...new Set([...stored.asked_topics, ...intake.answered_topics])],
  };
  // background brief: kept up to date on every turn, whatever the turn ends up doing
  const client_brief = mergeBrief(order.client_brief, intake.brief);
  // Once a spec card has been sent, later messages are corrections: re-quote instead of re-opening optional questions.
  const wasLocked = order.session_state === 'PENDING_CRAFTER_APPROVAL';
  const clientFinished = intake.client_finished || wasLocked;
  const plan = planConversation(spec0, progress, clientFinished);

  // --- Revision: the client asks to change a draft they have already seen ("ganti slot kartunya jadi miring") ---------
  // It is re-rendered right away. When the spec captured the change (a field or a custom request) the changed views
  // re-render from it; otherwise the client's own words become a custom request on the spec (kept for production and
  // every later render) and go to the image model as the adjustment for this one.
  const draftShown = messages.some((m) => m.sender === 'AI' && m.media_type === 'image');
  const revisionRequest = draftShown && isClassified(spec0) && intake.message_intent === 'CRAFT_REQUEST' && CHANGE_REQUEST.test(burstText);
  const visualChanged =
    revisionRequest &&
    defaultMockupAngles(spec0.category, spec0.construction_type).some(
      (a) => !reusableRender(order, a, finalizeSpecifications(spec0, presetFor(spec0.category).defaults)),
    );
  const revisionAdjustment = revisionRequest && !visualChanged ? burstText.replace(/\s+/g, ' ').trim() : undefined;
  if (revisionAdjustment && !spec0.custom_fields.some((f) => f.value.toLowerCase() === revisionAdjustment.toLowerCase())) {
    const n = spec0.custom_fields.filter((f) => f.label.startsWith('Revisi visual')).length + 1;
    spec0.custom_fields = mergeCustomFields(spec0.custom_fields, [{ label: `Revisi visual ${n}`, value: revisionAdjustment }]);
  }

  /**
   * Every AI reply goes through here: it is charged to the turn budget, and on the warning turn an intake that is still
   * incomplete gets the "let me connect you to the crafter" bubble (and the crafter is notified).
   */
  const say = async (text: string, intakeComplete = wasLocked): Promise<boolean> => {
    // single-response guarantee: once the first bubble is out the set is completed; until then a newer message wins
    if (await supersededByNewMessage()) await dropRun();
    const warn = turn === SESSION_TURN_WARNING && !intakeComplete;
    const sent = await replyIfStillAllowed(orderId, warn ? `${text}\n\n${turnWarningMessage(profile)}` : text);
    if (sent) {
      await updateIntake(orderId, { session_turn_count: turn });
      if (warn) {
        const current = await store.getOrder(orderId);
        if (current) await notifyCrafter(current, `Intake belum lengkap setelah ${turn} balasan AI; siap diambil alih`);
      }
    }
    return sent;
  };

  // --- Cost guardrail 3: loop / unproductive-chat detector ---------------------------------------------------
  // Evaluated once per DEBOUNCED turn on the combined burst, never per raw message: three quick messages are one turn.
  // A turn is productive when it carries design context or feedback (product / material / colour / feature words,
  // sizes, "salah", "revisi", "ganti ..."), adds or settles a spec detail, or asks a question we answer: the counter
  // (`confusion_strikes`) resets to 0 and the revision goes through. A strike is only an off-topic / nonsensical turn,
  // a turn with no spec context while gathering, or pure frustration with nothing about the design ("ga nyambung").
  // LOOP_STRIKE_LIMIT strikes in a row hand the chat to the crafter. After the spec card, small talk ("oke kak") is
  // neither. The turn budget bounds everything else.
  const blockingQuestions = intake.questions.filter((q) => q.kind !== 'PRICE_TIMELINE');
  const isCraft = intake.message_intent === 'CRAFT_REQUEST';
  const designContext = isCraft && hasDesignContext(burstText);
  // "terserah" (deferring topics), answering a topic in everyday words and "itu saja" all move the intake forward too
  const settledSomething = intake.deferred_topics.length > 0 || answeredDeferrable.length > 0 || intake.client_finished || revisionRequest;
  const productive =
    isCraft && (designContext || settledSomething || blockingQuestions.length > 0 || hasNewProductDetails(known, spec0, order.client_brief, client_brief));
  const frustratedOnly = isFrustrated(burstText) && !designContext;
  const strike = !isCraft || frustratedOnly || (!productive && !wasLocked);
  if (conversation) {
    conversation.confusion_strikes = strike ? conversation.confusion_strikes + 1 : productive ? 0 : conversation.confusion_strikes;
    conversation.updated_at = nowIso();
    await store.saveConversation(conversation);
  }
  if (conversation && conversation.confusion_strikes >= LOOP_STRIKE_LIMIT) {
    const latest = await commit(orderId, {
      ...(isCraft && { client_brief, craft_category: spec0.category, specifications: spec0 }),
      intake: { ...(isCraft ? progress : stored), vision_notes: intake.vision_notes, processed_message_id, session_turn_count: turn },
    });
    const reply = loopHandoverMessage(profile);
    if (!isAiBlocked(latest)) {
      setAutomationMode(latest, 'FULL_MANUAL', 'CONFUSION_RULE', undefined, undefined, `${conversation.confusion_strikes} giliran chat berturut-turut tanpa konteks desain (off-topic / tidak jelas)`);
      await store.saveOrder(latest);
      await Promise.all(burst.map((m) => store.updateMessage(orderId, m.id, { awaiting_crafter_review: true })));
      await sendToClient(latest, 'SYSTEM', reply);
      await notifyCrafter(latest, latest.escalation_note!);
    }
    conversation.confusion_strikes = 0;
    await store.saveConversation(conversation);
    return { order: latest, stage: 'ESCALATED', reply };
  }

  // --- recalculate_bom_and_price(): as soon as size (L x W x H / shoe size) and material are known -------------
  const autoBom = isClassified(spec0) && hasSizeAndMaterial(spec0) ? quickQuote(spec0, inventory, presetFor(spec0.category)) : {};

  // --- Cost guardrail 2: AI mockup renders per session (enforced inside generate_mockup_tool, MAX_AI_MOCKUP_RENDERS) ---
  const renderCount = stored.mockup_render_count ?? 0;
  const visualRequest = VISUAL_REQUEST.test(burstText);
  // generate_mockup_tool triggers: the client asks for a picture, or the core specification just became complete
  const coreComplete = isClassified(spec0) && plan.missing_required.length === 0;
  const firstCoreComplete = coreComplete && renderCount === 0 && !currentAngles(order).length;
  const mockupComing = revisionRequest ? 'REVISION' : visualRequest || firstCoreComplete ? 'NEW' : undefined;
  // the client's words decide the view when they asked for a picture ("posisi terbuka" → open interior angle)
  const mockupArgs = (call?: MockupToolArgs): MockupToolArgs => ({
    ...call,
    ...(visualRequest && { requestText: burstText }),
    ...(revisionAdjustment && !call?.adjustment && { adjustment: revisionAdjustment }),
  });

  // --- Guardrails: off-topic / prompt injection → polite refusal; the spec and brief are left untouched -------
  if (intake.message_intent !== 'CRAFT_REQUEST') {
    const latest = await commit(orderId, {
      intake: { ...stored, last_asked: [], processed_message_id },
      session_state: order.session_state === 'IDLE' ? 'REQUIREMENT_GATHERING' : order.session_state,
    });
    const reply = refusalMessage(profile);
    const sent = await say(reply);
    console.info(`[guardrail] ${orderId}: ${intake.message_intent}`);
    return { order: latest, stage: sent ? 'REFUSED' : 'SKIPPED_TAKEOVER', reply };
  }

  // --- Domain boundary: a product this workshop doesn't make → say what it does make ----------------------
  if (!isWithinScope(spec0, profile) || intake.out_of_scope_item) {
    const item = intake.out_of_scope_item ?? requestedItemLabel(spec0);
    // keep an earlier in-scope request (client asked "bisa bikin meja juga?" mid-order); otherwise start clean
    const keep = isClassified(known) && isWithinScope(known, profile);
    const latest = await commit(orderId, {
      craft_category: keep ? known.category : 'CUSTOM_GENERIC',
      specifications: keep ? known : emptySpecifications(),
      session_state: order.session_state === 'PENDING_CRAFTER_APPROVAL' ? 'PENDING_CRAFTER_APPROVAL' : 'REQUIREMENT_GATHERING',
      intake: keep ? { ...stored, last_asked: [], processed_message_id } : { asked_topics: [], last_asked: [], deferred_topics: [], question_rounds: stored.question_rounds, processed_message_id },
    });
    const reply = mismatchMessage(profile, item);
    const sent = await say(reply);
    return { order: latest, stage: sent ? 'REFUSED' : 'SKIPPED_TAKEOVER', reply };
  }

  // --- Non-standard request: outside the crafting glossary → straight to a human ---------------
  if (intake.non_standard_reason) {
    const latest = await commit(orderId, {
      client_brief,
      craft_category: spec0.category,
      specifications: spec0,
      intake: { ...progress, vision_notes: intake.vision_notes, processed_message_id },
    });
    if (!isAiBlocked(latest)) {
      setAutomationMode(latest, 'FULL_MANUAL', 'CLIENT_REQUEST', undefined, undefined, intake.non_standard_reason);
      await store.saveOrder(latest);
      await Promise.all(burst.map((m) => store.updateMessage(orderId, m.id, { awaiting_crafter_review: true })));
      await sendToClient(latest, 'SYSTEM', renderTemplate(HANDOFF_MESSAGES.NON_STANDARD, profile));
      await notifyCrafter(latest, intake.non_standard_reason);
    }
    return { order: latest, stage: 'ESCALATED', reply: renderTemplate(HANDOFF_MESSAGES.NON_STANDARD, profile) };
  }

  // --- Q&A: the client asked what something means / how it will look → answer before locking anything ---
  if (blockingQuestions.length) {
    const askedAbout = new Set(blockingQuestions.flatMap((q) => findGlossary(q.text, spec0.category)).map((g) => g.topic));
    const preference = topicsFor(spec0).filter((t) => askedAbout.has(t.id));
    const ask = [...new Map([...preference, ...plan.missing_required].map((t) => [t.id, t])).values()].slice(0, MAX_QUESTIONS_PER_TURN);
    const askedKeys = ask.map((t) => topicKey(spec0, t));
    const reply = await composeReply({
      clientName: order.client_info.client_name_wa,
      plan: { ...plan, ask, ready: false },
      spec: spec0,
      messages,
      visionNotes: intake.vision_notes,
      isFirstTurn: !messages.some((m) => m.sender === 'AI'),
      progress,
      brief: client_brief,
      profile,
      questions: intake.questions,
      mockupComing,
    });
    const latest = await commit(orderId, {
      client_brief,
      craft_category: spec0.category,
      specifications: spec0,
      // a locked spec card stays locked; the answer just explains it
      session_state: wasLocked ? 'PENDING_CRAFTER_APPROVAL' : 'REQUIREMENT_GATHERING',
      ...(!wasLocked && autoBom),
      intake: {
        ...progress,
        // the client is reconsidering these topics: their earlier "terserah" no longer settles them
        deferred_topics: progress.deferred_topics.filter((k) => !askedKeys.includes(k)),
        asked_topics: [...new Set([...progress.asked_topics, ...askedKeys])],
        last_asked: askedKeys,
        question_rounds: progress.question_rounds + 1,
        vision_notes: intake.vision_notes,
        processed_message_id,
      },
    });
    const sent = await say(reply.text);
    if (sent && (mockupComing || reply.mockupCall)) await executeGenerateMockupTool(orderId, profile, mockupArgs(reply.mockupCall));
    return { order: latest, stage: sent ? 'ANSWERED' : 'SKIPPED_TAKEOVER', reply: reply.text };
  }

  // --- Still gathering: ask the next one or two things, naturally -------------
  if (!plan.ready) {
    const asked = plan.ask.map((t) => topicKey(spec0, t));
    const nextProgress: IntakeProgress = {
      ...progress,
      asked_topics: [...new Set([...progress.asked_topics, ...asked])],
      last_asked: asked,
      question_rounds: progress.question_rounds + 1,
      vision_notes: intake.vision_notes,
      processed_message_id,
    };
    const reply = await composeReply({
      clientName: order.client_info.client_name_wa,
      plan,
      spec: spec0,
      messages,
      visionNotes: intake.vision_notes,
      isFirstTurn: !messages.some((m) => m.sender === 'AI'),
      progress,
      brief: client_brief,
      profile,
      mockupComing,
    });
    const latest = await commit(orderId, {
      client_brief,
      craft_category: spec0.category,
      specifications: spec0,
      session_state: 'REQUIREMENT_GATHERING',
      intake: nextProgress,
      ...autoBom,
    });
    const sent = await say(reply.text);
    if (sent && (mockupComing || reply.mockupCall)) await executeGenerateMockupTool(orderId, profile, mockupArgs(reply.mockupCall));
    return { order: latest, stage: sent ? 'GATHERING' : 'SKIPPED_TAKEOVER', reply: reply.text };
  }

  // --- Spec complete → lock it, then pattern, mockup, sourcing, quote ---------
  const preset = presetFor(spec0.category);
  const spec = finalizeSpecifications(spec0, preset.defaults);
  const specChanged = JSON.stringify(spec) !== JSON.stringify(known);
  const needsBuild = specChanged || order.pattern_and_bom.components_breakdown.length === 0;
  // Spec confirmed → the full set in ONE batched tool call: closed + open interior + stitch & edge macro for wallets
  // (bags: their pair; footwear / furniture / custom: hero + macro). Angles whose earlier render still shows this spec
  // are re-sent, not paid for twice; a new picture is needed when the client asks for one or any of them changed.
  const confirmationSet = confirmationMockupAngles(spec.category, spec.construction_type);
  const looksDifferent = confirmationSet.some((a) => !reusableRender(order, a, spec));
  const wantsRender = visualRequest || revisionRequest || (needsBuild && looksDifferent);

  let patch: Partial<OrchestratorFields> = {
    client_brief,
    craft_category: spec.category,
    specifications: spec,
    session_state: 'PENDING_CRAFTER_APPROVAL',
    intake: { ...progress, last_asked: [], vision_notes: intake.vision_notes, processed_message_id },
  };

  if (needsBuild) {
    const draft = await runPatternAgent(spec, preset);
    const quote = assembleQuote(draft, spec, inventory, preset);
    patch = { ...patch, material_sourcing: quote.material_sourcing, pattern_and_bom: quote.pattern_and_bom };
  }

  const latest = await commit(orderId, patch);
  const reply = needsBuild
    ? specCardText(order.client_info.client_name_wa, spec, { updated: wasLocked })
    : revisionRequest
      ? 'Siap kak, gambarnya aku sesuaikan dulu ya.'
      : visualRequest
        ? 'Siap kak, aku buatin gambarnya dulu ya.'
        : 'Noted kak, sudah kami teruskan ke crafter.';
  const sent = await say(reply, true);
  if (sent && wantsRender) {
    // one render round for the whole set (or the hand-off message once the render cap is reached); any review angle
    // outside the set (a bag's side profile) follows in the background for the crafter
    const tool = await executeGenerateMockupTool(orderId, profile, mockupArgs({ angles: confirmationSet.map((a) => MOCKUP_ANGLES.indexOf(a) + 1) }));
    if (tool.status === 'SENT') renderRemainingAnglesInBackground(orderId);
  } else if (sent && needsBuild && (latest.media_assets.mockup_angles?.length ?? 0) < 3) {
    // the draft is reused: only the crafter's review angles are missing (current ones are skipped)
    renderRemainingAnglesInBackground(orderId);
  }
  return { order: latest, stage: sent ? 'QUOTED' : 'SKIPPED_TAKEOVER', reply };
}
