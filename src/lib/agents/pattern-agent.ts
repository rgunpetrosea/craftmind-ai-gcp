import { Type, type Schema } from '@google/genai';
import { generateStructured, isGeminiConfigured, MODEL_CHAINS } from '@/lib/gcp/gemini';
import { bagHasStrap } from '@/lib/spec/categories/bag';
import { isBuiltInFurniture, isFullHeightBuiltIn } from '@/lib/spec/categories/furniture';
import { constructionDef, normalizeSpecifications, schemaOf } from '@/lib/spec/catalog';
import { specLines } from '@/lib/spec/describe';
import type { BomComponent, CategoryPreset, Dimensions, PatternAndBom, Specifications } from '@/lib/types';
import { CM2_PER_SQFT, componentAreaCm2, netPrimaryAreaCm2 } from '@/lib/utils/geometry';

/**
 * Agent 4 — 2D component / cut-list & BOM breakdown, one template per category.
 * Gemini Pro proposes the pieces (falling back to Flash when Pro is out of quota); material sqft is always recomputed
 * deterministically from piece dimensions so the quote stays auditable. `templatePattern` is the deterministic generator
 * used offline and by the crafter's instant "Recalculate BOM & Price".
 */

export type PatternDraft = Omit<PatternAndBom, 'suggested_quotation_idr'>;

const r1 = (n: number) => Math.round(n * 10) / 10;
const dim = (a: number, b: number) => `${r1(a)} x ${r1(b)}`;
const hasUpholstery = (s: string) => s.trim() !== '' && !/^(tanpa|none|no)\b/i.test(s);

function dimsOf(spec: Specifications): Dimensions {
  const fallback = (constructionDef(spec.construction_type)?.defaults as { dimensions_cm?: Dimensions } | undefined)?.dimensions_cm ?? {
    length: 30,
    width: 12,
    height: 25,
  };
  const d = (spec.attributes as { dimensions_cm?: Dimensions }).dimensions_cm ?? { length: 0, width: 0, height: 0 };
  return { length: d.length || fallback.length, width: d.width || fallback.width, height: d.height || fallback.height };
}

type Add = (part_name: string, qty: number, size: string) => void;

function smallGoods(spec: Extract<Specifications, { category: 'SMALL_GOODS' }>, add: Add) {
  const a = spec.attributes;
  const { length: L, height: H } = dimsOf(spec);
  const cards = a.front_slots + a.back_slots;
  const lined = a.lining.trim() !== '' && !/tanpa|unlined/i.test(a.lining);
  switch (spec.construction_type) {
    case 'FLAT_CARD_HOLDER':
    case 'PATTERNED_CARD_HOLDER':
      add('Front panel', 1, dim(L, H));
      add('Back panel', 1, dim(L, H));
      add('Card slot pocket', cards, dim(L - 1, H * 0.4));
      add('Central cash pocket', a.central_pockets, dim(L - 1, H * 0.85));
      if (lined) add(`Interior lining — ${a.lining}`, 2, dim(L, H));
      return;
    case 'ZIP_AROUND_LONG_WALLET':
      add('Front panel', 1, dim(L, H));
      add('Back panel', 1, dim(L, H));
      add('Zipper gusset strip', 1, dim(L + 2 * H, 2.5));
      add('Card slot pocket', cards, dim(L - 1, H * 0.35));
      add('Cash divider panel', a.cash_compartments, dim(L - 1, H - 1));
      add('Coin pocket panel', a.coin_zip_pocket ? 2 : 0, dim(9, 7));
      if (lined) add('Interior lining', 2, dim(L, H));
      return;
    case 'KEY_POUCH':
      add('Body panel', 2, dim(L, H));
      add('Key ring tab', 1, dim(6, 2));
      return;
    default: {
      const folds = spec.construction_type === 'TRIFOLD_WALLET' ? 3 : 2;
      add('Exterior shell', 1, dim(L * folds, H));
      if (spec.construction_type === 'ACCORDION_WALLET') add('Accordion gusset', 1, dim(L, H * 0.6));
      // a tall long bifold stacks short pockets down each half instead of half-height ones
      add('Card slot pocket', cards, dim(L - 1, spec.construction_type === 'LONG_BIFOLD_WALLET' ? 6.5 : H * 0.45));
      add('Cash compartment panel', a.cash_compartments, dim(L * 2 - 1, H - 0.5));
      add('ID window frame', a.id_window ? 1 : 0, dim(L - 2, H * 0.5));
      if (lined) add('Interior lining', 1, dim(L * folds, H));
    }
  }
}

