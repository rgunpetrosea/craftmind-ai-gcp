import type { CategorySchema } from '@/lib/spec/fields';
import { parseSecondaryMaterial, parseWoodOrMetal } from '@/lib/spec/parsers';
import { parseCountertop, parseKitchenLayout, parseWallRuns } from '@/lib/spec/parsers';
import type { Specifications } from '@/lib/types';
import type { FurnitureAssembly, FurnitureConstruction, FurnitureFinish, FurnitureHardware, JoineryType } from '@/lib/types';
import { dimensionsField } from './common';

const pick = <T,>(rules: Array<[RegExp, T]>) => (t: string) => rules.find(([re]) => re.test(t))?.[1];
const SEATING = ['DINING_TABLE', 'BENCH', 'COFFEE_TABLE'];

/**
 * Built-in interior cabinetry, made to fit a wall and installed permanently. It has its own questions (board core,
 * HPL / duco / melamic finishing, hinges & rails, kitchen top) and never gets loose-furniture ones (joinery,
 * knock-down vs permanent, seats, upholstery).
 */
export const BUILT_IN_FURNITURE: FurnitureConstruction[] = ['KITCHEN_SET', 'WARDROBE', 'TV_CONSOLE'];
export const isBuiltInFurniture = (construction: string) => (BUILT_IN_FURNITURE as string[]).includes(construction);
const builtIn = isBuiltInFurniture;

/** "sampai plafon", "full plafon", "mentok plafon", "floor to ceiling". */
export const FULL_CEILING = /sampai (ke )?plafon|full (ke )?plafon|full ceiling|mentok (ke )?plafon|sampai (ke )?atap|floor[\s-]?to[\s-]?ceiling|tinggi plafon/i;
/** "jendela di pojok kiri", "kulkas di kanan", "kompor dekat jendela": positions in the room, in the client's words. */
const POSITION = /\b(jendela|kulkas|lemari es|kompor|wastafel|bak cuci|sink|pintu|lemari tinggi|tall unit|oven|tv)\b[^.,;\n]{0,12}\b(di|sebelah|dekat|pojok|ujung|samping)\b[^.,;\n]{0,25}/gi;
/**
 * Built-in cabinetry that runs up to the ceiling: the "Sampai plafon" flag, ceiling words anywhere in the spec (custom
 * requests, layout notes, notes) or an overall height of 2.4 m or more. The one rule every consumer uses (cut list,
 * MASTER LAYOUT, mockup HARD CONSTRAINTS, offline concept), so nothing falls back to standard-height wall cabinets.
 */
export function isFullHeightBuiltIn(spec: Specifications): boolean {
  if (spec.category !== 'FURNITURE' || !isBuiltInFurniture(spec.construction_type)) return false;
  const a = spec.attributes;
  const words = [a.layout_notes, a.appliances, spec.notes, spec.model_name, ...spec.custom_fields.map((f) => `${f.label} ${f.value}`)].join(' ');
  return a.floor_to_ceiling || FULL_CEILING.test(words) || (a.dimensions_cm?.height ?? 0) >= 240;
}

/** Ceiling line for a full-height built-in: the stated height when it is a room height, else the 240 cm standard. */
export function ceilingHeightCm(spec: Specifications): number {
  const h = spec.category === 'FURNITURE' ? (spec.attributes.dimensions_cm?.height ?? 0) : 0;
  return h >= 200 ? h : 240;
}

const APPLIANCE = /\b(kulkas|lemari es|refrigerator|fridge|kompor|hob|oven|microwave|dishwasher|cooker ?hood|penghisap asap|wastafel|bak cuci|sink|tv)\b[^.,;\n]{0,20}/gi;

