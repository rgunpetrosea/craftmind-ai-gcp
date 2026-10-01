import { Type, type Schema } from '@google/genai';
import { generateStructured, isGeminiConfigured, MODEL_CHAINS } from '@/lib/gcp/gemini';
import { getConstruction, normalizeSpecifications } from '@/lib/spec/catalog';
import type { BomComponent, CategoryPreset, ConstructionType, Dimensions, PatternAndBom, Specifications } from '@/lib/types';
import { CM2_PER_SQFT, componentAreaCm2, netExteriorAreaCm2 } from '@/lib/utils/geometry';

/**
 * Agent 4 — 2D Component & BOM Breakdown.
 * Gemini Pro proposes the pattern pieces (falling back to Flash when Pro is out of quota); square
 * footage is always recomputed deterministically from the piece dimensions so the quote stays auditable.
 * `templatePattern` is the deterministic generator used offline and for the crafter's instant recalculation.
 */

export type PatternDraft = Omit<PatternAndBom, 'suggested_quotation_idr'>;

const r1 = (n: number) => Math.round(n * 10) / 10;
const dim = (a: number, b: number) => `${r1(a)} x ${r1(b)}`;

function dimsOf(spec: Specifications): Dimensions {
  const fallback = getConstruction(spec.construction_type).default_dimensions;
  const d = spec.dimensions_cm;
  return { length: d.length || fallback.length, width: d.width || fallback.width, height: d.height || fallback.height };
}

const HAS_ZIP_STRAP = {
  strapTypes: new Set<ConstructionType>(['SLING_BAG', 'CROSSBODY_CAMERA_BAG', 'MESSENGER_BAG', 'PADEL_RACKET_BAG', 'EXECUTIVE_BRIEFCASE']),
};

export function templateComponents(spec: Specifications): BomComponent[] {
  const s = normalizeSpecifications(spec);
  const def = getConstruction(s.construction_type);
  const { length: L, width: W, height: H } = dimsOf(s);
  const p = s.pocket_layout;
  const cards = p.front_slots + p.back_slots;
  const parts: BomComponent[] = [];
  const add = (part_name: string, qty: number, size: string) => qty > 0 && parts.push({ part_name, qty, dimensions_cm: size });
  const unlined = /tanpa|unlined|full-grain/i.test(s.lining_material);

  switch (def.family) {
    case 'CARD_HOLDER':
      add('Front panel', 1, dim(L, H));
      add('Back panel', 1, dim(L, H));
      add('Card slot pocket', cards, dim(L - 1, H * 0.4));
      add('Central cash pocket', p.central_pockets, dim(L - 1, H * 0.85));
      break;

    case 'WALLET': {
      const folds = s.construction_type === 'TRIFOLD_WALLET' ? 3 : 2;
      add('Exterior shell', 1, dim(L * folds, H));
      if (s.construction_type === 'ACCORDION_WALLET') add('Accordion gusset', 1, dim(L, H * 0.6));
      add('Card slot pocket', cards, dim(L - 1, H * 0.45));
      add('Cash compartment panel', p.cash_compartments, dim(L * 2 - 1, H - 0.5));
      add('ID window frame', p.id_window ? 1 : 0, dim(L - 2, H * 0.5));
      if (!unlined && s.lining_material.trim()) add('Interior lining', 1, dim(L * folds, H));
      break;
    }

    case 'ZIP_WALLET':
      add('Front panel', 1, dim(L, H));
      add('Back panel', 1, dim(L, H));
      add('Zipper gusset strip', 1, dim(L + 2 * H, 2.5));
      add('Card slot pocket', cards, dim(L - 1, H * 0.35));
      add('Cash divider panel', p.cash_compartments, dim(L - 1, H - 1));
      add('Coin pocket panel', p.coin_zip_pocket ? 2 : 0, dim(9, 7));
      if (!unlined && s.lining_material.trim()) add('Interior lining', 2, dim(L, H));
      break;

    case 'SHOE':
      add('Vamp', 2, dim(L, 18));
      add('Quarter (medial/lateral)', 4, dim(L * 0.9, 12));
      add('Tongue', 2, dim(14, 7));
      add('Insole', 2, dim(L - 1, 9));
      add('Heel counter stiffener', 2, dim(18, 7));
      add('Vamp lining', 2, dim(L, 18));
      add('Outsole', 2, dim(L + 2, 11));
      break;

    default: {
      const id = s.construction_type;
      add('Front panel', 1, dim(L, H));
      add('Back panel', 1, dim(L, H));
      add('Side gusset', 2, dim(W, H));
      add('Bottom panel', 1, dim(L, W));
      if (id === 'SLOUCHY_TOTE' || id === 'STRUCTURED_TOTE') add('Shoulder handle', 2, dim(60, 3.5));
      else if (id === 'BACKPACK' || id === 'HYBRID_BACKPACK_TOTE') {
        add('Backpack shoulder strap', 2, dim(70, 5));
        add('Top handle', id === 'HYBRID_BACKPACK_TOTE' ? 2 : 1, dim(40, 3.5));
      } else if (id === 'EXECUTIVE_BRIEFCASE') {
        add('Front flap', 1, dim(L, H * 0.5));
        add('Top handle', 1, dim(32, 4));
        add('Corner reinforcement (salpa)', 1, dim(L, 6));
        if (s.finish.strap.trim()) add('Shoulder strap', 1, dim(120, 4));
      } else if (id === 'PADEL_RACKET_BAG') {
        add('Front flap', 1, dim(L, H * 0.25));
        add('Shoulder strap', 1, dim(120, 4));
        add('Foam padding panel', 2, dim(L, H));
      } else if (id === 'CLUTCH') {
        add('Front flap', 1, dim(L, H * 0.5));
      } else {
        // sling / crossbody / messenger / other
        add('Front flap', 1, dim(L, H * (id === 'MESSENGER_BAG' ? 0.7 : 0.6)));
        add('Shoulder strap', 1, dim(120, 3.5));
      }
      add('Exterior slip pocket', p.exterior_pockets, dim(L * 0.6, H * 0.5));
      add('Zip pocket lining', p.interior_zip_pockets, dim(20, 15));
      if (id !== 'PADEL_RACKET_BAG') {
        add('Lining body', 2, dim(L, H));
        add('Lining gusset', 2, dim(W, H));
      }
    }
  }
  return parts;
}