function bag(spec: Extract<Specifications, { category: 'BAG' }>, add: Add) {
  const a = spec.attributes;
  const { length: L, width: W0, height: H } = dimsOf(spec);
  const W = a.gusset_depth_cm || W0;
  const id = spec.construction_type;
  add('Front panel', 1, dim(L, H));
  add('Back panel', 1, dim(L, H));
  add('Side gusset', 2, dim(W, H));
  add('Bottom panel', 1, dim(L, W));
  if (['MAGNETIC_FLAP', 'TURN_LOCK_FLAP', 'BUCKLE_FLAP'].includes(a.main_closure)) add('Front flap', 1, dim(L, H * (id === 'MESSENGER_BAG' ? 0.7 : 0.6)));
  if (a.main_closure === 'ZIPPER') add('Zipper panel', 2, dim(L, 3));
  if (a.strap_type === 'BACKPACK_STRAPS' || a.strap_type === 'CONVERTIBLE') add('Backpack shoulder strap', 2, dim(70, 5));
  else if (bagHasStrap(a)) add(a.strap_type === 'WEBBING' ? 'Webbing strap (other material)' : 'Shoulder strap', 1, dim(120, 3.5));
  if (['SLOUCHY_TOTE', 'STRUCTURED_TOTE', 'HYBRID_BACKPACK_TOTE'].includes(id)) add('Shoulder handle', 2, dim(60, 3.5));
  else if (id === 'TOP_HANDLE_BAG') add('Rolled top handle', 2, dim(28, 5));
  else if (a.strap_type !== 'NONE') add('Top handle', 1, dim(32, 4));
  if (a.structure === 'RIGID') add('Reinforcement salpa (other material)', 1, dim(L, H));
  if (a.padding.trim()) add('Foam padding panel', 2, dim(L, H));
  add('Exterior slip pocket', a.exterior_pockets, dim(L * 0.6, H * 0.5));
  add('Zip pocket lining', a.interior_zip_pockets, dim(20, 15));
  if (!/tanpa|unlined/i.test(a.lining)) {
    add('Lining body', 2, dim(L, H));
    add('Lining gusset', 2, dim(W, H));
  }
}

function footwear(spec: Extract<Specifications, { category: 'FOOTWEAR' }>, add: Add) {
  const a = spec.attributes;
  // EU size ≈ 1.5 × foot length (cm) + 2; the last adds ~1.5 cm
  const L = a.eu_size > 0 ? r1((a.eu_size - 2) / 1.5 + 1.5) : 28;
  const boot = spec.construction_type === 'CHELSEA_BOOTS';
  add('Vamp', 2, dim(L, boot ? 22 : 18));
  if (spec.construction_type !== 'LOAFERS' && spec.construction_type !== 'SANDALS') add('Quarter (medial/lateral)', 4, dim(L * 0.9, boot ? 20 : 12));
  if (boot) add('Elastic gusset', 4, dim(10, 8));
  if (spec.construction_type === 'DERBY_SHOES' || spec.construction_type === 'OXFORD_SHOES') add('Tongue', 2, dim(14, 7));
  add('Insole', 2, dim(L - 1, 9));
  add('Heel counter stiffener', 2, dim(18, 7));
  add('Vamp lining', 2, dim(L, boot ? 22 : 18));
  if (a.welt_method === 'GOODYEAR' || a.welt_method === 'STITCHDOWN') add('Welt strip', 2, dim(L * 2.2, 1.5));
  add('Outsole', 2, dim(L + 2, 11));
  if (a.heel_height_cm > 0) add('Heel stack lift', Math.max(2, Math.round(a.heel_height_cm / 0.6)), dim(7, 7));
}

/** Kitchen standard heights (cm): base cabinets incl. plinth, splashback gap, standard wall cabinets. */
const KITCHEN = { base: 85, splash: 60, upper: 80, fridgeBay: 100 };

/**
 * Total linear run of a kitchen: L-shape = L1 + L2 - one corner overlap (the depth), U-shape = L1 + 2 x L2 - two
 * corners, galley = both runs, straight = L1. "300 + 200 - 60 = 440 cm" for an L.
 */
