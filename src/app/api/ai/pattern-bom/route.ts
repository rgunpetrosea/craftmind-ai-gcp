import type { NextRequest } from 'next/server';
import { runPatternAgent } from '@/lib/agents/pattern-agent';
import { assembleQuote } from '@/lib/agents/pricing';
import { getPreset, getStore } from '@/lib/gcp/firestore';
import type { CraftCategory, Specifications } from '@/lib/types';

/**
 * 2D pattern breakdown, SqFt calculation, stock match and quotation.
 * Body: { order_id } to recompute and store, or { craft_category, specifications } to preview.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    order_id?: string;
    craft_category?: CraftCategory;
    specifications?: Specifications;
  };
  const store = getStore();
  const order = body.order_id ? await store.getOrder(body.order_id) : null;
  if (body.order_id && !order) return Response.json({ error: 'Order not found' }, { status: 404 });

  const category = order?.craft_category ?? body.craft_category;
  const spec = order?.specifications ?? body.specifications;
  if (!category || !spec) return Response.json({ error: 'order_id or craft_category + specifications required' }, { status: 400 });

  const preset = await getPreset(category);
  const [draft, inventory] = await Promise.all([runPatternAgent(spec, preset), store.listInventory()]);
  const quote = assembleQuote(draft, spec, inventory, preset);

  if (order) {
    const latest = (await store.getOrder(order.order_id))!;
    await store.saveOrder({ ...latest, material_sourcing: quote.material_sourcing, pattern_and_bom: quote.pattern_and_bom });
  }
  return Response.json(quote);
}
