import { Type, type Schema } from '@google/genai';
import { generateStructured, isGeminiConfigured, MODELS } from '@/lib/gcp/gemini';
import type { BomComponent, CategoryPreset, CraftCategory, Dimensions, PatternAndBom, Specifications } from '@/lib/types';
import { CM2_PER_SQFT, componentAreaCm2, netExteriorAreaCm2 } from '@/lib/utils/geometry';

/**
 * Agent 4 — 2D Component & BOM Breakdown.
 * Gemini Pro proposes the pattern pieces; square footage is always recomputed
 * deterministically from the piece dimensions so the quote stays auditable.
 */

const DEFAULT_DIMENSIONS: Record<CraftCategory, Dimensions> = {
  bespoke_bag: { length: 30, width: 12, height: 22 },
  bespoke_wallet: { length: 11, width: 2, height: 9 },
  bespoke_shoes: { length: 28, width: 10, height: 12 },
};

export type PatternDraft = Omit<PatternAndBom, 'suggested_quotation_idr'>;

function withDefaults(category: CraftCategory, d: Dimensions): Dimensions {
  const fallback = DEFAULT_DIMENSIONS[category];
  return {
    length: d.length || fallback.length,
    width: d.width || fallback.width,
    height: d.height || fallback.height,
  };
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const dim = (a: number, b: number) => `${r1(a)} x ${r1(b)}`;

export function templateComponents(category: CraftCategory, spec: Specifications): BomComponent[] {
  const { length: L, width: W, height: H } = withDefaults(category, spec.dimensions_cm);
  const text = `${spec.silhouette} ${spec.target_capacity}`.toLowerCase();

  if (category === 'bespoke_wallet') {
    return [
      { part_name: 'Exterior shell', qty: 1, dimensions_cm: dim(L * 2, H) },
      { part_name: 'Card slot pocket', qty: 4, dimensions_cm: dim(L - 1, H * 0.55) },
      { part_name: 'Bill compartment panel', qty: 1, dimensions_cm: dim(L * 2 - 1, H - 0.5) },
    ];
  }

  if (category === 'bespoke_shoes') {
    return [
      { part_name: 'Vamp', qty: 2, dimensions_cm: dim(L, 18) },
      { part_name: 'Quarter (medial/lateral)', qty: 4, dimensions_cm: dim(L * 0.9, 12) },
      { part_name: 'Tongue', qty: 2, dimensions_cm: dim(14, 7) },
      { part_name: 'Insole', qty: 2, dimensions_cm: dim(L - 1, 9) },
      { part_name: 'Heel counter stiffener', qty: 2, dimensions_cm: dim(18, 7) },
      { part_name: 'Vamp lining', qty: 2, dimensions_cm: dim(L, 18) },
      { part_name: 'Outsole', qty: 2, dimensions_cm: dim(L + 2, 11) },
    ];
  }

  const parts: BomComponent[] = [
    { part_name: 'Front panel', qty: 1, dimensions_cm: dim(L, H) },
    { part_name: 'Back panel', qty: 1, dimensions_cm: dim(L, H) },
    { part_name: 'Side gusset', qty: 2, dimensions_cm: dim(W, H) },
    { part_name: 'Bottom panel', qty: 1, dimensions_cm: dim(L, W) },
    { part_name: 'Top handle', qty: 1, dimensions_cm: dim(32, 4) },
  ];
  // Open-top silhouettes skip the flap; everything else is assumed to close with one.
  if (!/tote|bucket/.test(text)) {
    parts.push({ part_name: 'Front flap', qty: 1, dimensions_cm: dim(L, H * 0.6) });
  }
  if (/sling|shoulder|crossbody|selempang|bahu/.test(text)) {
    parts.push({ part_name: 'Shoulder strap', qty: 1, dimensions_cm: dim(120, 3.5) });
  }
  parts.push({ part_name: 'Lining body', qty: 2, dimensions_cm: dim(L, H) });
  parts.push({ part_name: 'Lining gusset', qty: 2, dimensions_cm: dim(W, H) });
  return parts;
}

export function computeLeatherSqft(components: BomComponent[], wastagePct: number): number {
  return r1((netExteriorAreaCm2(components) * (1 + wastagePct)) / CM2_PER_SQFT);
}

export function defaultHardware(category: CraftCategory, spec: Specifications): string[] {
  const text = Object.values(spec).join(' ').toLowerCase();
  if (category === 'bespoke_shoes') return ['Waxed cotton laces (pair)', 'Brass eyelets x10', 'Steel shank x2', 'Leather heel stack x2'];
  if (category === 'bespoke_wallet') return /snap|kancing/.test(text) ? ['Snap button (brass)'] : [];
  const hw = ['D-ring x2', 'Brass rivets x4', 'Base feet studs x4'];
  hw.unshift(/turn.?lock|kunci putar/.test(text) ? 'Turn-lock clasp (gold)' : 'Magnetic snap closure');
  if (/sling|shoulder|crossbody|selempang|bahu/.test(text)) hw.push('Swivel snap hook x2', 'Strap adjuster buckle');
  return hw;
}

export function estimateLaborHours(preset: CategoryPreset, components: BomComponent[], spec: Specifications): number {
  const reference = templateComponents(preset.category, { ...spec, dimensions_cm: DEFAULT_DIMENSIONS[preset.category] });
  const refArea = reference.reduce((s, c) => s + componentAreaCm2(c), 0) || 1;
  const area = components.reduce((s, c) => s + componentAreaCm2(c), 0);
  const sizeFactor = Math.min(1.6, Math.max(0.7, area / refArea));
  const handStitched = /hand|tangan|saddle/i.test(spec.stitching_method) ? 1 : 0.7;
  return Math.round(preset.base_labor_hours * sizeFactor * handStitched * 2) / 2;
}

export function templatePattern(category: CraftCategory, spec: Specifications, preset: CategoryPreset): PatternDraft {
  const components = templateComponents(category, spec);
  return {
    components_breakdown: components,
    estimated_leather_sqft: computeLeatherSqft(components, preset.wastage_pct),
    hardware_list: defaultHardware(category, spec),
    estimated_labor_hours: estimateLaborHours(preset, components, spec),
  };
}

const PATTERN_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    components_breakdown: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          part_name: { type: Type.STRING, description: 'Pattern piece name. Include the word "Lining" for lining pieces.' },
          qty: { type: Type.INTEGER },
          dimensions_cm: { type: Type.STRING, description: 'Flat cut size "L x W" in cm, including seam allowance.' },
        },
        required: ['part_name', 'qty', 'dimensions_cm'],
      },
    },
    hardware_list: { type: Type.ARRAY, items: { type: Type.STRING } },
    estimated_labor_hours: { type: Type.NUMBER },
  },
  required: ['components_breakdown', 'hardware_list', 'estimated_labor_hours'],
};