export function kitchenRun(spec: Extract<Specifications, { category: 'FURNITURE' }>): number {
  const { length: L1, width: W } = dimsOf(spec);
  const L2 = spec.attributes.second_wall_cm;
  switch (spec.attributes.layout_shape) {
    case 'L_SHAPE':
      return L2 > 0 ? L1 + L2 - W : L1;
    case 'U_SHAPE':
      return L2 > 0 ? L1 + 2 * L2 - 2 * W : L1;
    case 'GALLEY':
      return L2 > 0 ? L1 + L2 : L1;
    default:
      return L1;
  }
}

const hasFridge = (spec: Extract<Specifications, { category: 'FURNITURE' }>) =>
  /kulkas|lemari es|refrigerator|fridge/i.test(`${spec.attributes.appliances} ${spec.attributes.layout_notes}`);

/**
 * Door / drawer layout of built-in cabinetry, shared by the cut list and the hardware list.
 * Kitchen: the cabinet run is the aggregated wall run minus the fridge bay (when a fridge is built in), in 60 cm modules
 * (door + drawer stack every other module) under 60 cm wall modules. Wall cabinets are 80 cm, or run up to the ceiling
 * when `floor_to_ceiling` is set or the overall height reaches 240 cm. Wardrobe: 100 cm two-door modules. TV console:
 * 2 drawers + 2 flap doors.
 */
function builtInLayout(spec: Extract<Specifications, { category: 'FURNITURE' }>) {
  const { length: L, width: W, height: H } = dimsOf(spec);
  switch (spec.construction_type) {
    case 'KITCHEN_SET': {
      const run = kitchenRun(spec);
      const fridge = hasFridge(spec);
      const cabinetRun = Math.max(60, run - (fridge ? KITCHEN.fridgeBay : 0));
      const modules = Math.max(1, Math.ceil(cabinetRun / 60));
      const fullHeight = isFullHeightBuiltIn(spec);
      const upperH = fullHeight ? Math.max(KITCHEN.upper, H - KITCHEN.base - KITCHEN.splash) : KITCHEN.upper;
      const drawers = Math.ceil(modules / 2) * 3;
      return { L: run, W, H, modules, upperH, doors: modules * 2 - Math.ceil(modules / 2) + (fridge ? 1 : 0), drawers, cabinetRun, fridge, fullHeight };
    }
    case 'WARDROBE': {
      const modules = Math.max(1, Math.ceil(L / 100));
      return { L, W, H, modules, upperH: 0, doors: modules * 2, drawers: modules, cabinetRun: L, fridge: false, fullHeight: true };
    }
    default:
      return { L, W, H, modules: 2, upperH: 0, doors: 2, drawers: 2, cabinetRun: L, fridge: false, fullHeight: false };
  }
}

