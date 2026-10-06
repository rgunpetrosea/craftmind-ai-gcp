import { kitchenRun } from '@/lib/agents/pattern-agent';
import { normalizeSpecifications } from '@/lib/spec/catalog';
import type { CategoryPreset, CustomField, Specifications } from '@/lib/types';

/**
 * Standard furniture add-ons: accessories every interior workshop fits (lighting, switches, sockets, corner and
 * pull-out mechanisms). They are NOT out of scope and never escalate: the intake records each one as a priced custom
 * field (kind ADD_ON, surcharge = unit price x quantity), so the quote recalculates, and the hardware list shows it.
 * Prices are workshop defaults; a preset can override them with `addon_prices_idr`.
 */

export interface AddOnDef {
  id: string;
  label: string;
  match: RegExp;
  /** Priced per metre of cabinet run, or per piece. */
  unit: 'm' | 'unit';
  price_idr: number;
}

export const FURNITURE_ADDONS: AddOnDef[] = [
  {
    id: 'LED_STRIP',
    label: 'Recessed LED strip / under-cabinet lighting',
    match: /\bled\b|lampu\s*(strip|kabinet|bawah\s*kabinet|dalam\s*lemari|tersembunyi|indirect|led)|under[\s-]?cabinet\s*light\w*|hidden\s*light\w*|strip\s*light\w*/i,
    unit: 'm',
    price_idr: 175_000,
  },
  {
    id: 'TOUCH_SENSOR',
    label: 'Touch / motion sensor switch',
    match: /\bsensor\s*(sentuh|gerak|pintu|touch|motion)?\b|touch\s*(sensor|switch)|motion\s*sensor/i,
    unit: 'unit',
    price_idr: 150_000,
  },
  {
    id: 'POPUP_SOCKET',
    label: 'Pop-up power socket',
    match: /pop[\s-]?up\s*(socket|stop\s*kontak|colokan)?|stop\s*kontak|colokan(\s*listrik)?|power\s*socket|\bsocket\b/i,
    unit: 'unit',
    price_idr: 450_000,
  },
  { id: 'MAGIC_CORNER', label: 'Magic corner (corner pull-out)', match: /magic[\s-]?corner/i, unit: 'unit', price_idr: 3_500_000 },
  { id: 'CAROUSEL', label: 'Carousel corner rack', match: /carousel|le[\s-]?mans|rak\s*putar/i, unit: 'unit', price_idr: 2_250_000 },
  {
    id: 'PULL_OUT_RACK',
    label: 'Pull-out basket / dish rack',
    match: /pull[\s-]?out|rak\s*(piring|bumbu|botol)\s*tarik|keranjang\s*tarik|rak\s*tarik/i,
    unit: 'unit',
    price_idr: 1_250_000,
  },
];

/** Every add-on keyword, e.g. to keep accessories out of the non-standard (out-of-scope) detector. */
export const FURNITURE_ADDON_WORDS = new RegExp(FURNITURE_ADDONS.map((d) => `(?:${d.match.source})`).join('|'), 'gi');

/** The text with all add-on phrases removed ("LED strip", "pop-up socket"...). */
export function withoutFurnitureAddOns(text: string): string {
  return text.replace(FURNITURE_ADDON_WORDS, ' ');
}

/** Add-ons named in this text. */
export function detectAddOns(text: string): AddOnDef[] {
  return FURNITURE_ADDONS.filter((d) => d.match.test(text));
}

function quantity(def: AddOnDef, text: string, spec: Specifications): number {
  const src = def.match.source;
  if (def.unit === 'm') {
    const stated =
      new RegExp(`(?:${src})[^.\\n]{0,20}?(\\d+(?:[.,]\\d+)?)\\s*(?:m|meter)\\b`, 'i').exec(text)?.[1] ??
      new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*(?:m|meter)\\b[^.\\n]{0,10}(?:${src})`, 'i').exec(text)?.[1];
    if (stated) return Number(stated.replace(',', '.'));
    // default: the whole cabinet run (kitchen: both walls of an L), rounded up to half metres
    const run = spec.category === 'FURNITURE' && spec.construction_type === 'KITCHEN_SET' ? kitchenRun(spec) : (spec.attributes as { dimensions_cm?: { length: number } }).dimensions_cm?.length ?? 0;
    return Math.max(1, Math.ceil(run / 50) / 2);
  }
  const count = new RegExp(`(\\d+)\\s*(?:buah|unit|pcs|titik|x)?\\s*(?:${src})`, 'i').exec(text)?.[1];
  return count ? Math.max(1, Number(count)) : 1;
}

/**
 * Record the add-ons the client asked for as priced custom fields. An add-on the crafter already priced is left alone;
 * one Gemini created under its own label (matching the add-on's keywords) is taken over and priced.
 */
export function applyAddOns(raw: Specifications, clientText: string, preset: CategoryPreset): Specifications {
  const spec = normalizeSpecifications(raw);
  if (spec.category !== 'FURNITURE') return spec;
  const fields = [...spec.custom_fields];
  for (const def of detectAddOns(clientText)) {
    const qty = quantity(def, clientText, spec);
    const price = preset.addon_prices_idr?.[def.id] ?? def.price_idr;
    const priced: CustomField = {
      id: `cf-addon-${def.id.toLowerCase()}`,
      label: def.label,
      value: def.unit === 'm' ? `${qty} m` : `${qty} unit`,
      surcharge_idr: Math.round(price * qty),
      source: 'AI',
      kind: 'ADD_ON',
    };
    const i = fields.findIndex((f) => f.label === def.label || (f.kind !== 'DISCOUNT' && def.match.test(`${f.label} ${f.value}`)));
    if (i === -1) fields.push(priced);
    else if (fields[i].source === 'AI') fields[i] = { ...fields[i], ...priced, id: fields[i].id };
  }
  return { ...spec, custom_fields: fields };
}
