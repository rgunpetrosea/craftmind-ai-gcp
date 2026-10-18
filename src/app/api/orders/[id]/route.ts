import type { NextRequest } from 'next/server';
import { designRiskFlags } from '@/lib/agents/direction-agent';
import { matchInventory } from '@/lib/agents/inventory-agent';
import { computeQuotation } from '@/lib/agents/pricing';
import { orderHidden } from '@/lib/auth';
import { getPreset, getStore } from '@/lib/gcp/firestore';
import { isRenderingAngles } from '@/lib/mockups';
import { isConceptRendering } from '@/lib/agents/tools';
import { aiRenderCap, SESSION_TURN_CAP } from '@/lib/spec/guardrails';
import { primaryMaterial } from '@/lib/spec/describe';
import { expirePartialPause } from '@/lib/utils/takeover';

/** Order detail for the review screen, including the recomputed cost breakdown. */
export async function GET(request: NextRequest, ctx: RouteContext<'/api/orders/[id]'>) {
  const { id } = await ctx.params;
  const store = getStore();
  const order = await store.getOrder(id);
  // another workspace's order is invisible to a logged-in crafter
  if (!order || orderHidden(request, order)) return Response.json({ error: 'Order not found' }, { status: 404 });
  if (expirePartialPause(order)) await store.saveOrder(order);

  const [messages, inventory, preset] = await Promise.all([
    store.listMessages(id),
    store.listInventory(order.crafter_id),
    getPreset(order.craft_category, order.crafter_id),
  ]);
  const bom = order.pattern_and_bom;
  const match = matchInventory(primaryMaterial(order.specifications), bom.estimated_material_sqft, inventory, preset);
  const breakdown = bom.components_breakdown.length
    ? computeQuotation(bom, order.material_sourcing, match.price_idr_per_sqft, preset, order.specifications)
    : null;
  const allocated = inventory.find((i) => i.stock_id === order.material_sourcing.allocated_stock_id) ?? null;

  const budget = {
    turns_used: order.intake?.session_turn_count ?? 0,
    turn_cap: SESSION_TURN_CAP,
    renders_used: order.intake?.mockup_render_count ?? 0,
    render_cap: aiRenderCap(order.specifications),
  };
  // design contradictions (premium + synthetic, undersized laptop bag...) for the review screen and the QA runner
  const clientText = messages.filter((m) => m.sender === 'CLIENT' && m.text).map((m) => m.text).join('\n');
  const risk_flags = designRiskFlags(order.specifications, clientText);
  // full critic audit log (the order keeps only the latest passes)
  const critic_reviews = await store.listCriticReviews(id);
  return Response.json({ order, messages, breakdown, allocated_stock: allocated, rendering_angles: isRenderingAngles(id) || isConceptRendering(id), budget, risk_flags, critic_reviews });
}
