import type { CategorySchema } from '@/lib/spec/fields';
import { parseColor, parseLeather, parseWoodOrMetal } from '@/lib/spec/parsers';
import { dimensionsField } from './common';

/**
 * Fallback for any other bespoke craft. Deliberately small: product-specific details live in `custom_fields`
 * (extracted by Gemini as label/value pairs, or added by the crafter with "+ Add Custom Field").
 */
export const CUSTOM_GENERIC: CategorySchema<'CUSTOM_GENERIC'> = {
  id: 'CUSTOM_GENERIC',
  label: 'Custom / other crafts',
  label_id: 'Custom lainnya',
  noun: 'bespoke handmade item',
  scope: 'Anything else: apparel (jackets, belts), jewelry, sports gear, home decor, hybrids that fit no other category.',
  detect: /jaket|jacket|baju|kemeja|ikat pinggang|sabuk|belt|kalung|cincin|gelang|anting|jewel|perhiasan|sarung|glove|helm|dekorasi|decor|vas|lampu/i,
  material_field: 'primary_material',
  material_label: 'Material',
  constructions: [
    { id: 'APPAREL', label: 'Apparel & belts', detect: /jaket|jacket|baju|kemeja|vest|rompi|ikat pinggang|sabuk|belt|apron|celemek/i, vision_cue: 'Garment or worn accessory such as a jacket, vest, belt or apron.', defaults: {}, labor_factor: 1 },
    { id: 'JEWELRY', label: 'Jewelry', detect: /kalung|cincin|gelang|anting|jewel|perhiasan|bracelet|necklace|ring\b/i, vision_cue: 'Ring, bracelet, necklace or earrings.', defaults: {}, labor_factor: 0.6 },
    { id: 'SPORTS_GEAR', label: 'Sports gear', detect: /sarung tinju|glove|bola|ball|helm|pelindung|guard|sport/i, vision_cue: 'Sports equipment or protective gear.', defaults: {}, labor_factor: 1 },
    { id: 'HOME_DECOR', label: 'Home decor', detect: /dekorasi|decor|vas|lampu|lamp|cermin|mirror|tray|nampan|coaster|tatakan/i, vision_cue: 'Decorative or functional home object.', defaults: {}, labor_factor: 0.8 },
    { id: 'OTHER_CUSTOM', label: 'Other custom item', detect: /(?!)/, vision_cue: 'Anything that fits none of the above.', defaults: {}, labor_factor: 1 },
  ],
  fields: {
    dimensions_cm: dimensionsField('Overall size in cm if relevant (0 for items sized otherwise, e.g. ring size goes into custom fields).', []),
    primary_material: {
      type: 'text',
      label: 'Primary material',
      label_id: 'Bahan utama',
      group: 'material',
      description: 'Main material, e.g. "Sheepskin nappa", "Perak 925", "Rotan".',
      parse: (t) => parseLeather(t) ?? parseWoodOrMetal(t) ?? /(perak|silver|emas|gold|kuningan|brass|katun|cotton|denim|wol|wool)[^.,]{0,15}/i.exec(t)?.[0]?.trim(),
    },
    color: { type: 'text', label: 'Color', label_id: 'Warna', group: 'material', description: 'Main color.', parse: parseColor },
    intended_use: {
      type: 'text',
      label: 'Intended use',
      label_id: 'Kegunaan',
      group: 'other',
      description: 'What the item is for / who uses it.',
      parse: (t) => /(?:buat|untuk|for)\s+([^.!?\n]{3,40})/i.exec(t)?.[1]?.trim(),
    },
    quantity: {
      type: 'number',
      label: 'Quantity',
      label_id: 'Jumlah',
      group: 'other',
      description: 'Number of pieces ordered (default 1).',
      parse: (t) => {
        const m = /(\d+)\s*(pcs|buah|biji|set|pasang)/i.exec(t);
        return m ? Number(m[1]) : undefined;
      },
    },
  },
  topics: [
    { id: 'construction', label: 'Jenis', ask: 'produk apa yang ingin dibuat (mis. dompet, tas, sepatu, furnitur, atau barang custom lain)', required: true, fields: [], deferrable: false, is_filled: (s) => s.construction_type !== 'UNSPECIFIED' },
    { id: 'material', label: 'Bahan', ask: 'bahan utama yang diinginkan', required: true, fields: ['primary_material'], deferrable: false },
    {
      id: 'details',
      label: 'Detail',
      ask: 'detail penting lainnya (ukuran, model, fitur khusus) supaya crafter bisa menghitung',
      required: true,
      fields: ['dimensions_cm'],
      deferrable: false,
      is_filled: (s) => s.custom_fields.length > 0 || s.attributes.dimensions_cm.length > 0 || s.notes.trim().length > 0,
    },
    { id: 'quantity', label: 'Jumlah', ask: 'jumlah yang dipesan', required: false, fields: ['quantity'], deferrable: true },
  ],
};
