import type { NextRequest } from 'next/server';
import { runPatternAgent, templatePattern } from '@/lib/agents/pattern-agent';
import { assembleQuote } from '@/lib/agents/pricing';
import { getPreset, getStore } from '@/lib/gcp/firestore';
import { finalizeSpecifications, missingRequired, normalizeSpecifications } from '@/lib/spec/catalog';
import type { Specifications } from '@/lib/types';

/**
 * Crafter correction + instant recalculation ("Recalculate BOM & Price").
 * Body: { specifications: <full spec of any category>, use_ai? }
 *
 * The posted spec replaces the stored one (the crafter may also switch category; attributes are normalized to that
 * category's schema, so nothing from the previous category leaks through). Pattern pieces, material sqft, hardware,
 * labor, stock match and quotation are recomputed; mockup, sketch and conversation are untouched.
 * `use_ai: true` asks Gemini Pro for the pattern instead of the deterministic template.
 */
export async function POST(request: NextRequest, ctx: RouteContext<'/api/orders/[id]/recalculate'>) {
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as { specifications?: Specifications; use_ai?: boolean };
  if (!body.specifications) return Response.json({ error: 'specifications is required' }, { status: 400 });

  const store = getStore();
  const order = await store.getOrder(id);
  if (!order) return Response.json({ error: 'Order not found' }, { status: 404 });
  if (order.session_state === 'APPROVED') return Response.json({ error: 'Order already approved; it can no longer be edited' }, { status: 409 });

  const edited = normalizeSpecifications(body.specifications);
  const missing = missingRequired(edited, order.intake);
  if (missing.length) {
    return Response.json({ error: `Cannot calculate yet; still missing: ${missing.map((t) => t.label).join(', ')}`, missing: missing.map((t) => t.id) }, { status: 422 });
  }

  const preset = await getPreset(edited.category);
  const spec = finalizeSpecifications(edited, preset.defaults);
  const [draft, inventory] = await Promise.all([
    body.use_ai ? runPatternAgent(spec, preset) : Promise.resolve(templatePattern(spec, preset)),
    store.listInventory(),
  ]);
  const quote = assembleQuote(draft, spec, inventory, preset);

  // Re-read so a takeover or message that arrived meanwhile is kept; only the fields owned by this action change.
  const latest = (await store.getOrder(id))!;
  const updated = {
    ...latest,
    craft_category: spec.category,
    specifications: spec,
    material_sourcing: quote.material_sourcing,
    pattern_and_bom: quote.pattern_and_bom,
    session_state: 'PENDING_CRAFTER_APPROVAL' as const,
  };
  await store.saveOrder(updated);
  return Response.json({ order: updated, breakdown: quote.breakdown });
}