export function computeLeatherSqft(components: BomComponent[], wastagePct: number): number {
  return r1((netExteriorAreaCm2(components) * (1 + wastagePct)) / CM2_PER_SQFT);
}

export function defaultHardware(spec: Specifications): string[] {
  const s = normalizeSpecifications(spec);
  const def = getConstruction(s.construction_type);
  const text = `${s.finish.hardware_notes} ${s.finish.zipper} ${s.silhouette}`.toLowerCase();
  const brass = /brass|kuningan/.test(text);
  const hw: string[] = [];

  if (def.family === 'SHOE') return ['Waxed cotton laces (pair)', 'Brass eyelets x10', 'Steel shank x2', 'Leather heel stack x2'];

  const zips = s.pocket_layout.interior_zip_pockets + (s.pocket_layout.coin_zip_pocket ? 1 : 0) + (def.family === 'ZIP_WALLET' ? 1 : 0);
  if (zips > 0) hw.push(`${s.finish.zipper && s.finish.zipper !== 'ikut standar workshop' ? s.finish.zipper : 'YKK zipper'} x${zips}`);

  if (def.family === 'CARD_HOLDER') return hw;
  if (def.family === 'WALLET' || def.family === 'ZIP_WALLET') return /snap|kancing/.test(text) ? [...hw, 'Snap button (brass)'] : hw;

  hw.unshift(/turn.?lock|kunci putar/.test(text) ? 'Turn-lock clasp (gold)' : def.id === 'EXECUTIVE_BRIEFCASE' && brass ? 'Solid brass buckle x2' : 'Magnetic snap closure');
  hw.push('Brass rivets x4');
  if (HAS_ZIP_STRAP.strapTypes.has(def.id) || /strap|tali/.test(s.finish.strap.toLowerCase())) hw.push(brass ? 'Solid brass D-ring x2' : 'D-ring x2', 'Swivel snap hook x2');
  if (def.id === 'PADEL_RACKET_BAG') hw.push('Heavy-duty carabiner clip x2');
  if (def.id === 'MESSENGER_BAG' || def.id === 'SLING_BAG') hw.push('Strap adjuster buckle');
  hw.push('Base feet studs x4');
  return hw;
}

/** Hours relative to the preset's category baseline. */
const LABOR_FACTOR: Partial<Record<ConstructionType, number>> = {
  FLAT_CARD_HOLDER: 0.5,
  PATTERNED_CARD_HOLDER: 0.6,
  BIFOLD_WALLET: 1,
  TRIFOLD_WALLET: 1.2,
  ACCORDION_WALLET: 1.2,
  ZIP_AROUND_LONG_WALLET: 1.6,
  CLUTCH: 0.6,
  SLOUCHY_TOTE: 0.8,
  STRUCTURED_TOTE: 0.9,
  CROSSBODY_CAMERA_BAG: 0.8,
  MESSENGER_BAG: 0.85,
  PADEL_RACKET_BAG: 1,
  BACKPACK: 1.4,
  HYBRID_BACKPACK_TOTE: 1.3,
  EXECUTIVE_BRIEFCASE: 1.45,
};

