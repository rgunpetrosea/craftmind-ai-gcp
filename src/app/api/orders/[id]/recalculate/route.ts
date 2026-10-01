import type { NextRequest } from 'next/server';
import { applyPresetDefaults, type DeepPartialSpec } from '@/lib/agents/intake-agent';
import { runPatternAgent, templatePattern } from '@/lib/agents/pattern-agent';
import { assembleQuote } from '@/lib/agents/pricing';
import { getPreset, getStore } from '@/lib/gcp/firestore';
import { getConstruction, normalizeSpecifications, requiredTopics, TOPICS } from '@/lib/spec/catalog';
import type { CraftCategory, Specifications } from '@/lib/types';

/**
 * Crafter correction + instant recalculation ("Recalculate BOM & Price").
 * Body: { specifications: <full or partial spec>, craft_category?, use_ai? }
 *
 * The crafter's edits replace the stored specification field by field (an explicit empty string or UNSPECIFIED clears a
 * field), the pattern pieces, SqFt, hardware, labor, stock match and quotation are recomputed, and the mockup, sketch and
 * conversation are left untouched. `use_ai: true` asks Gemini Pro for the pattern instead of the deterministic template.
 */
export async function POST(request: NextRequest, ctx: RouteContext<'/api/orders/[id]/recalculate'>) {
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as { specifications?: DeepPartialSpec; craft_category?: CraftCategory; use_ai?: boolean };
  if (!body.specifications) return Response.json({ error: 'specifications is required' }, { status: 400 });

  const store = getStore();
  const order = await store.getOrder(id);
  if (!order) return Response.json({ error: 'Order not found' }, { status: 404 });
  if (order.session_state === 'APPROVED') return Response.json({ error: 'Order already approved; it can no longer be edited' }, { status: 409 });

  // Field-level replace: the form sends every field, so a cleared input clears the stored value.
  const current = normalizeSpecifications(order.specifications);
  const inc = body.specifications;
  const edited = normalizeSpecifications({
    ...current,
    ...inc,
    dimensions_cm: { ...current.dimensions_cm, ...inc.dimensions_cm },
    pocket_layout: { ...current.pocket_layout, ...inc.pocket_layout },
    finish: { ...current.finish, ...inc.finish },
    customization: { ...current.customization, ...inc.customization },
  } as Partial<Specifications>);

  const def = getConstruction(edited.construction_type);
  const category = edited.construction_type !== 'UNSPECIFIED' ? def.category : (body.craft_category ?? order.craft_category);
  if (!edited.silhouette.trim() && edited.construction_type !== 'UNSPECIFIED') edited.silhouette = def.label;

  const missing = requiredTopics(edited).filter((t) => !TOPICS[t].isFilled(edited));
  if (missing.length) {
    return Response.json({ error: `Cannot calculate yet; still missing: ${missing.join(', ')}`, missing }, { status: 422 });
  }

  const preset = await getPreset(category);
  const spec = applyPresetDefaults(edited, preset);
  const [draft, inventory] = await Promise.all([
    body.use_ai ? runPatternAgent(spec, preset) : Promise.resolve(templatePattern(spec, preset)),
    store.listInventory(),
  ]);
  const quote = assembleQuote(draft, spec, inventory, preset);

  // Re-read so a takeover or message that arrived meanwhile is kept; only the fields owned by this action change.
  const latest = (await store.getOrder(id))!;
  const updated = {
    ...latest,
    craft_category: category,
    specifications: spec,
    material_sourcing: quote.material_sourcing,
    pattern_and_bom: quote.pattern_and_bom,
    session_state: latest.session_state === 'APPROVED' ? latest.session_state : ('PENDING_CRAFTER_APPROVAL' as const),
  };
  await store.saveOrder(updated);

  return Response.json({ order: updated, breakdown: quote.breakdown });
}
