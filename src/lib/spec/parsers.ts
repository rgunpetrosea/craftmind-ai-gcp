import type { Dimensions, EmbossingType, LeatherEdgeFinish } from '@/lib/types';

/**
 * Shared offline parsers (Bahasa Indonesia + English) used by the category field definitions.
 * They only run when Gemini is unavailable, or to interpret short answers; each returns undefined when nothing matched.
 */

export const num = (s?: string) => (s ? Number(s.replace(',', '.')) : 0);
const first = <T,>(rules: Array<[RegExp, T]>, text: string) => rules.find(([re]) => re.test(text))?.[1];

/** "30x10x22", "30 x 22 cm", "panjang 30 lebar 10 tinggi 22". Two numbers = length x height. */
export function parseDimensions(text: string): Partial<Dimensions> | undefined {
  const m = /(\d+(?:[.,]\d+)?)\s*[x×*]\s*(\d+(?:[.,]\d+)?)(?:\s*[x×*]\s*(\d+(?:[.,]\d+)?))?/i.exec(text);
  if (m) return m[3] ? { length: num(m[1]), width: num(m[2]), height: num(m[3]) } : { length: num(m[1]), height: num(m[2]) };
  const p = /panjang\s*(\d+(?:[.,]\d+)?)/i.exec(text)?.[1];
  const l = /lebar\s*(\d+(?:[.,]\d+)?)/i.exec(text)?.[1];
  const t = /tinggi\s*(\d+(?:[.,]\d+)?)/i.exec(text)?.[1];
  if (p || l || t) return { length: num(p), width: num(l), height: num(t) };
  return undefined;
}

const LEATHER_TYPES: Array<[RegExp, string]> = [
  [/veg[\s-]?tan|nabati/i, 'Veg-Tan'],
  [/chrome[\s-]?tan|chrome/i, 'Chrome-Tan'],
  [/epsom/i, 'Epsom'],
  [/pull[\s-]?up/i, 'Pull-Up'],
  [/crazy[\s-]?horse/i, 'Crazy Horse'],
  [/nappa|napa/i, 'Nappa'],
  [/saffiano/i, 'Saffiano'],
  [/suede|beludru/i, 'Suede'],
  [/sintetis|synthetic|pu leather|kulit imitasi/i, 'Synthetic leather'],
];

const COLORS: Array<[RegExp, string]> = [
  [/biru tosca|tosca|teal|turquoise/i, 'Biru Tosca'],
  [/olive|zaitun/i, 'Olive Green'],
  [/espresso/i, 'Espresso Brown'],
  [/dark brown|coklat tua|cokelat tua/i, 'Dark Brown'],
  [/hitam|black/i, 'Black'],
  [/navy|biru dongker|biru/i, 'Navy'],
  [/etoupe|taupe/i, 'Etoupe'],
  [/cognac/i, 'Cognac'],
  [/merah|\bred\b|burgundy/i, 'Red'],
  [/hijau|green/i, 'Green'],
  [/putih|white/i, 'White'],
  [/natural|natur/i, 'Natural'],
  [/coklat|cokelat|brown/i, 'Brown'],
];

const stripLeatherTypes = (text: string) => LEATHER_TYPES.reduce((t, [re]) => t.replace(new RegExp(re.source, 'gi'), ' '), text);

export function parseColor(text: string): string | undefined {
  return first(COLORS, stripLeatherTypes(text));
}

/** "veg-tan coklat 1.6mm" → "Veg-Tan Brown 1.6mm"; "bahan kulit warna olive" → "Olive Green leather". */
export function parseLeather(text: string): string | undefined {
  const type = first(LEATHER_TYPES, text);
  const color = parseColor(text);
  if (type) {
    const thickness = /(\d+(?:[.,]\d+)?)\s*mm/i.exec(text)?.[1];
    return [type, color, thickness && `${thickness.replace(',', '.')}mm`].filter(Boolean).join(' ');
  }
  // Color only ("bahan kulit warna Hijau Zaitun"): keep it so sourcing can run; the crafter picks the exact leather.
  if (color && /kulit|bahan|leather/i.test(text)) return `${color} leather`;
  return undefined;
}

const WOODS: Array<[RegExp, string]> = [
  [/jati|teak/i, 'Jati (teak)'],
  [/mahoni|mahogany/i, 'Mahoni (mahogany)'],
  [/walnut/i, 'Walnut'],
  [/\boak\b|ek\b/i, 'Oak'],
  [/trembesi|suar|monkey ?pod/i, 'Trembesi (suar)'],
  [/mangga|mango/i, 'Mango wood'],
  [/pinus|pine/i, 'Pine'],
  [/sungkai/i, 'Sungkai'],
  [/plywood|multiplek|triplek/i, 'Plywood'],
  [/besi hollow|hollow/i, 'Besi hollow'],
  [/besi|iron/i, 'Besi (iron)'],
  [/stainless|baja|steel/i, 'Stainless steel'],
  [/rotan|rattan/i, 'Rotan (rattan)'],
];

export function parseWoodOrMetal(text: string): string | undefined {
  const hit = first(WOODS, text);
  if (!hit) return undefined;
  const grade = /grade\s*([a-c])\b|kelas\s*([a-c1-3])/i.exec(text);
  return grade ? `${hit} grade ${(grade[1] ?? grade[2]).toUpperCase()}` : hit;
}

/** "kaki besi hollow", "rangka stainless": a second material for legs / frame. */
export function parseSecondaryMaterial(text: string): string | undefined {
  return /(kaki|rangka|frame|legs?)\s+(besi(?: hollow)?|iron|stainless|baja|kayu \w+)/i.exec(text)?.[0].trim();
}

