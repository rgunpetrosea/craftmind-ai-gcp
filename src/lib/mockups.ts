import { defaultHardware } from '@/lib/agents/pattern-agent';
import { mockupSignature, runVisualAgent, type VisualResult } from '@/lib/agents/visual-agent';
import { getPreset, getStore } from '@/lib/gcp/firestore';
import { finalizeSpecifications } from '@/lib/spec/catalog';
import { angleDef, MOCKUP_ANGLES } from '@/lib/spec/angles';
import type { MockupAngle, MockupRender, OrderPayload, Specifications } from '@/lib/types';
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

/**
 * This angle's existing render if it still shows `finalSpec` (finalized: workshop defaults filled) and needs no new
 * generation: same signature, and not an offline concept left behind by a failed image call (that one is retried).
 */
export function reusableRender(order: OrderPayload, angle: MockupAngle, finalSpec: Specifications): MockupRender | undefined {
  const r = currentAngles(order).find((x) => x.angle === angle);
  if (!r?.signature || (r.engine === 'offline-svg' && r.error)) return undefined;
  return r.signature === mockupSignature(finalSpec, angle, order.media_assets.angle_prompts?.[angle]) ? r : undefined;
}

/** The order's spec as it will be locked (signatures are always taken on this). */
export async function finalSpecOf(order: OrderPayload): Promise<Specifications> {
  const preset = await getPreset(order.specifications.category);
  return finalizeSpecifications(order.specifications, preset.defaults);
}

const toRender = (r: VisualResult, feedback: string[] | undefined, signature: string): MockupRender => ({
  angle: r.angle,
  view: r.view,
  url: r.url,
  engine: r.engine,
  created_at: nowIso(),
  ...(r.error && { error: r.error }),
  ...(r.custom_prompt && { custom_prompt: r.custom_prompt }),
  ...(feedback?.length && { feedback }),
  signature,
});

export interface RenderOptions {
  angles?: MockupAngle[];
  /** Feedback editing the previous render of each requested angle. */
  adjustment?: string;
  /** New custom shot prompts per angle ('' clears the saved prompt and returns the slot to its category view). */
  customPrompts?: Partial<Record<MockupAngle, string>>;
  /** Called as soon as each angle is rendered (ANGLE_1 first), e.g. to send it to the client without waiting for the set. */
  onRender?: (render: MockupRender) => Promise<void>;
}

async function notifyRendered(opts: RenderOptions, render: MockupRender): Promise<void> {
  try {
    await opts.onRender?.(render);
  } catch (err) {
    console.error(`[mockups] onRender for ${render.angle} failed:`, err);
  }
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
  const finalSpec = await finalSpecOf(order);
  const signatureFor = (a: MockupAngle) => mockupSignature(finalSpec, a, prompts[a]);
  const feedbackFor = (a: MockupAngle) => (adjustment ? [...(byAngle.get(a)?.feedback ?? []), adjustment] : byAngle.get(a)?.feedback);

  const results: MockupRender[] = [];
  let anchorUrl = byAngle.get('ANGLE_1')?.url;
  let offline: { reason: string } | undefined;

  if (requested.includes('ANGLE_1')) {
    const r = await runVisualAgent({ ...common, angle: 'ANGLE_1', customPrompt: prompts.ANGLE_1, previousMockupUrl: anchorUrl });
    results.push(toRender(r, feedbackFor('ANGLE_1'), signatureFor('ANGLE_1')));
    await notifyRendered(opts, results[0]);
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
        }).then(async (r) => {
          const render = toRender(r, feedbackFor(r.angle), signatureFor(r.angle));
          await notifyRendered(opts, render);
          return render;
        }),
      ),
  );
  results.push(...others);

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

/**
 * Fire-and-forget: render ANGLE_2 and ANGLE_3 after the spec card is sent, so the client reply is not delayed. An angle
 * whose render still shows the current spec (e.g. the open interior already sent with a wallet draft) is skipped.
 */
export function renderRemainingAnglesInBackground(orderId: string): void {
  if (pendingRenders.has(orderId)) return;
  pendingRenders.add(orderId);
  (async () => {
    const order = await getStore().getOrder(orderId);
    if (!order) return;
    const finalSpec = await finalSpecOf(order);
    const stale = (['ANGLE_2', 'ANGLE_3'] as MockupAngle[]).filter((a) => !reusableRender(order, a, finalSpec));
    if (stale.length) await renderMockupAngles(orderId, { angles: stale });
  })()
    .catch((err) => console.error(`[mockups] background angle render for ${orderId} failed:`, err))
    .finally(() => pendingRenders.delete(orderId));
}
