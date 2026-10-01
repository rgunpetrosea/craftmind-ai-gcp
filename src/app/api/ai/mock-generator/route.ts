import type { NextRequest } from 'next/server';
import { defaultHardware } from '@/lib/agents/pattern-agent';
import { runVisualAgent } from '@/lib/agents/visual-agent';
import { getStore } from '@/lib/gcp/firestore';
import { normalizeSpecifications } from '@/lib/spec/catalog';
import type { Specifications } from '@/lib/types';

/**
 * Generate or re-generate a studio mockup.
 * Body: { order_id, adjustment? } re-renders and stores on the order. `adjustment` is the crafter's visual feedback
 *       ("flat card sleeve, show open card slots from the front"); the current mockup is passed to the image model as a
 *       reference and only `media_assets` changes — the specification, BOM and quote are left untouched.
 *   or  { specifications, sketch_url? } for a one-off preview that is not stored.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    order_id?: string;
    specifications?: Specifications;
    sketch_url?: string;
    adjustment?: string;
  };
  const store = getStore();
  const order = body.order_id ? await store.getOrder(body.order_id) : null;
  if (body.order_id && !order) return Response.json({ error: 'Order not found' }, { status: 404 });

  const spec = order?.specifications ?? body.specifications;
  if (!spec) return Response.json({ error: 'order_id or specifications required' }, { status: 400 });

  const adjustment = body.adjustment?.trim() || undefined;
  const mockup = await runVisualAgent({
    orderId: order?.order_id ?? 'preview',
    spec: normalizeSpecifications(spec),
    hardware: order?.pattern_and_bom.hardware_list.length ? order.pattern_and_bom.hardware_list : defaultHardware(normalizeSpecifications(spec)),
    sketchUrl: order?.media_assets.original_sketch_url ?? body.sketch_url,
    adjustment,
    previousMockupUrl: order?.media_assets.ai_generated_mockup_url,
  });

  if (order) {
    // Re-read so a takeover or crafter edit that landed during rendering is preserved.
    const latest = (await store.getOrder(order.order_id))!;
    latest.media_assets = {
      ...latest.media_assets,
      ai_generated_mockup_url: mockup.url,
      mockup_engine: mockup.engine,
      mockup_feedback: adjustment ? [...(latest.media_assets.mockup_feedback ?? []), adjustment] : latest.media_assets.mockup_feedback,
    };
    await store.saveOrder(latest);
  }

  return Response.json({
    ...mockup,
    feedback_applied: Boolean(adjustment) && mockup.engine !== 'offline-svg',
    note:
      adjustment && mockup.engine === 'offline-svg'
        ? 'The offline renderer cannot apply free-text feedback (Gemini image model unavailable or out of quota). The concept sketch was regenerated from the current specification instead.'
        : undefined,
  });
}