function builtInCabinetry(spec: Extract<Specifications, { category: 'FURNITURE' }>, add: Add) {
  const { L, W, H, modules, upperH, drawers, cabinetRun, fridge, fullHeight } = builtInLayout(spec);
  switch (spec.construction_type) {
    case 'KITCHEN_SET': {
      // cabinet runs over the aggregated length (both walls of an L, minus the corner overlap and the fridge bay)
      const run = cabinetRun;
      const m = run / modules;
      add('Base cabinet side / divider panel', modules + 1, dim(KITCHEN.base, W));
      add('Base cabinet bottom', 1, dim(run, W));
      add('Base cabinet shelf', modules, dim(m - 2, W - 5));
      add('Base cabinet door', modules - Math.ceil(modules / 2), dim(m, 72));
      add('Drawer front & box', drawers, dim(m, 24));
      add('Kick plinth', 1, dim(run, 10));
      add(`Wall cabinet side / divider panel${fullHeight ? ' (full height to ceiling)' : ''}`, modules + 1, dim(upperH, 35));
      add('Wall cabinet top & bottom', 2, dim(run, 35));
      add(`Wall cabinet door${fullHeight ? ' (full height to ceiling)' : ''}`, modules, dim(m, upperH));
      add('Back panel (plywood 9mm)', 2, dim(run, Math.max(KITCHEN.base, upperH)));
      if (spec.attributes.layout_shape === 'L_SHAPE' || spec.attributes.layout_shape === 'U_SHAPE') {
        add('Corner base unit blind panel', spec.attributes.layout_shape === 'U_SHAPE' ? 2 : 1, dim(W, KITCHEN.base));
      }
      if (fridge) {
        // tall enclosure around a built-in fridge: two full-height side panels + a bridge cabinet over the fridge
        add('Tall cabinet enclosure panel (fridge)', 2, dim(H, W));
        add('Top bridging panel (fridge bridge cabinet)', 2, dim(KITCHEN.fridgeBay - 4, W));
        if (H - 190 > 20) add('Bridge cabinet door', 1, dim(KITCHEN.fridgeBay - 4, H - 190));
      } else if (/oven/i.test(spec.attributes.appliances)) add('Tall unit side panel (oven)', 2, dim(H, W));
      break;
    }
    case 'WARDROBE': {
      const m = L / modules;
      add('Side & divider panel', modules + 1, dim(H, W));
      add('Top & bottom board', 2, dim(L, W));
      add('Shelf board', modules * 4, dim(m - 2, W - 5));
      add('Door', modules * 2, dim(m / 2, H - 12));
      add('Drawer front & box', drawers, dim(m - 4, 22));
      add('Back panel (plywood 9mm)', 1, dim(L, H));
      add('Plinth', 1, dim(L, 10));
      break;
    }
    default: {
      // TV console
      add('Top board', 1, dim(L, W));
      add('Bottom board', 1, dim(L, W));
      add('Side & divider panel', 3, dim(H, W));
      add('Drawer front & box', drawers, dim(L / 2 - 2, 18));
      add('Flap door', 2, dim(L / 2 - 2, H - 22));
      add('Back panel (plywood 9mm)', 1, dim(L, H));
    }
  }
}

function furniture(spec: Extract<Specifications, { category: 'FURNITURE' }>, add: Add) {
  const a = spec.attributes;
  const { length: L, width: W, height: H } = dimsOf(spec);
  const leg = 7;
  switch (spec.construction_type) {
    case 'KITCHEN_SET':
    case 'WARDROBE':
    case 'TV_CONSOLE':
      builtInCabinetry(spec, add);
      return;
    case 'CHAIR':
    case 'STOOL':
      add('Seat panel', 1, dim(L, W));
      add('Leg', 4, dim(spec.construction_type === 'CHAIR' ? 45 : H, leg));
      add('Seat rail / apron', 4, dim(L, 6));
      add('Stretcher', 2, dim(L, 3));
      if (spec.construction_type === 'CHAIR') {
        add('Back leg & post', 2, dim(H, 5));
        add('Back rest panel', 1, dim(L, 15));
      }
      break;
    case 'BENCH':
      add('Seat top', 1, dim(L, W));
      add('Leg', 4, dim(H, leg));
      add('Apron', 2, dim(L, 8));
      add('Stretcher', 1, dim(L, 5));
      break;
    case 'SHELF':
      add('Side panel', 2, dim(H, W));
      add('Shelf board', Math.max(3, Math.round(H / 35)), dim(L, W));
      add('Top & bottom board', 2, dim(L, W));
      add('Back panel plywood', 1, dim(L, H));
      break;
    case 'CABINET':
      add('Side panel', 2, dim(H, W));
      add('Top board', 1, dim(L, W));
      add('Bottom board', 1, dim(L, W));
      add('Shelf board', 1, dim(L, W));
      add('Door', 2, dim(L / 2, H - 10));
      add('Back panel plywood', 1, dim(L, H));
      add('Plinth / leg', 4, dim(10, leg));
      break;
    case 'NIGHTSTAND':
      add('Top board', 1, dim(L, W));
      add('Side panel', 2, dim(H - 10, W));
      add('Bottom board', 1, dim(L, W));
      add('Drawer front & box', 1, dim(L, 45));
      add('Leg', 4, dim(12, 4));
      add('Back panel plywood', 1, dim(L, H - 10));
      break;
    case 'BED_FRAME':
      add('Headboard', 1, dim(W, H));
      add('Footboard', 1, dim(W, 40));
      add('Side rail', 2, dim(L, 20));
      add('Slat', Math.round(L / 10), dim(W, 8));
      add('Leg', 4, dim(35, leg));
      break;
    default:
      // dining / coffee tables, desks
      add('Table top', 1, dim(L, W));
      add('Leg', 4, dim(H - 4, leg));
      add('Apron (long)', 2, dim(L - 20, 10));
      add('Apron (short)', 2, dim(W - 20, 10));
      if (spec.construction_type === 'DESK') add('Drawer box', 1, dim(50, 45));
  }
  if (hasUpholstery(a.upholstery)) add('Upholstery foam & fabric', 1, dim(L, W));
}

