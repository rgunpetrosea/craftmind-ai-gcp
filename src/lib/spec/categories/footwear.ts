import type { CategorySchema } from '@/lib/spec/fields';
import { parseColor, parseLeather, parseLining } from '@/lib/spec/parsers';
import type { LastShape, OutsoleType, WeltMethod, WidthFit } from '@/lib/types';

const pick = <T,>(rules: Array<[RegExp, T]>) => (t: string) => rules.find(([re]) => re.test(t))?.[1];

export const FOOTWEAR: CategorySchema<'FOOTWEAR'> = {
  id: 'FOOTWEAR',
  label: 'Footwear',
  label_id: 'Sepatu',
  noun: 'pair of handmade shoes',
  scope: 'Shoes, boots and sandals made on a last.',
  detect: /sepatu|shoe|boot|sandal|sendal|loafer|oxford|derby|sneaker/i,
  material_field: 'upper_material',
  material_label: 'Upper leather',
  constructions: [
    { id: 'OXFORD_SHOES', label: 'Oxford shoes', detect: /oxford/i, vision_cue: 'Lace-up shoe with closed lacing (quarters sewn under the vamp).', defaults: { welt_method: 'GOODYEAR', outsole_type: 'LEATHER' }, labor_factor: 1.05 },
    { id: 'DERBY_SHOES', label: 'Derby shoes', detect: /derby/i, vision_cue: 'Lace-up shoe with open lacing (quarters sewn on top of the vamp).', defaults: { welt_method: 'GOODYEAR', outsole_type: 'LEATHER' }, labor_factor: 1 },
    { id: 'LOAFERS', label: 'Loafers', detect: /loafer|slip[\s-]?on/i, vision_cue: 'Slip-on shoe with no laces.', defaults: { welt_method: 'BLAKE', outsole_type: 'LEATHER' }, labor_factor: 0.9 },
    { id: 'CHELSEA_BOOTS', label: 'Chelsea boots', detect: /chelsea|sepatu boot|\bboots?\b/i, vision_cue: 'Ankle boot with elastic side gussets and a pull tab.', defaults: { welt_method: 'GOODYEAR', outsole_type: 'DAINITE', heel_height_cm: 3 }, labor_factor: 1.2 },
    { id: 'SANDALS', label: 'Sandals', detect: /sandal|sendal/i, vision_cue: 'Open shoe with straps over the foot.', defaults: { welt_method: 'STITCHDOWN', outsole_type: 'RUBBER' }, labor_factor: 0.6 },
    { id: 'OTHER_FOOTWEAR', label: 'Other footwear', detect: /(?!)/, vision_cue: 'Any other footwear.', defaults: {}, labor_factor: 1 },
  ],
  fields: {
    eu_size: {
      type: 'number',
      label: 'EU size',
      label_id: 'Ukuran (EU)',
      group: 'size',
      description: 'EU shoe size (convert US/UK if given).',
      parse: (t) => {
        const m = /(?:ukuran|size|nomor|no\.?)\s*(\d{2}(?:[.,]5)?)/i.exec(t);
        return m ? Number(m[1].replace(',', '.')) : undefined;
      },
    },
    width_fit: {
      type: 'enum',
      label: 'Width fit',
      label_id: 'Lebar kaki',
      group: 'size',
      options: { NARROW: 'Narrow', REGULAR: 'Regular', WIDE: 'Wide' },
      description: 'Foot width.',
      parse: pick<WidthFit>([[/lebar|wide/i, 'WIDE'], [/ramping|narrow|sempit/i, 'NARROW']]),
    },
    last_shape: {
      type: 'enum',
      label: 'Last shape',
      label_id: 'Bentuk last (ujung)',
      group: 'construction',
      options: { ROUND: 'Round', ALMOND: 'Almond', CHISEL: 'Chisel', SQUARE: 'Square', POINTED: 'Pointed' },
      description: 'Toe shape of the last.',
      parse: pick<LastShape>([[/almond/i, 'ALMOND'], [/chisel/i, 'CHISEL'], [/round|bulat/i, 'ROUND'], [/square|kotak/i, 'SQUARE'], [/lancip|pointed/i, 'POINTED']]),
    },
    upper_material: {
      type: 'text',
      label: 'Upper material',
      label_id: 'Bahan upper',
      group: 'material',
      description: 'Upper leather type + color, e.g. "Crazy Horse Cognac 1.8mm".',
      parse: (t) => parseLeather(t),
    },
    color: { type: 'text', label: 'Color', label_id: 'Warna', group: 'material', description: 'Upper color.', parse: parseColor },
    toe_style: {
      type: 'text',
      label: 'Toe style',
      label_id: 'Model ujung',
      group: 'construction',
      description: 'e.g. "plain toe", "cap toe", "wingtip / brogue".',
      parse: (t) => /(cap toe|plain toe|wingtip|brogue|medallion)/i.exec(t)?.[1],
    },
    lining: { type: 'text', zone: 'interior', label: 'Lining', label_id: 'Lining', group: 'material', description: 'Lining material, usually calf leather.', parse: parseLining },
    outsole_type: {
      type: 'enum',
      label: 'Outsole',
      label_id: 'Sol luar',
      group: 'construction',
      options: { LEATHER: 'Leather', RUBBER: 'Rubber', DAINITE: 'Dainite (studded rubber)', CREPE: 'Crepe', COMMANDO_LUG: 'Commando lug' },
      description: 'Outsole material.',
      parse: pick<OutsoleType>([[/dainite/i, 'DAINITE'], [/crepe/i, 'CREPE'], [/commando|lug|gerigi/i, 'COMMANDO_LUG'], [/sol (karet|rubber)|rubber sole/i, 'RUBBER'], [/sol kulit|leather sole/i, 'LEATHER']]),
    },
    welt_method: {
      type: 'enum',
      label: 'Welt / construction method',
      label_id: 'Metode jahit sol',
      group: 'construction',
      options: { GOODYEAR: 'Goodyear welt', BLAKE: 'Blake stitch', STITCHDOWN: 'Stitchdown', CEMENTED: 'Cemented (glued)' },
      description: 'How the upper is attached to the sole.',
      parse: pick<WeltMethod>([[/goodyear/i, 'GOODYEAR'], [/blake/i, 'BLAKE'], [/stitch ?down/i, 'STITCHDOWN'], [/lem|cement|glued/i, 'CEMENTED']]),
    },
    heel_height_cm: {
      type: 'number',
      label: 'Heel height',
      label_id: 'Tinggi hak',
      group: 'size',
      unit: 'cm',
      step: 0.5,
      description: 'Heel height in cm.',
      parse: (t) => {
        const m = /(hak|heel)\D{0,10}(\d+(?:[.,]\d+)?)\s*cm/i.exec(t);
        return m ? Number(m[2].replace(',', '.')) : undefined;
      },
    },
  },
  topics: [
    { id: 'construction', label: 'Model', ask: 'model sepatu (mis. derby, oxford, loafer, chelsea boots)', required: true, fields: [], deferrable: false, is_filled: (s) => s.construction_type !== 'UNSPECIFIED' },
    { id: 'size', label: 'Ukuran', ask: 'ukuran kaki (EU) dan apakah kaki cenderung lebar', required: true, fields: ['eu_size'], deferrable: false },
    { id: 'material', label: 'Kulit upper', ask: 'jenis & warna kulit upper (mis. crazy horse cognac, box calf hitam)', required: true, fields: ['upper_material'], deferrable: false },
    { id: 'sole', label: 'Sol', ask: 'jenis sol (kulit, karet, dainite) dan metode jahit (goodyear welt atau blake)', required: false, fields: ['outsole_type', 'welt_method'], deferrable: true },
    { id: 'last', label: 'Last', ask: 'bentuk ujung sepatu (round, almond, chisel)', required: false, fields: ['last_shape'], deferrable: true },
    { id: 'heel', label: 'Hak', ask: 'tinggi hak yang diinginkan (cm)', required: false, fields: ['heel_height_cm'], deferrable: true },
  ],
};
