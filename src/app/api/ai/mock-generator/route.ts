import type { NextRequest } from 'next/server';
import { defaultHardware } from '@/lib/agents/pattern-agent';
import { runVisualAgent } from '@/lib/agents/visual-agent';
import { getStore } from '@/lib/gcp/firestore';
import type { CraftCategory, Specifications } from '@/lib/types';

/**
 * Generate a studio mockup.
 * Body: { order_id } to (re)render and store on an order, or
 *       { craft_category, specifications, sketch_url? } for a one-off preview.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    order_id?: string;
    craft_category?: CraftCategory;
    specifications?: Specifications;
    sketch_url?: string;
  };
  const store = getStore();
  const order = body.order_id ? await store.getOrder(body.order_id) : null;
  if (body.order_id && !order) return Response.json({ error: 'Order not found' }, { status: 404 });

  const category = order?.craft_category ?? body.craft_category;
  const spec = order?.specifications ?? body.specifications;
  if (!category || !spec) return Response.json({ error: 'order_id or craft_category + specifications required' }, { status: 400 });

  const mockup = await runVisualAgent({
    orderId: order?.order_id ?? 'preview',
    category,
    spec,
    hardware: order?.pattern_and_bom.hardware_list ?? defaultHardware(category, spec),
    sketchUrl: order?.media_assets.original_sketch_url ?? body.sketch_url,
  });

  if (order) {
    const latest = (await store.getOrder(order.order_id))!;
    latest.media_assets.ai_generated_mockup_url = mockup.url;
    await store.saveOrder(latest);
  }
  return Response.json(mockup);
}