function customGeneric(spec: Extract<Specifications, { category: 'CUSTOM_GENERIC' }>, add: Add) {
  const d = spec.attributes.dimensions_cm;
  const qty = Math.max(1, spec.attributes.quantity);
  add('Main material (estimate)', qty, d.length > 0 ? dim(d.length, d.height || d.width || d.length) : dim(30, 30));
}

export function templateComponents(raw: Specifications): BomComponent[] {
  const spec = normalizeSpecifications(raw);
  const parts: BomComponent[] = [];
  const add: Add = (part_name, qty, size) => {
    if (qty > 0) parts.push({ part_name, qty, dimensions_cm: size });
  };
  switch (spec.category) {
    case 'SMALL_GOODS':
      smallGoods(spec, add);
      break;
    case 'BAG':
      bag(spec, add);
      break;
    case 'FOOTWEAR':
      footwear(spec, add);
      break;
    case 'FURNITURE':
      furniture(spec, add);
      break;
    case 'CUSTOM_GENERIC':
      customGeneric(spec, add);
  }
  return parts;
}

export function computeMaterialSqft(components: BomComponent[], wastagePct: number): number {
  return r1((netPrimaryAreaCm2(components) * (1 + wastagePct)) / CM2_PER_SQFT);
}

export function defaultHardware(raw: Specifications): string[] {
  const spec = normalizeSpecifications(raw);
  switch (spec.category) {
    case 'SMALL_GOODS': {
      const a = spec.attributes;
      const zips = (a.coin_zip_pocket ? 1 : 0) + (spec.construction_type === 'ZIP_AROUND_LONG_WALLET' ? 1 : 0);
      const hw = zips ? [`${a.zipper || 'YKK zipper'} x${zips}`] : [];
      if (spec.construction_type === 'KEY_POUCH') hw.push('Key ring / hooks');
      return hw;
    }
    case 'BAG': {
      const a = spec.attributes;
      const metal = /brass|kuningan/i.test(a.hardware) ? 'Solid brass' : 'Brass';
      const hw: string[] = [];
      if (a.main_closure === 'TURN_LOCK_FLAP') hw.push('Turn-lock clasp');
      if (a.main_closure === 'MAGNETIC_FLAP') hw.push('Magnetic snap closure');
      if (a.main_closure === 'BUCKLE_FLAP') hw.push(`${metal} buckle x2`);
      const zips = a.interior_zip_pockets + (a.main_closure === 'ZIPPER' ? 1 : 0);
      if (zips) hw.push(`YKK zipper x${zips}`);
      if (bagHasStrap(a)) hw.push(`${metal} D-ring x2`, 'Swivel snap hook x2', 'Strap adjuster buckle');
      if (spec.construction_type === 'PADEL_RACKET_BAG') hw.push('Heavy-duty carabiner clip x2');
      hw.push(`${metal} rivets x4`);
      if (a.structure !== 'SOFT') hw.push('Base feet studs x4');
      return hw;
    }
    case 'FOOTWEAR': {
      const a = spec.attributes;
      const hw = ['Steel shank x2'];
      if (spec.construction_type === 'DERBY_SHOES' || spec.construction_type === 'OXFORD_SHOES') hw.unshift('Waxed cotton laces (pair)', 'Brass eyelets x10');
      if (spec.construction_type === 'CHELSEA_BOOTS') hw.push('Pull tab webbing x2');
      if (a.outsole_type === 'DAINITE' || a.outsole_type === 'COMMANDO_LUG') hw.push(`${a.outsole_type === 'DAINITE' ? 'Dainite' : 'Commando'} rubber sole (pair)`);
      return hw;
    }
    case 'FURNITURE': {
      const a = spec.attributes;
      const hw: string[] = [];
      // add-ons are listed for production; their price comes from the custom field surcharge, not the hardware rate
      const addOns = spec.custom_fields.filter((f) => f.kind === 'ADD_ON').map((f) => `${f.label}: ${f.value} (add-on)`);
      if (isBuiltInFurniture(spec.construction_type)) {
        const { L, W, H, doors, drawers, cabinetRun } = builtInLayout(spec);
        const grade = a.hardware_fittings === 'PREMIUM_SOFT_CLOSE' ? 'Blum / Hafele soft-close' : a.hardware_fittings === 'SOFT_CLOSE' ? 'Soft-close' : 'Standard';
        hw.push(`${grade} concealed hinges x${doors * 2}`, `${grade} drawer rails (pair) x${drawers}`, `Handles x${doors + drawers}`);
        if (spec.construction_type === 'WARDROBE') hw.push('Hanging rail x2');
        if (spec.construction_type === 'KITCHEN_SET') {
          const top = a.countertop.trim() || 'Granite';
          // countertop and backsplash follow the cabinet run (both walls of an L, without the fridge bay)
          hw.push(
            `${top} countertop ${Math.round(cabinetRun)} x ${Math.round(W)} cm`,
            `Backsplash ${Math.round(cabinetRun)} x ${KITCHEN.splash} cm`,
            'Adjustable cabinet legs x' + Math.max(4, Math.ceil(cabinetRun / 60) * 2),
          );
        }
        // HPL covers the visible fronts and sides: front area + 20% over 122 x 244 cm sheets
        if (a.finish_coating === 'HPL') hw.push(`HPL sheet 122 x 244 cm x${Math.max(1, Math.ceil((L * H * 1.2) / (122 * 244)))}`);
        return [...hw, ...addOns];
      }
      if (a.joinery_type === 'KNOCK_DOWN_FITTINGS' || a.assembly === 'KNOCK_DOWN') hw.push('Knock-down connector bolts x8');
      if (a.joinery_type === 'POCKET_SCREW') hw.push('Pocket screws x24');
      if (a.joinery_type === 'DOWEL') hw.push('Hardwood dowels x16');
      if (spec.construction_type === 'CABINET') hw.push('Concealed hinges x4', 'Door handles x2');
      if (spec.construction_type === 'DESK') hw.push('Drawer slides (pair)');
      hw.push('Felt floor pads x4');
      return [...hw, ...addOns];
    }
    case 'CUSTOM_GENERIC':
      return [];
  }
}

