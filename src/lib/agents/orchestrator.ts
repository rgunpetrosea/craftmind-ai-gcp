import { composeReply, lastClientBurst, runIntakeAgent } from '@/lib/agents/intake-agent';
import { defaultHardware, runPatternAgent } from '@/lib/agents/pattern-agent';
import { assembleQuote } from '@/lib/agents/pricing';
import { runVisualAgent } from '@/lib/agents/visual-agent';
import { getPreset, getStore } from '@/lib/gcp/firestore';
import { renderRemainingAnglesInBackground } from '@/lib/mockups';
import {
  filledTopicCount,
  finalizeSpecifications,
  MAX_QUESTIONS_PER_TURN,
  normalizeSpecifications,
  planConversation,
  topicKey,
  topicsFor,
} from '@/lib/spec/catalog';
import { findGlossary } from '@/lib/spec/glossary';
import { specCardText } from '@/lib/spec/describe';
import type { IntakeProgress, OrchestratorResult, OrderPayload } from '@/lib/types';
import { nowIso } from '@/lib/utils/format';
import {
  CONFUSION_STRIKE_LIMIT,
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
  'craft_category' | 'specifications' | 'session_state' | 'material_sourcing' | 'pattern_and_bom' | 'media_assets' | 'intake'
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

export function runOrchestrator(orderId: string, opts: { force?: boolean } = {}): Promise<OrchestratorResult> {
  const current = inflight.get(orderId);
  if (current) {
    current.rerun = true;
    return current.promise;
  }
  const entry = { rerun: false } as { promise: Promise<OrchestratorResult>; rerun: boolean };
  entry.promise = (async () => {
    try {
      let result = await executePipeline(orderId, opts);
      while (entry.rerun) {
        entry.rerun = false;
        result = await executePipeline(orderId, opts);
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

async function replyIfStillAllowed(orderId: string, text: string, sender: 'AI' | 'SYSTEM' = 'AI'): Promise<boolean> {
  const latest = await getStore().getOrder(orderId);
  if (!latest || isAiBlocked(latest)) return false;
  await sendToClient(latest, sender, text);
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
  const burst = lastClientBurst(messages);
  const processed_message_id = burst.at(-1)?.id ?? stored.processed_message_id;

  // --- Agent 1: vision + structured intake -----------------------------------
  const intake = await runIntakeAgent({ messages, known, progress: stored });
  const spec0 = intake.specifications;
  const progress: IntakeProgress = { ...stored, deferred_topics: [...new Set([...stored.deferred_topics, ...intake.deferred_topics])] };
  // Once a spec card has been sent, later messages are corrections: re-quote instead of re-opening optional questions.
  const wasLocked = order.session_state === 'PENDING_CRAFTER_APPROVAL';
  const clientFinished = intake.client_finished || wasLocked;
  const plan = planConversation(spec0, progress, clientFinished);

  // --- Non-standard request: outside the crafting glossary → straight to a human ---------------
  if (intake.non_standard_reason) {
    const latest = await commit(orderId, {
      craft_category: spec0.category,
      specifications: spec0,
      intake: { ...progress, vision_notes: intake.vision_notes, processed_message_id },
    });
    if (!isAiBlocked(latest)) {
      setAutomationMode(latest, 'FULL_MANUAL', 'CLIENT_REQUEST', undefined, undefined, intake.non_standard_reason);
      await store.saveOrder(latest);
      await Promise.all(burst.map((m) => store.updateMessage(orderId, m.id, { awaiting_crafter_review: true })));
      await sendToClient(latest, 'SYSTEM', HANDOFF_MESSAGES.NON_STANDARD);
      await notifyCrafter(latest, intake.non_standard_reason);
    }
    return { order: latest, stage: 'ESCALATED', reply: HANDOFF_MESSAGES.NON_STANDARD };
  }

  // --- Confusion rule: the client keeps correcting us, or the conversation makes no progress --------
  // A turn spent asking us questions is engagement, not confusion (unless the client is also frustrated).
  const blockingQuestions = intake.questions.filter((q) => q.kind !== 'PRICE_TIMELINE');
  const frustrated = isFrustrated(burst.map((m) => m.text ?? '').join('\n'));
  const noProgress = !plan.ready && !clientFinished && !blockingQuestions.length && filledTopicCount(spec0, progress) <= filledTopicCount(known, stored);
  const stalled = frustrated || noProgress;
  if (conversation) {
    conversation.confusion_strikes = stalled ? conversation.confusion_strikes + 1 : 0;
    conversation.updated_at = nowIso();
    await store.saveConversation(conversation);
  }

  if (conversation && conversation.confusion_strikes >= CONFUSION_STRIKE_LIMIT) {
    const latest = await commit(orderId, {
      craft_category: spec0.category,
      specifications: spec0,
      intake: { ...progress, vision_notes: intake.vision_notes, processed_message_id },
    });
    if (!isAiBlocked(latest)) {
      setAutomationMode(latest, 'FULL_MANUAL', 'CONFUSION_RULE', undefined, undefined, `AI tidak berhasil memahami klien ${CONFUSION_STRIKE_LIMIT}x berturut-turut`);
      await store.saveOrder(latest);
      await sendToClient(latest, 'SYSTEM', HANDOFF_MESSAGES.CONFUSION_RULE);
      await notifyCrafter(latest, latest.escalation_note!);
    }
    conversation.confusion_strikes = 0;
    await store.saveConversation(conversation);
    return { order: latest, stage: 'ESCALATED', reply: HANDOFF_MESSAGES.CONFUSION_RULE };
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
      questions: intake.questions,
    });
    const latest = await commit(orderId, {
      craft_category: spec0.category,
      specifications: spec0,
      // a locked spec card stays locked; the answer just explains it
      session_state: wasLocked ? 'PENDING_CRAFTER_APPROVAL' : 'REQUIREMENT_GATHERING',
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
    const sent = await replyIfStillAllowed(orderId, reply);
    return { order: latest, stage: sent ? 'ANSWERED' : 'SKIPPED_TAKEOVER', reply };
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
    });
    const latest = await commit(orderId, {
      craft_category: spec0.category,
      specifications: spec0,
      session_state: 'REQUIREMENT_GATHERING',
      intake: nextProgress,
    });
    const sent = await replyIfStillAllowed(orderId, reply);
    return { order: latest, stage: sent ? 'GATHERING' : 'SKIPPED_TAKEOVER', reply };
  }

  // --- Spec complete → lock it, then pattern, mockup, sourcing, quote ---------
  const preset = await getPreset(spec0.category);
  const spec = finalizeSpecifications(spec0, preset.defaults);
  const specChanged = JSON.stringify(spec) !== JSON.stringify(known);
  const needsBuild = specChanged || order.pattern_and_bom.components_breakdown.length === 0;

  let patch: Partial<OrchestratorFields> = {
    craft_category: spec.category,
    specifications: spec,
    session_state: 'PENDING_CRAFTER_APPROVAL',
    intake: { ...progress, last_asked: [], vision_notes: intake.vision_notes, processed_message_id },
  };

  if (needsBuild) {
    const [draft, mockup, inventory] = await Promise.all([
      runPatternAgent(spec, preset),
      runVisualAgent({
        orderId,
        spec,
        hardware: defaultHardware(spec),
        sketchUrl: order.media_assets.original_sketch_url,
        angle: 'ANGLE_1',
        customPrompt: order.media_assets.angle_prompts?.ANGLE_1,
      }),
      store.listInventory(),
    ]);
    const quote = assembleQuote(draft, spec, inventory, preset);
    patch = {
      ...patch,
      material_sourcing: quote.material_sourcing,
      pattern_and_bom: quote.pattern_and_bom,
      media_assets: {
        ...order.media_assets,
        ai_generated_mockup_url: mockup.url,
        mockup_engine: mockup.engine,
        mockup_error: mockup.error,
        // a changed spec invalidates the old angle set; the other angles are re-rendered after the reply is sent
        mockup_angles: [
          {
            angle: 'ANGLE_1',
            view: mockup.view,
            url: mockup.url,
            engine: mockup.engine,
            created_at: nowIso(),
            ...(mockup.error && { error: mockup.error }),
            ...(mockup.custom_prompt && { custom_prompt: mockup.custom_prompt }),
          },
        ],
      },
    };
  }

  const latest = await commit(orderId, patch);
  const reply = needsBuild
    ? specCardText(order.client_info.client_name_wa, spec, { updated: wasLocked })
    : 'Catatan kakak sudah kami teruskan ke crafter kami ya 🙏';
  const sent = await replyIfStillAllowed(orderId, reply);
  if (needsBuild) renderRemainingAnglesInBackground(orderId);
  return { order: latest, stage: sent ? 'QUOTED' : 'SKIPPED_TAKEOVER', reply };
}
