import { defaultHardware } from '@/lib/agents/pattern-agent';
import { runVisualAgent, type VisualResult } from '@/lib/agents/visual-agent';
import { getStore } from '@/lib/gcp/firestore';
import { angleDef, MOCKUP_ANGLES } from '@/lib/spec/angles';
import type { MockupAngle, MockupRender, OrderPayload } from '@/lib/types';
import { nowIso } from '@/lib/utils/format';

/**
 * Multi-angle mockup sets (3 slots; each slot's view comes from the category strategy matrix in spec/angles.ts).
 * ANGLE_1 is rendered first (from the client sketch); the other slots are rendered in parallel with ANGLE_1 as a
 * reference image so the set shows one consistent product. A crafter's custom shot prompt for a slot is saved in
 * `media_assets.angle_prompts` and used for that slot until cleared. `ai_generated_mockup_url` mirrors ANGLE_1.
 */

/** Existing renders, including orders that only have the single legacy mockup. */
export function currentAngles(order: OrderPayload): MockupRender[] {
  const m = order.media_assets;
  if (m.mockup_angles?.length) return m.mockup_angles;
  if (!m.ai_generated_mockup_url) return [];
  return [
    {
      angle: 'ANGLE_1',
      view: angleDef(order.specifications.category, 'ANGLE_1', order.specifications.construction_type).view,
      url: m.ai_generated_mockup_url,
      engine: m.mockup_engine ?? 'offline-svg',
      created_at: order.created_at,
      error: m.mockup_error,
      feedback: m.mockup_feedback,
    },
  ];
}

const toRender = (r: VisualResult, feedback?: string[]): MockupRender => ({
  angle: r.angle,
  view: r.view,
  url: r.url,
  engine: r.engine,
  created_at: nowIso(),
  ...(r.error && { error: r.error }),
  ...(r.custom_prompt && { custom_prompt: r.custom_prompt }),
  ...(feedback?.length && { feedback }),
});

export interface RenderOptions {
  angles?: MockupAngle[];
  /** Feedback editing the previous render of each requested angle. */
  adjustment?: string;
  /** New custom shot prompts per angle ('' clears the saved prompt and returns the slot to its category view). */
  customPrompts?: Partial<Record<MockupAngle, string>>;
}

export async function renderMockupAngles(orderId: string, opts: RenderOptions = {}): Promise<MockupRender[]> {
  const store = getStore();
  const order = await store.getOrder(orderId);
  if (!order) throw new Error(`Order ${orderId} not found`);

  const requested = MOCKUP_ANGLES.filter((a) => (opts.angles ?? MOCKUP_ANGLES).includes(a));
  const byAngle = new Map(currentAngles(order).map((r) => [r.angle, r]));
  const adjustment = opts.adjustment?.trim() || undefined;
  const prompts: Partial<Record<MockupAngle, string>> = { ...order.media_assets.angle_prompts };
  for (const [a, p] of Object.entries(opts.customPrompts ?? {}) as Array<[MockupAngle, string]>) {
    if (p.trim()) prompts[a] = p.trim();
    else delete prompts[a];
  }
  const hardware = order.pattern_and_bom.hardware_list.length ? order.pattern_and_bom.hardware_list : defaultHardware(order.specifications);
  const common = { orderId, spec: order.specifications, hardware, sketchUrl: order.media_assets.original_sketch_url, adjustment };
  const feedbackFor = (a: MockupAngle) => (adjustment ? [...(byAngle.get(a)?.feedback ?? []), adjustment] : byAngle.get(a)?.feedback);

  const results: MockupRender[] = [];
  let anchorUrl = byAngle.get('ANGLE_1')?.url;
  let offline: { reason: string } | undefined;

  if (requested.includes('ANGLE_1')) {
    const r = await runVisualAgent({ ...common, angle: 'ANGLE_1', customPrompt: prompts.ANGLE_1, previousMockupUrl: anchorUrl });
    results.push(toRender(r, feedbackFor('ANGLE_1')));
    anchorUrl = r.url;
    // every image model just failed even after retries: don't spend another round on the other angles
    if (r.engine === 'offline-svg' && r.error) offline = { reason: r.error };
  }

  const others = await Promise.all(
    requested
      .filter((a) => a !== 'ANGLE_1')
      .map((angle) =>
        runVisualAgent({
          ...common,
          angle,
          customPrompt: prompts[angle],
          previousMockupUrl: byAngle.get(angle)?.url,
          // (an offline SVG anchor is ignored as a reference by mediaUrlToPart)
          consistencyRefUrl: anchorUrl,
          offline,
        }),
      ),
  );
  results.push(...others.map((r) => toRender(r, feedbackFor(r.angle))));

  // Merge into the latest order so a takeover, edit or another render that landed meanwhile is kept.
  const latest = (await store.getOrder(orderId))!;
  const merged = new Map(currentAngles(latest).map((r) => [r.angle, r]));
  for (const r of results) merged.set(r.angle, r);
  const angles = MOCKUP_ANGLES.map((a) => merged.get(a)).filter((r): r is MockupRender => Boolean(r));
  const anchor = merged.get('ANGLE_1');
  latest.media_assets = {
    ...latest.media_assets,
    mockup_angles: angles,
    angle_prompts: prompts,
    ...(anchor && { ai_generated_mockup_url: anchor.url, mockup_engine: anchor.engine, mockup_error: anchor.error }),
    mockup_feedback: adjustment ? [...(latest.media_assets.mockup_feedback ?? []), adjustment] : latest.media_assets.mockup_feedback,
  };
  await store.saveOrder(latest);
  return results;
}

const globalForRenders = globalThis as unknown as { __craftmindAngleRenders?: Set<string> };
const pendingRenders = (globalForRenders.__craftmindAngleRenders ??= new Set());

/** True while background angle renders for this order are running (the dashboard shows a spinner). */
export function isRenderingAngles(orderId: string): boolean {
  return pendingRenders.has(orderId);
}

/** Fire-and-forget: render ANGLE_2 and ANGLE_3 after the spec card is sent, so the client reply is not delayed. */
export function renderRemainingAnglesInBackground(orderId: string): void {
  if (pendingRenders.has(orderId)) return;
  pendingRenders.add(orderId);
  renderMockupAngles(orderId, { angles: ['ANGLE_2', 'ANGLE_3'] })
    .catch((err) => console.error(`[mockups] background angle render for ${orderId} failed:`, err))
    .finally(() => pendingRenders.delete(orderId));
}
