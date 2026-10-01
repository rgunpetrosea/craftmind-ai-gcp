import type { CategorySchema } from '@/lib/spec/fields';
import { parseSecondaryMaterial, parseWoodOrMetal } from '@/lib/spec/parsers';
import type { FurnitureAssembly, FurnitureFinish, JoineryType } from '@/lib/types';
import { dimensionsField } from './common';

const pick = <T,>(rules: Array<[RegExp, T]>) => (t: string) => rules.find(([re]) => re.test(t))?.[1];
const SEATING = ['DINING_TABLE', 'BENCH', 'COFFEE_TABLE'];

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
    { id: 'DINING_TABLE', label: 'Dining table', detect: /meja makan|dining table/i, vision_cue: 'Table top at ~75 cm height, four legs or trestle, for 4–10 seats.', defaults: { dimensions_cm: { length: 180, width: 90, height: 75 }, seating_capacity: 6 }, labor_factor: 1.2 },
    { id: 'COFFEE_TABLE', label: 'Coffee table', detect: /meja (tamu|kopi|sofa)|coffee table/i, vision_cue: 'Low table ~40–45 cm high.', defaults: { dimensions_cm: { length: 100, width: 60, height: 42 } }, labor_factor: 0.8 },
    { id: 'DESK', label: 'Desk', detect: /meja (kerja|belajar|kantor)|desk/i, vision_cue: 'Work table ~75 cm high, may have drawers.', defaults: { dimensions_cm: { length: 120, width: 60, height: 75 } }, labor_factor: 1 },
    { id: 'BENCH', label: 'Bench', detect: /bangku panjang|bench/i, vision_cue: 'Long backless seat ~45 cm high.', defaults: { dimensions_cm: { length: 140, width: 35, height: 45 }, seating_capacity: 3 }, labor_factor: 0.7 },
    { id: 'STOOL', label: 'Stool', detect: /stool|dingklik|kursi bar/i, vision_cue: 'Backless single seat.', defaults: { dimensions_cm: { length: 35, width: 35, height: 45 } }, labor_factor: 0.4 },
    { id: 'CHAIR', label: 'Chair', detect: /kursi|chair/i, vision_cue: 'Single seat with backrest.', defaults: { dimensions_cm: { length: 45, width: 50, height: 85 } }, labor_factor: 0.6 },
    { id: 'SHELF', label: 'Shelf / bookcase', detect: /rak|shelf|bookcase/i, vision_cue: 'Open shelving with vertical sides and horizontal shelves.', defaults: { dimensions_cm: { length: 80, width: 30, height: 180 } }, labor_factor: 0.9 },
    { id: 'CABINET', label: 'Cabinet / sideboard', detect: /lemari|bufet|buffet|kabinet|cabinet|sideboard/i, vision_cue: 'Closed carcass with doors and/or drawers.', defaults: { dimensions_cm: { length: 150, width: 45, height: 80 } }, labor_factor: 1.4 },
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
      description: 'Main wood species or metal, with grade if given, e.g. "Jati (teak) grade A", "Besi hollow".',
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
      },
      description: 'Surface finish of the wood or metal.',
      parse: pick<FurnitureFinish>([[/minyak|natural oil|danish oil|\boil\b/i, 'NATURAL_OIL'], [/wax|lilin/i, 'WAX'], [/water ?based/i, 'WATER_BASED_LACQUER'], [/\bpu\b|polyurethane|melamin|varnish|pernis/i, 'PU_VARNISH'], [/duco|cat duco/i, 'DUCO_PAINT'], [/powder ?coat/i, 'POWDER_COAT']]),
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
      parse: pick<FurnitureAssembly>([[/knock ?down|bongkar pasang|flat ?pack/i, 'KNOCK_DOWN'], [/sudah dirakit|assembled|utuh/i, 'ASSEMBLED']]),
    },
  },
  topics: [
    { id: 'construction', label: 'Jenis', ask: 'jenis furnitur (mis. meja makan, kursi, rak, lemari)', required: true, fields: [], deferrable: false, is_filled: (s) => s.construction_type !== 'UNSPECIFIED' },
    { id: 'size', label: 'Ukuran', ask: 'ukuran P x L x T (cm)', required: true, fields: ['dimensions_cm'], deferrable: false },
    { id: 'material', label: 'Bahan', ask: 'jenis kayu / besi (mis. jati grade A, mahoni, walnut, besi hollow)', required: true, fields: ['primary_material'], deferrable: false },
    { id: 'finish', label: 'Finishing', ask: 'finishing yang diinginkan (natural oil, PU varnish, duco) dan warnanya', required: false, fields: ['finish_coating'], deferrable: true },
    { id: 'joinery', label: 'Sambungan', ask: 'tipe sambungan (purus/mortise-tenon untuk dirakit permanen, atau knock-down supaya mudah dikirim)', required: false, fields: ['joinery_type'], deferrable: true },
    { id: 'upholstery', label: 'Jok', ask: 'pakai jok/busa? kalau iya, bahan kain atau kulit', required: false, fields: ['upholstery'], applies_to: ['CHAIR', 'STOOL', 'BENCH', 'BED_FRAME'], deferrable: true },
  ],
};