export function parseEdgeFinish(text: string): LeatherEdgeFinish | undefined {
  if (/burnish/i.test(text)) return 'BURNISHED';
  if (/edge paint|cat pinggir|painted edge|di-?cat/i.test(text)) return 'EDGE_PAINT';
  if (/clean.?cut|potong rata|\braw\b/i.test(text)) return 'RAW';
  if (/turned edge|lipat pinggir/i.test(text)) return 'TURNED_EDGE';
  return undefined;
}

const DECLINE_EMBOSS = /(tanpa|ga usah|gak usah|nggak usah|tidak usah|ga perlu|gak perlu|no)\s+(emboss|inisial|initial|logo|ukir|engrav|grafir)/i;

export function parseEmbossingType(text: string): EmbossingType | undefined {
  if (DECLINE_EMBOSS.test(text)) return 'NONE';
  if (/laser|ukir|engrav|grafir/i.test(text)) return 'LASER_ENGRAVING';
  if (/inisial|initial|monogram/i.test(text)) return 'EMBOSS_INITIALS';
  if (/emboss|logo|merek|brand/i.test(text)) return 'EMBOSS_LOGO';
  return undefined;
}

export function parseEmbossingText(text: string): string | undefined {
  const initials = /(?:inisial|initial|monogram)\w*\s+["']?([A-Z](?:\.?\s?[A-Z]){1,3}\.?)/.exec(text)?.[1];
  if (initials) return initials.trim();
  const motif = /motif\s+([a-z ]{3,30}?)(?:\s+di\b|,|\.|\?|$)/i.exec(text)?.[1];
  return motif?.trim();
}

export function parseEmbossingPlacement(text: string): string | undefined {
  return /(pojok kanan bawah|pojok kiri bawah|pojok kanan atas|pojok kiri atas|kanan bawah|kiri bawah|kanan atas|kiri atas|di tengah|cover luar|bagian luar|bagian dalam)/i.exec(text)?.[1];
}

export function parseStitchingMethod(text: string): string | undefined {
  if (/jahit(an)? (tangan|manual)|hand ?stitch|saddle/i.test(text)) return 'Hand saddle stitch';
  if (/jahit mesin|machine/i.test(text)) return 'Machine lockstitch';
  return undefined;
}

const THREAD_COLORS = 'hitam|putih|coklat|cokelat|merah|biru|krem|cream|natural|emas|gold|silver|navy|hijau|abu|black|white|brown|kuning';

export const parseThreadMaterial = (text: string) => /benang[^.,]{0,20}?(linen|polyester|nylon|katun|cotton|waxed)/i.exec(text)?.[1];
export const parseThreadColor = (text: string) => new RegExp(`benang[^.,]{0,25}?\\b(${THREAD_COLORS})\\b`, 'i').exec(text)?.[1];
export const parseStitchPattern = (text: string) => /(diamond|saddle|baseball|running)\s*stitch/i.exec(text)?.[0];

export function parseLining(text: string): string | undefined {
  if (/tanpa lining|unlined|ga pake lining|gak pakai lining/i.test(text)) return 'Tanpa lining';
  if (/lining[^.,]{0,15}suede|suede[^.,]{0,15}lining|beludru/i.test(text)) return 'Suede lining';
  if (/lining[^.,]{0,15}(kanvas|canvas)|(kanvas|canvas)[^.,]{0,15}lining/i.test(text)) return 'Canvas lining';
  if (/lining[^.,]{0,15}kulit|leather lining|calf lining/i.test(text)) return 'Leather lining';
  return undefined;
}

/** "YKK Excella gold", "sleting gold". */
export function parseZipper(text: string): string | undefined {
  const m = /(ykk(?:\s*excella)?)[^.,]{0,15}?(gold|silver|emas|perak|hitam|black)?|(?:sleting|resleting|zipper)\s+(gold|silver|emas|perak|hitam|black)/i.exec(text);
  if (!m) return undefined;
  return [m[1] ?? 'Zipper', m[2] ?? m[3]].filter(Boolean).join(' ');
}

export function parseCount(text: string, nouns: string): number | undefined {
  const m = new RegExp(`(\\d+)\\s*(?:slot\\s*|buah\\s*|pcs\\s*)?(?:${nouns})`, 'i').exec(text);
  return m ? Number(m[1]) : undefined;
}

export function parseLaptopInch(text: string): number | undefined {
  const m = /laptop[^.]{0,15}?(\d{2})\s*(?:inch|inci|"|in\b)|(\d{2})\s*(?:inch|inci)[^.]{0,15}laptop/i.exec(text);
  return m ? Number(m[1] ?? m[2]) : undefined;
}

/** Outer bag size that fits a laptop of the given diagonal (16:10-ish screen + 2 cm padding each side). */
export function bagDimensionsForLaptop(inch: number): Dimensions {
  const diag = inch * 2.54;
  return { length: Math.round(0.915 * diag + 4), width: 10, height: Math.round(0.63 * diag + 4) };
}

export const DECLINE = /^\s*(ga|gak|nggak|enggak|tidak|no|skip|nope)\b|terserah|bebas|ikut (aja|standar|workshop|mas|kakak)|standar( aja)?\b|apa aja|seadanya|default/i;
export const FINISHED = /itu (saja|aja)|udah (segitu|cukup)|sudah (segitu|cukup)|cukup (segitu|itu)/i;