const SYSTEM_INSTRUCTION = `You are a master leather pattern maker.
Break the requested item into flat 2D pattern pieces as a leathercrafter would cut them.
Use rectangular bounding boxes for every piece, add 0.5 cm seam allowance where pieces are stitched,
and list hardware with quantities. Labor hours assume a single skilled crafter.`;

export async function runPatternAgent(
  category: CraftCategory,
  spec: Specifications,
  preset: CategoryPreset,
): Promise<PatternDraft> {
  if (!isGeminiConfigured()) return templatePattern(category, spec, preset);

  try {
    const draft = await generateStructured<Omit<PatternDraft, 'estimated_leather_sqft'>>({
      model: MODELS.pro,
      systemInstruction: SYSTEM_INSTRUCTION,
      schema: PATTERN_SCHEMA,
      parts: [{ text: `Category: ${preset.label}\nSpecifications:\n${JSON.stringify(withDefaultDims(category, spec), null, 2)}` }],
    });
    const components = draft.components_breakdown.filter((c) => c.qty > 0);
    const sqft = computeLeatherSqft(components, preset.wastage_pct);
    if (!components.length || sqft === 0) return templatePattern(category, spec, preset);
    return {
      components_breakdown: components,
      estimated_leather_sqft: sqft,
      hardware_list: draft.hardware_list,
      estimated_labor_hours: r1(draft.estimated_labor_hours || estimateLaborHours(preset, components, spec)),
    };
  } catch (err) {
    console.warn('[pattern-agent] Gemini Pro failed, using template breakdown:', err);
    return templatePattern(category, spec, preset);
  }
}

function withDefaultDims(category: CraftCategory, spec: Specifications): Specifications {
  return { ...spec, dimensions_cm: withDefaults(category, spec.dimensions_cm) };
}
