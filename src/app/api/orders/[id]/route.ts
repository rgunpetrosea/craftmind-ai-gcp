import type { NextRequest } from 'next/server';
import { matchInventory } from '@/lib/agents/inventory-agent';
import { computeQuotation } from '@/lib/agents/pricing';
import { getPreset, getStore } from '@/lib/gcp/firestore';
import { expirePartialPause } from '@/lib/utils/takeover';

/** Order detail for the review screen, including the recomputed cost breakdown. */
export async function GET(_request: NextRequest, ctx: RouteContext<'/api/orders/[id]'>) {
  const { id } = await ctx.params;
  const store = getStore();
  const order = await store.getOrder(id);
  if (!order) return Response.json({ error: 'Order not found' }, { status: 404 });
  if (expirePartialPause(order)) await store.saveOrder(order);

  const [messages, inventory, preset] = await Promise.all([
    store.listMessages(id),
    store.listInventory(),
    getPreset(order.craft_category),
  ]);
  const bom = order.pattern_and_bom;
  const match = matchInventory(order.specifications.exterior_leather, bom.estimated_leather_sqft, inventory, preset);
  const breakdown = bom.components_breakdown.length
    ? computeQuotation(bom, order.material_sourcing, match.price_idr_per_sqft, preset)
    : null;
  const allocated = inventory.find((i) => i.stock_id === order.material_sourcing.allocated_stock_id) ?? null;

  return Response.json({ order, messages, breakdown, allocated_stock: allocated });
}