export const FURNITURE: CategorySchema<'FURNITURE'> = {
  id: 'FURNITURE',
  label: 'Furniture',
  label_id: 'Furnitur',
  noun: 'piece of handmade furniture',
  scope: 'Tables, chairs, stools, benches, shelves, cabinets, bed frames in wood and/or metal.',
  detect: /meja|kursi|lemari|rak|bufet|buffet|kabinet|cabinet|ranjang|dipan|bangku|furnitur|furniture|table|chair|shelf|desk/i,
  material_field: 'primary_material',
  material_label: 'Wood / board',
  constructions: [
    // built-ins first: "lemari pakaian" is a wardrobe and "rak tv" a TV console before the generic cabinet / shelf match
    {
      id: 'KITCHEN_SET',
      label: 'Kitchen set (built-in)',
      detect: /kitchen ?set|kitchen cabinet|kabinet dapur|lemari dapur|dapur (bersih|kotor)|\bpantry\b/i,
      vision_cue: 'Built-in kitchen cabinetry along a wall: base cabinets under a countertop, wall-hung upper cabinets, often a tall unit housing the fridge or oven.',
      // standard height: 85 base + 60 splashback + 80 wall cabinets; a full-ceiling kitchen is taller
      defaults: { dimensions_cm: { length: 300, width: 60, height: 225 }, finish_coating: 'HPL', hardware_fittings: 'STANDARD', countertop: 'Granite', layout_shape: 'STRAIGHT' },
      labor_factor: 3,
    },
    {
      id: 'WARDROBE',
      label: 'Built-in wardrobe',
      detect: /lemari (pakaian|baju|built[\s-]?in|tanam)|wardrobe|walk[\s-]?in closet|\bcloset\b/i,
      vision_cue: 'Tall built-in wardrobe fitted wall to wall with hinged or sliding doors, hanging rails and shelves inside.',
      defaults: { dimensions_cm: { length: 180, width: 60, height: 240 }, finish_coating: 'HPL', hardware_fittings: 'STANDARD' },
      labor_factor: 2.2,
    },
    {
      id: 'TV_CONSOLE',
      label: 'TV console / media wall (built-in)',
      detect: /(meja|rak|bufet|buffet|kabinet|lemari) tv|tv (console|cabinet|stand|backdrop)|backdrop tv|media wall/i,
      vision_cue: 'Long low media console under a wall-mounted TV, often with a wall backdrop panel and side shelving.',
      defaults: { dimensions_cm: { length: 200, width: 45, height: 50 }, finish_coating: 'HPL', hardware_fittings: 'STANDARD' },
      labor_factor: 1.3,
    },
    { id: 'DINING_TABLE', label: 'Dining table', detect: /meja makan|dining table/i, vision_cue: 'Table top at ~75 cm height, four legs or trestle, for 4–10 seats.', defaults: { dimensions_cm: { length: 180, width: 90, height: 75 }, seating_capacity: 6 }, labor_factor: 1.2 },
    { id: 'COFFEE_TABLE', label: 'Coffee table', detect: /meja (tamu|kopi|sofa)|coffee table/i, vision_cue: 'Low table ~40–45 cm high.', defaults: { dimensions_cm: { length: 100, width: 60, height: 42 } }, labor_factor: 0.8 },
    { id: 'DESK', label: 'Desk', detect: /meja (kerja|belajar|kantor)|desk/i, vision_cue: 'Work table ~75 cm high, may have drawers.', defaults: { dimensions_cm: { length: 120, width: 60, height: 75 } }, labor_factor: 1 },
    { id: 'BENCH', label: 'Bench', detect: /bangku panjang|bench/i, vision_cue: 'Long backless seat ~45 cm high.', defaults: { dimensions_cm: { length: 140, width: 35, height: 45 }, seating_capacity: 3 }, labor_factor: 0.7 },
    { id: 'STOOL', label: 'Stool', detect: /stool|dingklik|kursi bar/i, vision_cue: 'Backless single seat.', defaults: { dimensions_cm: { length: 35, width: 35, height: 45 } }, labor_factor: 0.4 },
    { id: 'CHAIR', label: 'Chair', detect: /kursi|chair/i, vision_cue: 'Single seat with backrest.', defaults: { dimensions_cm: { length: 45, width: 50, height: 85 } }, labor_factor: 0.6 },
    { id: 'SHELF', label: 'Shelf / bookcase', detect: /rak|shelf|bookcase/i, vision_cue: 'Open shelving with vertical sides and horizontal shelves.', defaults: { dimensions_cm: { length: 80, width: 30, height: 180 } }, labor_factor: 0.9 },
    { id: 'CABINET', label: 'Cabinet / sideboard', detect: /lemari|bufet|buffet|kabinet|cabinet|sideboard/i, vision_cue: 'Closed carcass with doors and/or drawers.', defaults: { dimensions_cm: { length: 150, width: 45, height: 80 } }, labor_factor: 1.4 },
    { id: 'NIGHTSTAND', label: 'Nightstand / bedside table', detect: /nakas|bedside|night ?stand|meja (samping|sebelah) (tempat tidur|ranjang|kasur)/i, vision_cue: 'Small bedside cabinet ~50–60 cm high with a drawer and/or shelf.', defaults: { dimensions_cm: { length: 50, width: 40, height: 55 } }, labor_factor: 0.6 },
    { id: 'BED_FRAME', label: 'Bed frame', detect: /ranjang|dipan|tempat tidur|bed/i, vision_cue: 'Frame with headboard, side rails and slats.', defaults: { dimensions_cm: { length: 210, width: 170, height: 100 } }, labor_factor: 1.5 },
    { id: 'OTHER_FURNITURE', label: 'Other furniture', detect: /(?!)/, vision_cue: 'Any other furniture.', defaults: {}, labor_factor: 1 },
  ],
  fields: {
    dimensions_cm: dimensionsField('Overall L x W x H in cm. Furniture needs all three.', ['length', 'width', 'height']),
    primary_material: {
      type: 'text',
      label: 'Wood / metal',
      label_id: 'Bahan utama',
      group: 'material',
      placeholder: 'e.g. Jati (teak) grade A',
      description:
        'Main wood species or metal, with grade if given, e.g. "Jati (teak) grade A", "Besi hollow". Built-in cabinetry (kitchen set, wardrobe, TV console): the board core, e.g. "Plywood (multipleks) 18mm", "Blockboard 18mm", "MDF 18mm".',
      parse: parseWoodOrMetal,
    },
    secondary_material: {
      type: 'text',
      label: 'Secondary material',
      label_id: 'Bahan kedua',
      group: 'material',
      description: 'e.g. legs or frame in another material: "kaki besi hollow".',
      parse: parseSecondaryMaterial,
    },
    finish_coating: {
      type: 'enum',
      label: 'Finish / coating',
      label_id: 'Finishing',
      group: 'finish',
      options: {
        NATURAL_OIL: 'Natural oil',
        WAX: 'Wax',
        WATER_BASED_LACQUER: 'Water-based lacquer',
        PU_VARNISH: 'PU varnish',
        DUCO_PAINT: 'Duco paint',
        POWDER_COAT: 'Powder coat (metal)',
        HPL: 'HPL (high-pressure laminate)',
        MELAMIC: 'Melamic (clear melamine lacquer)',
      },
      description: 'Surface finish of the wood or metal. Built-ins: HPL (laminate sheet), DUCO_PAINT (solid sprayed colour) or MELAMIC (clear, wood grain visible).',
      parse: pick<FurnitureFinish>([
        [/\bhpl\b|high[\s-]?pressure laminat|\btaco\b/i, 'HPL'],
        [/melamic|melamin/i, 'MELAMIC'],
        [/duco|cat duco/i, 'DUCO_PAINT'],
        [/minyak|natural oil|danish oil|\boil\b/i, 'NATURAL_OIL'],
        [/wax|lilin/i, 'WAX'],
        [/water ?based/i, 'WATER_BASED_LACQUER'],
        [/\bpu\b|polyurethane|varnish|pernis/i, 'PU_VARNISH'],
        [/powder ?coat/i, 'POWDER_COAT'],
      ]),
    },
    color_stain: {
      type: 'text',
      label: 'Color / stain',
      label_id: 'Warna',
      group: 'finish',
      description: 'Stain or paint color, e.g. "natural", "walnut stain", "hitam doff".',
      parse: (t) => /(warna|stain|tone)\s+([a-z ]{3,25}?)(?:,|\.|$)/i.exec(t)?.[2]?.trim(),
    },
    joinery_type: {
      type: 'enum',
      label: 'Joinery',
      label_id: 'Sambungan',
      group: 'construction',
      options: {
        MORTISE_TENON: 'Mortise & tenon',
        DOVETAIL: 'Dovetail',
        DOWEL: 'Dowel',
        FINGER_JOINT: 'Finger joint',
        POCKET_SCREW: 'Pocket screw',
        KNOCK_DOWN_FITTINGS: 'Knock-down fittings',
        WELDED: 'Welded (metal)',
      },
      description: 'Main joinery method.',
      relevant: (_a, c) => !builtIn(c),
      parse: pick<JoineryType>([[/mortise|tenon|purus/i, 'MORTISE_TENON'], [/dovetail|ekor burung/i, 'DOVETAIL'], [/dowel|pen kayu/i, 'DOWEL'], [/finger joint/i, 'FINGER_JOINT'], [/pocket ?screw/i, 'POCKET_SCREW'], [/knock ?down|bongkar pasang/i, 'KNOCK_DOWN_FITTINGS'], [/las|weld/i, 'WELDED']]),
    },
    upholstery: {
      type: 'text',
      label: 'Upholstery',
      label_id: 'Jok / upholstery',
      group: 'material',
      description: 'Seat/back upholstery: fabric or leather + foam, or "none".',
      parse: (t) => /(jok|busa|foam|upholster|kain|fabric|bludru)[^.,]{0,30}/i.exec(t)?.[0]?.trim(),
      relevant: (_a, c) => ['CHAIR', 'STOOL', 'BENCH', 'BED_FRAME', 'OTHER_FURNITURE'].includes(c),
    },
    seating_capacity: {
      type: 'number',
      label: 'Seats',
      label_id: 'Kapasitas kursi',
      group: 'size',
      description: 'Number of people seated (dining tables, benches).',
      parse: (t) => {
        const m = /(\d+)\s*(kursi|orang|seat|seater|pax)/i.exec(t);
        return m ? Number(m[1]) : undefined;
      },
      relevant: (_a, c) => SEATING.includes(c),
    },
    assembly: {
      type: 'enum',
      label: 'Assembly',
      label_id: 'Perakitan',
      group: 'construction',
      options: { ASSEMBLED: 'Delivered assembled', KNOCK_DOWN: 'Knock-down (flat pack)' },
      description: 'Delivered assembled or knock-down.',
      relevant: (_a, c) => !builtIn(c),
      parse: pick<FurnitureAssembly>([[/knock ?down|bongkar pasang|flat ?pack/i, 'KNOCK_DOWN'], [/sudah dirakit|assembled|utuh/i, 'ASSEMBLED']]),
    },
    hardware_fittings: {
      type: 'enum',
      label: 'Hinges & rails',
      label_id: 'Engsel & rel',
      group: 'construction',
      options: { STANDARD: 'Standard hinges & ball-bearing rails', SOFT_CLOSE: 'Soft-close hinges & rails', PREMIUM_SOFT_CLOSE: 'Premium soft-close (Blum / Hafele)' },
      description: 'Built-in cabinetry hinges and drawer rails: "soft close / pelan / nggak bunyi" = SOFT_CLOSE, Blum / Hafele = PREMIUM_SOFT_CLOSE.',
      relevant: (_a, c) => builtIn(c),
      parse: pick<FurnitureHardware>([
        [/blum|hafele|premium/i, 'PREMIUM_SOFT_CLOSE'],
        [/soft[\s-]?clos|slow[\s-]?motion|hidrolik|hydraulic|damper|peredam|(nutup|tutup)\w* pelan|ga(k)? bunyi|nggak bunyi/i, 'SOFT_CLOSE'],
        [/(engsel|rel)\w* (biasa|standar)|standar(d)? (aja|saja)/i, 'STANDARD'],
      ]),
    },
    countertop: {
      type: 'text',
      label: 'Countertop (top table)',
      label_id: 'Top table',
      group: 'material',
      placeholder: 'e.g. Granite (Nero Marquina)',
      description:
        'Kitchen countertop ("top table"): material + stone / colour as the client said it, "Material (stone or colour)": "granit hitam Nero Marquina" → "Granite (Nero Marquina)", "marmer putih" → "Marble (putih)", "solid surface" → "Solid surface", "top HPL" → "HPL".',
      relevant: (_a, c) => c === 'KITCHEN_SET',
      parse: parseCountertop,
    },
    floor_to_ceiling: {
      type: 'boolean',
      label: 'Floor to ceiling',
      label_id: 'Sampai plafon',
      group: 'size',
      description: 'Built-ins: the cabinetry runs up to the ceiling ("sampai plafon", "full plafon"), with no gap on top.',
      relevant: (_a, c) => builtIn(c),
      parse: (t) => (FULL_CEILING.test(t) ? true : undefined),
    },
    appliances: {
      type: 'text',
      label: 'Built-in appliances',
      label_id: 'Peralatan terpasang',
      group: 'layout',
      description: 'Appliances the cabinetry must house or frame, e.g. "kulkas 2 pintu", "kompor tanam + cooker hood", "oven tanam", "TV 65 inch".',
      relevant: (_a, c) => builtIn(c),
      parse: (t) => {
        const hits = [...new Set([...t.matchAll(APPLIANCE)].map((m) => m[0].trim().toLowerCase()))];
        return hits.length ? hits.join(', ') : undefined;
      },
    },
    layout_shape: {
      type: 'enum',
      label: 'Kitchen layout',
      label_id: 'Bentuk dapur',
      group: 'size',
      options: { STRAIGHT: 'Straight (one wall)', L_SHAPE: 'L-shape (two walls)', U_SHAPE: 'U-shape (three walls)', GALLEY: 'Parallel / galley' },
      description: 'Kitchen run layout: "bentuk L / letter L" = L_SHAPE, "bentuk U" = U_SHAPE, "lurus / satu sisi" = STRAIGHT, "paralel / berhadapan" = GALLEY.',
      relevant: (_a, c) => c === 'KITCHEN_SET',
      parse: parseKitchenLayout,
    },
    second_wall_cm: {
      type: 'number',
      label: 'Second wall (L2)',
      label_id: 'Dinding kedua (L2)',
      group: 'size',
      unit: 'cm',
      description: 'L / U / galley kitchens: length of the second wall run in cm (dimensions_cm.length is the main wall L1). "L1 300, L2 200" → 200.',
      relevant: (_a, c) => c === 'KITCHEN_SET',
      parse: (t) => parseWallRuns(t)?.l2,
    },
    layout_notes: {
      type: 'text',
      label: 'Layout notes',
      label_id: 'Posisi di ruangan',
      group: 'layout',
      description: 'Where things are in the room, in the client\'s words: window, fridge, hob, sink, door, tall unit ("jendela di pojok kiri, kulkas di kanan").',
      relevant: (_a, c) => builtIn(c),
      parse: (t) => {
        const hits = [...new Set([...t.matchAll(POSITION)].map((m) => m[0].trim()))];
        return hits.length ? hits.join('; ') : undefined;
      },
    },
  },
  // "size" and "material" have a loose-furniture and a built-in variant with the same id (one applies at a time), so
  // the site-visit rule and the material answer mapping work for both.
  topics: [
    { id: 'construction', label: 'Jenis', ask: 'mau dibuatkan furnitur apa', required: true, fields: [], deferrable: false, is_filled: (s) => s.construction_type !== 'UNSPECIFIED' },
    { id: 'size', label: 'Ukuran', ask: 'mau ditaruh di ruangan mana dan untuk berapa orang; kalau harus pas dengan ruangan, kami bisa survei ukur ke lokasi', required: true, fields: ['dimensions_cm'], excludes: BUILT_IN_FURNITURE, deferrable: false },
    { id: 'size', label: 'Ukuran', ask: 'lebar dinding yang mau dipasang kira-kira berapa, dan mau sampai plafon atau tidak; kalau belum diukur, kami survei ukur ke lokasi', required: true, fields: ['dimensions_cm'], applies_to: BUILT_IN_FURNITURE, deferrable: false },
    { id: 'material', label: 'Bahan', ask: 'suka tampilan kayu yang hangat dan klasik, kayu terang yang modern, atau kombinasi kayu dan besi', required: true, fields: ['primary_material'], excludes: BUILT_IN_FURNITURE, deferrable: false },
    { id: 'material', label: 'Bahan inti', ask: 'badan kabinetnya mau plywood (multipleks, lebih kuat dan tahan lembap) atau blockboard (lebih ekonomis)', required: true, fields: ['primary_material'], applies_to: BUILT_IN_FURNITURE, deferrable: false },
    { id: 'finish', label: 'Finishing', ask: 'permukaannya mau natural doff, atau lebih mengkilap dan tahan air', required: false, fields: ['finish_coating'], excludes: BUILT_IN_FURNITURE, deferrable: true },
    // built-ins: core, finishing, hinges & rails and (kitchen) top table are all MANDATORY slots; no mockup before they are filled
    { id: 'board_finish', label: 'Finishing', ask: 'finishing luarnya mau HPL (motif kayu atau warna solid, tahan gores), duco (cat mulus, warna bebas), atau melamic (serat kayu tetap kelihatan)', required: true, fields: ['finish_coating'], applies_to: BUILT_IN_FURNITURE, deferrable: true },
    { id: 'hardware', label: 'Engsel & rel', ask: 'engsel pintu dan rel lacinya mau yang standar, atau soft-close (nutupnya pelan dan nggak bunyi)', required: true, fields: ['hardware_fittings'], applies_to: BUILT_IN_FURNITURE, deferrable: true },
    { id: 'countertop', label: 'Top table', ask: 'meja atas (top table) dapurnya mau granit, marmer, atau solid surface', required: true, fields: ['countertop'], applies_to: ['KITCHEN_SET'], deferrable: true },
    { id: 'joinery', label: 'Sambungan', ask: 'nanti perlu sering dipindah atau dibongkar, atau dipasang permanen', required: false, fields: ['joinery_type'], excludes: BUILT_IN_FURNITURE, deferrable: true },
    { id: 'upholstery', label: 'Jok', ask: 'dudukannya mau empuk pakai jok, atau kayu polos', required: false, fields: ['upholstery'], applies_to: ['CHAIR', 'STOOL', 'BENCH', 'BED_FRAME'], deferrable: true },
  ],
};