export function estimateLaborHours(preset: CategoryPreset, components: BomComponent[], raw: Specifications): number {
  const spec = normalizeSpecifications(raw);
  const def = constructionDef(spec.construction_type);
  const defaults = (def?.defaults ?? {}) as Record<string, unknown>;
  const reference = templateComponents(normalizeSpecifications({ ...spec, attributes: { ...spec.attributes, ...defaults } }));
  const refArea = reference.reduce((s, c) => s + componentAreaCm2(c), 0) || 1;
  const area = components.reduce((s, c) => s + componentAreaCm2(c), 0);
  const sizeFactor = Math.min(1.6, Math.max(0.7, area / refArea));
  let hours = preset.base_labor_hours * (def?.labor_factor ?? 1) * sizeFactor;

  switch (spec.category) {
    case 'SMALL_GOODS':
    case 'BAG': {
      const a = spec.attributes;
      if (a.stitching_method && !/hand|tangan|manual|saddle/i.test(a.stitching_method)) hours *= 0.75;
      if (a.embossing_type === 'EMBOSS_INITIALS' || a.embossing_type === 'EMBOSS_LOGO') hours += 0.5;
      if (a.embossing_type === 'LASER_ENGRAVING') hours += 1;
      if (spec.category === 'SMALL_GOODS') {
        if (spec.attributes.id_window) hours += 0.5;
        hours += 0.75 * ((spec.attributes.coin_zip_pocket ? 1 : 0) + (spec.construction_type === 'ZIP_AROUND_LONG_WALLET' ? 1 : 0));
      } else hours += 0.75 * spec.attributes.interior_zip_pockets;
      break;
    }
    case 'FOOTWEAR':
      if (spec.attributes.welt_method === 'GOODYEAR') hours *= 1.3;
      if (spec.attributes.welt_method === 'CEMENTED') hours *= 0.7;
      break;
    case 'FURNITURE':
      // sprayed duco needs several coats + sanding; melamic and HPL pressing sit in between
      if (spec.attributes.finish_coating === 'DUCO_PAINT') hours *= 1.25;
      if (spec.attributes.finish_coating === 'MELAMIC' || spec.attributes.finish_coating === 'HPL') hours *= 1.1;
      // (joinery is a loose-furniture choice; built-ins carry the preset default but are board cabinetry)
      if (!isBuiltInFurniture(spec.construction_type)) {
        if (spec.attributes.joinery_type === 'MORTISE_TENON' || spec.attributes.joinery_type === 'DOVETAIL') hours *= 1.2;
        if (spec.attributes.joinery_type === 'WELDED') hours *= 0.8;
      }
      if (hasUpholstery(spec.attributes.upholstery)) hours += 4;
      break;
    case 'CUSTOM_GENERIC':
      hours *= Math.max(1, spec.attributes.quantity);
  }
  return Math.max(1, Math.round(hours * 2) / 2);
}