export function estimateLaborHours(preset: CategoryPreset, components: BomComponent[], spec: Specifications): number {
  const s = normalizeSpecifications(spec);
  const def = getConstruction(s.construction_type);
  const reference = templateComponents({ ...s, dimensions_cm: def.default_dimensions, pocket_layout: { ...s.pocket_layout, ...def.default_pockets } });
  const refArea = reference.reduce((sum, c) => sum + componentAreaCm2(c), 0) || 1;
  const area = components.reduce((sum, c) => sum + componentAreaCm2(c), 0);
  const sizeFactor = Math.min(1.6, Math.max(0.7, area / refArea));
  const handStitched = /hand|tangan|manual|saddle/i.test(`${s.stitching_method} ${s.finish.stitch_pattern}`) ? 1 : 0.75;

  let hours = preset.base_labor_hours * (LABOR_FACTOR[def.id] ?? 1) * sizeFactor * handStitched;
  if (s.customization.type === 'EMBOSS_INITIALS' || s.customization.type === 'EMBOSS_LOGO') hours += 0.5;
  if (s.customization.type === 'LASER_ENGRAVING') hours += 1;
  if (s.pocket_layout.id_window) hours += 0.5;
  hours += 0.75 * (s.pocket_layout.interior_zip_pockets + (s.pocket_layout.coin_zip_pocket ? 1 : 0) + (def.family === 'ZIP_WALLET' ? 1 : 0));
  return Math.max(1, Math.round(hours * 2) / 2);
}

export function templatePattern(spec: Specifications, preset: CategoryPreset): PatternDraft {
  const components = templateComponents(spec);
  return {
    components_breakdown: components,
    estimated_leather_sqft: computeLeatherSqft(components, preset.wastage_pct),
    hardware_list: defaultHardware(spec),
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
          part_name: { type: Type.STRING, description: 'Pattern piece name. Include "Lining", "Foam" or "Padding" in the name for non-exterior pieces.' },
          qty: { type: Type.INTEGER },
          dimensions_cm: { type: Type.STRING, description: 'Flat cut size "L x W" in cm, including seam allowance.' },
        },
        required: ['part_name', 'qty', 'dimensions_cm'],
      },
    },
    hardware_list: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Each entry ends with " xN" when quantity > 1.' },
    estimated_labor_hours: { type: Type.NUMBER },
  },
  required: ['components_breakdown', 'hardware_list', 'estimated_labor_hours'],
};

const SYSTEM_INSTRUCTION = `You are a master leather pattern maker.
Break the requested item into flat 2D pattern pieces as a leathercrafter would cut them.
- Obey the construction_type exactly: a FLAT_CARD_HOLDER is a single flat sleeve with NO fold (front panel, back panel, slot pockets,
  optional central pocket); a BIFOLD folds once; a TRIFOLD twice; an ACCORDION has a pleated gusset.
- Respect pocket_layout exactly: one pocket piece per requested slot / compartment / zip pocket, no more and no fewer.
- Use rectangular bounding boxes, add 0.5 cm seam allowance where pieces are stitched, list hardware (zippers, buckles, rivets) with quantities,
  and honour finish.zipper / finish.hardware_notes / finish.strap.
- Labor hours assume one skilled crafter; add time for embossing, laser engraving, zippers and ID windows.`;

export async function runPatternAgent(spec: Specifications, preset: CategoryPreset): Promise<PatternDraft> {
  if (!isGeminiConfigured()) return templatePattern(spec, preset);

  try {
    const draft = await generateStructured<Omit<PatternDraft, 'estimated_leather_sqft'>>({
      models: MODEL_CHAINS.pro,
      systemInstruction: SYSTEM_INSTRUCTION,
      schema: PATTERN_SCHEMA,
      parts: [{ text: `Category: ${preset.label}\nSpecifications:\n${JSON.stringify({ ...spec, dimensions_cm: dimsOf(spec) }, null, 2)}` }],
    });
    const components = draft.components_breakdown.filter((c) => c.qty > 0);
    const sqft = computeLeatherSqft(components, preset.wastage_pct);
    if (!components.length || sqft === 0) return templatePattern(spec, preset);
    return {
      components_breakdown: components,
      estimated_leather_sqft: sqft,
      hardware_list: draft.hardware_list,
      estimated_labor_hours: r1(draft.estimated_labor_hours || estimateLaborHours(preset, components, spec)),
    };
  } catch (err) {
    console.warn('[pattern-agent] Gemini failed, using template breakdown:', err);
    return templatePattern(spec, preset);
  }
}
