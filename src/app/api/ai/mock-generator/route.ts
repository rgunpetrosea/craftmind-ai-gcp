import type { NextRequest } from 'next/server';
import { defaultHardware } from '@/lib/agents/pattern-agent';
import { runVisualAgent } from '@/lib/agents/visual-agent';
import { getStore } from '@/lib/gcp/firestore';
import { renderMockupAngles } from '@/lib/mockups';
import { MOCKUP_ANGLES } from '@/lib/spec/angles';
import { MAX_CRAFTER_RENDERS_PER_ORDER } from '@/lib/spec/guardrails';
import { normalizeSpecifications } from '@/lib/spec/catalog';
import type { MockupAngle, Specifications } from '@/lib/types';

/**
 * Generate or re-generate studio mockups: 3 angle slots whose views come from the order's craft category
 * (wallet: closed exterior / open interior / stitch macro; bag: 3/4 hero / side profile / open interior; shoes: lateral /
 * top-down vamp / welt macro; furniture: isometric room / functional open / joinery macro).
 *
 * Body: { order_id, angles?, angle_index?, custom_angle_prompt?, clear_custom_prompt?, adjustment? }
 *   angles               slots to render (default: all three); ANGLE_1 renders first and anchors the others.
 *   angle_index          1 | 2 | 3: shorthand for a single slot (required with custom_angle_prompt / clear_custom_prompt).
 *   custom_angle_prompt  crafter's camera / shot direction for that slot, e.g. "45-degree back view with the hidden zipper
 *                        pocket open". The prompt still starts with the order's spec JSON (materials, colours, stitching);
 *                        the custom shot replaces the category view's default shot and is saved for that slot.
 *   clear_custom_prompt  true: drop the saved custom prompt and re-render the slot with its category view.
 *   adjustment           feedback editing each requested slot's previous render.
 *   Only media_assets changes — the specification, BOM and quote are left untouched.
 * or { specifications, sketch_url? } for a one-off ANGLE_1 preview that is not stored.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    order_id?: string;
    angles?: MockupAngle[];
    angle_index?: number;
    custom_angle_prompt?: string;
    clear_custom_prompt?: boolean;
    specifications?: Specifications;
    sketch_url?: string;
    adjustment?: string;
  };
  const adjustment = body.adjustment?.trim() || undefined;

  if (!body.order_id) {
    if (!body.specifications) return Response.json({ error: 'order_id or specifications required' }, { status: 400 });
    const spec = normalizeSpecifications(body.specifications);
    const preview = await runVisualAgent({
      orderId: 'preview',
      spec,
      hardware: defaultHardware(spec),
      sketchUrl: body.sketch_url,
      customPrompt: body.custom_angle_prompt,
      adjustment,
    });
    return Response.json({ renders: [preview] });
  }

  const order = await getStore().getOrder(body.order_id);
  if (!order) return Response.json({ error: 'Order not found' }, { status: 404 });

  const indexed = body.angle_index ? MOCKUP_ANGLES[body.angle_index - 1] : undefined;
  if (body.angle_index && !indexed) return Response.json({ error: 'angle_index must be 1, 2 or 3' }, { status: 400 });
  const angles = indexed ? [indexed] : (body.angles?.length ? body.angles : MOCKUP_ANGLES).filter((a) => MOCKUP_ANGLES.includes(a));
  if (!angles.length) return Response.json({ error: `angles must be among ${MOCKUP_ANGLES.join(', ')}` }, { status: 400 });

  const customPrompt = body.custom_angle_prompt?.trim();
  if ((customPrompt || body.clear_custom_prompt) && angles.length !== 1) {
    return Response.json({ error: 'custom_angle_prompt / clear_custom_prompt apply to one angle: pass angle_index' }, { status: 400 });
  }
  const customPrompts = customPrompt ? { [angles[0]]: customPrompt } : body.clear_custom_prompt ? { [angles[0]]: '' } : undefined;

  // cost guardrail: a generous per-order cap on crafter-triggered renders (the AI's own renders are capped per session)
  const used = order.media_assets.crafter_render_count ?? 0;
  if (used >= MAX_CRAFTER_RENDERS_PER_ORDER) {
    return Response.json(
      { error: `Render limit reached for this order (${MAX_CRAFTER_RENDERS_PER_ORDER}). Raise MAX_CRAFTER_RENDERS_PER_ORDER if more are needed.` },
      { status: 429 },
    );
  }

  const renders = await renderMockupAngles(order.order_id, { angles, adjustment, customPrompts });
  const latest = await getStore().getOrder(order.order_id);
  if (latest) await getStore().saveOrder({ ...latest, media_assets: { ...latest.media_assets, crafter_render_count: used + 1 } });
  const offline = renders.filter((r) => r.engine === 'offline-svg');
  return Response.json({
    renders,
    feedback_applied: Boolean(adjustment) && offline.length < renders.length,
    note: offline.length
      ? `${offline[0].error ?? 'AI image generation unavailable.'}${adjustment || customPrompt ? ' The offline concept cannot apply custom prompts or feedback.' : ''}`
      : undefined,
  });
}