export function templatePattern(spec: Specifications, preset: CategoryPreset): PatternDraft {
  const components = templateComponents(spec);
  return {
    components_breakdown: components,
    estimated_material_sqft: computeMaterialSqft(components, preset.wastage_pct),
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
          part_name: {
            type: Type.STRING,
            description: 'Piece name. Append "(other material)" to any piece NOT cut from the primary material (lining, foam, fabric, rubber, glass...).',
          },
          qty: { type: Type.INTEGER },
          dimensions_cm: { type: Type.STRING, description: 'Flat cut size "L x W" in cm, including allowance.' },
        },
        required: ['part_name', 'qty', 'dimensions_cm'],
      },
    },
    hardware_list: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Each entry ends with " xN" when quantity > 1.' },
    estimated_labor_hours: { type: Type.NUMBER },
  },
  required: ['components_breakdown', 'hardware_list', 'estimated_labor_hours'],
};

function patternInstruction(spec: Specifications): string {
  const s = schemaOf(spec.category);
  const craft =
    spec.category === 'FURNITURE'
      ? 'a master furniture maker. Produce a CUT LIST of boards / members (tops, legs, aprons, rails, panels, doors) with flat face sizes.'
      : spec.category === 'FOOTWEAR'
        ? 'a master shoemaker. Produce the pattern pieces for ONE PAIR (qty counts both shoes).'
        : spec.category === 'CUSTOM_GENERIC'
          ? 'a master craftsperson. Produce the main material pieces this item needs.'
          : 'a master leather pattern maker. Produce flat 2D pattern pieces as a leathercrafter would cut them.';
  return `You are ${craft}
Product category: ${s.label}. Obey the construction_type exactly and every attribute given (counts of pockets/slots, closures, straps, joinery...).
Primary material is "${s.material_label}". Use rectangular bounding boxes. List hardware with quantities.
Labor hours assume one skilled maker; include time for personalization, zippers, joinery and finishing.`;
}

export async function runPatternAgent(spec: Specifications, preset: CategoryPreset): Promise<PatternDraft> {
  if (!isGeminiConfigured()) return templatePattern(spec, preset);
  try {
    const draft = await generateStructured<Omit<PatternDraft, 'estimated_material_sqft'>>({
      models: MODEL_CHAINS.pro,
      systemInstruction: patternInstruction(spec),
      schema: PATTERN_SCHEMA,
      parts: [
        {
          text:
            `Form factor: ${spec.construction_type}\nSize used for the pattern: ${JSON.stringify(dimsOf(spec))}\n` +
            `Specification:\n${specLines(spec, 'en').join('\n')}`,
        },
      ],
    });
    const components = draft.components_breakdown.filter((c) => c.qty > 0);
    const sqft = computeMaterialSqft(components, preset.wastage_pct);
    if (!components.length || sqft === 0) return templatePattern(spec, preset);
    return {
      components_breakdown: components,
      estimated_material_sqft: sqft,
      hardware_list: draft.hardware_list,
      estimated_labor_hours: r1(draft.estimated_labor_hours || estimateLaborHours(preset, components, spec)),
    };
  } catch (err) {
    console.warn('[pattern-agent] Gemini failed, using template breakdown:', err);
    return templatePattern(spec, preset);
  }
}
