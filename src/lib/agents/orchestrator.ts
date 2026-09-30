import { missingFields, runIntakeAgent } from '@/lib/agents/intake-agent';
import { defaultHardware, runPatternAgent } from '@/lib/agents/pattern-agent';
import { assembleQuote } from '@/lib/agents/pricing';
import { runVisualAgent } from '@/lib/agents/visual-agent';
import { getPreset, getStore } from '@/lib/gcp/firestore';
import type { CategoryPreset, CraftCategory, OrchestratorResult, OrderPayload } from '@/lib/types';
import { nowIso } from '@/lib/utils/format';
import {
  CONFUSION_STRIKE_LIMIT,
  expirePartialPause,
  HANDOFF_MESSAGES,
  isAiBlocked,
  setAutomationMode,
} from '@/lib/utils/takeover';
import { sendToClient } from '@/lib/whatsapp';

/**
 * Multi-agent execution engine:
 *   Intake (Flash) → [Pattern/BOM (Pro) ∥ Visual mockup] → Inventory match → Quote
 *
 * Takeover is checked before the run and again before anything is sent, because
 * the crafter may take over while Gemini is still thinking. `force` lets the
 * crafter recompute spec/BOM/mockup during a takeover; the client still gets
 * no AI message while the takeover is active.
 */

const CONFIDENCE_FLOOR = 0.6;

type OrchestratorFields = Pick<
  OrderPayload,
  'craft_category' | 'specifications' | 'session_state' | 'material_sourcing' | 'pattern_and_bom' | 'media_assets'
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

  const [messages, presets, conversation] = await Promise.all([
    store.listMessages(orderId),
    store.listPresets(),
    store.getConversation(order.client_info.phone_number),
  ]);
  const presetFor = (c: CraftCategory): CategoryPreset => presets.find((p) => p.category === c)!;

  // --- Agent 1: intake -----------------------------------------------------
  const intake = await runIntakeAgent({
    messages,
    known: order.specifications,
    category: order.craft_category,
    clientName: order.client_info.client_name_wa,
    presetFor,
  });

  // --- Confusion rule ------------------------------------------------------
  const before = missingFields(order.specifications).length;
  const stalled = intake.missing_fields.length > 0 && intake.missing_fields.length >= before && intake.confidence < CONFIDENCE_FLOOR;
  if (conversation) {
    conversation.confusion_strikes = stalled ? conversation.confusion_strikes + 1 : 0;
    conversation.updated_at = nowIso();
    await store.saveConversation(conversation);
  }

  if (conversation && conversation.confusion_strikes >= CONFUSION_STRIKE_LIMIT) {
    const latest = await commit(orderId, { craft_category: intake.craft_category, specifications: intake.specifications });
    if (!isAiBlocked(latest)) {
      setAutomationMode(latest, 'FULL_MANUAL', 'CONFUSION_RULE');
      await store.saveOrder(latest);
      await sendToClient(latest, 'SYSTEM', HANDOFF_MESSAGES.CONFUSION_RULE);
    }
    conversation.confusion_strikes = 0;
    await store.saveConversation(conversation);
    return { order: latest, stage: 'ESCALATED', reply: HANDOFF_MESSAGES.CONFUSION_RULE };
  }

  // --- Still gathering requirements ---------------------------------------
  if (intake.missing_fields.length > 0) {
    const latest = await commit(orderId, {
      craft_category: intake.craft_category,
      specifications: intake.specifications,
      session_state: 'REQUIREMENT_GATHERING',
    });
    const sent = await replyIfStillAllowed(orderId, intake.reply_to_client);
    return { order: latest, stage: sent ? 'GATHERING' : 'SKIPPED_TAKEOVER', reply: intake.reply_to_client };
  }

  // --- Complete spec → pattern, mockup, sourcing, quote --------------------
  const preset = await getPreset(intake.craft_category);
  const specChanged =
    JSON.stringify(intake.specifications) !== JSON.stringify(order.specifications) || intake.craft_category !== order.craft_category;
  const needsBuild = specChanged || order.pattern_and_bom.components_breakdown.length === 0;

  let patch: Partial<OrchestratorFields> = {
    craft_category: intake.craft_category,
    specifications: intake.specifications,
    session_state: 'PENDING_CRAFTER_APPROVAL',
  };

  if (needsBuild) {
    const sketchUrl = order.media_assets.original_sketch_url;
    const [draft, mockup, inventory] = await Promise.all([
      runPatternAgent(intake.craft_category, intake.specifications, preset),
      runVisualAgent({
        orderId,
        category: intake.craft_category,
        spec: intake.specifications,
        hardware: defaultHardware(intake.craft_category, intake.specifications),
        sketchUrl,
      }),
      store.listInventory(),
    ]);
    const quote = assembleQuote(draft, intake.specifications, inventory, preset);
    patch = {
      ...patch,
      material_sourcing: quote.material_sourcing,
      pattern_and_bom: quote.pattern_and_bom,
      media_assets: { ...order.media_assets, ai_generated_mockup_url: mockup.url },
    };
  }

  const latest = await commit(orderId, patch);
  const s = intake.specifications;
  const reply = needsBuild
    ? `Siap kak ${order.client_info.client_name_wa}! ✨ Spesifikasi sudah lengkap:\n` +
      `• ${s.silhouette} — ${s.dimensions_cm.length}x${s.dimensions_cm.width}x${s.dimensions_cm.height} cm\n` +
      `• ${s.exterior_leather}, ${s.lining_material}\n` +
      `• ${s.stitching_method}, ${s.edge_finish}\n` +
      `Crafter kami sedang meninjau desain & penawarannya, akan kami kirim segera ya 🙏`
    : 'Catatan kakak sudah kami teruskan ke crafter kami ya 🙏';
  const sent = await replyIfStillAllowed(orderId, reply);
  return { order: latest, stage: sent ? 'QUOTED' : 'SKIPPED_TAKEOVER', reply };
}
