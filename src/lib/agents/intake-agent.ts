import { Type, type Part, type Schema } from '@google/genai';
import { generateStructured, isGeminiConfigured, mediaUrlToPart, MODELS } from '@/lib/gcp/gemini';
import type { CategoryPreset, ChatMessage, CraftCategory, IntakeResult, Specifications } from '@/lib/types';

/**
 * Agent 1 — Structured JSON Parsing.
 * Reads the WhatsApp transcript (text, sketches, voice notes) and returns the
 * merged specification plus the next reply to the client.
 */

export const REQUIRED_FIELDS = ['silhouette', 'dimensions_cm', 'exterior_leather'] as const;

const FIELD_QUESTIONS: Record<(typeof REQUIRED_FIELDS)[number], string> = {
  silhouette: 'model/bentuk yang diinginkan (mis. sling bag, tote, bifold, derby)',
  dimensions_cm: 'ukuran perkiraan (P x L x T dalam cm)',
  exterior_leather: 'jenis & warna kulit (mis. Veg-Tan coklat 1.6mm, Epsom hitam)',
};

export function missingFields(spec: Specifications): string[] {
  const d = spec.dimensions_cm;
  return REQUIRED_FIELDS.filter((f) => {
    if (f === 'dimensions_cm') return !(d.length > 0 && d.height > 0);
    return !spec[f].trim();
  });
}

/** Overlay newly extracted values onto the known spec; empty values never erase known ones. */
export function mergeSpecifications(known: Specifications, incoming: Partial<Specifications>): Specifications {
  const merged: Specifications = { ...known, dimensions_cm: { ...known.dimensions_cm } };
  for (const [key, value] of Object.entries(incoming) as Array<[keyof Specifications, unknown]>) {
    if (key === 'dimensions_cm') {
      const d = value as Specifications['dimensions_cm'] | undefined;
      if (d?.length) merged.dimensions_cm.length = d.length;
      if (d?.width) merged.dimensions_cm.width = d.width;
      if (d?.height) merged.dimensions_cm.height = d.height;
    } else if (typeof value === 'string' && value.trim()) {
      merged[key] = value.trim();
    }
  }
  return merged;
}

export function applyPresetDefaults(spec: Specifications, preset: CategoryPreset): Specifications {
  return {
    ...spec,
    lining_material: spec.lining_material || preset.defaults.lining_material,
    structure_temper: spec.structure_temper || preset.defaults.structure_temper,
    stitching_method: spec.stitching_method || preset.defaults.stitching_method,
    edge_finish: spec.edge_finish || preset.defaults.edge_finish,
  };
}

export function askForMissing(clientName: string, missing: string[]): string {
  const asks = missing.map((f) => `• ${FIELD_QUESTIONS[f as keyof typeof FIELD_QUESTIONS] ?? f}`).join('\n');
  return `Terima kasih kak ${clientName}! 🙏 Supaya kami bisa siapkan desain & penawaran, boleh dibantu info berikut:\n${asks}\nBoleh juga kirim sketsa atau foto referensi ya.`;
}

// ---------------------------------------------------------------------------
// Heuristic parser (offline / no API key)
// ---------------------------------------------------------------------------

const CATEGORY_RULES: Array<[CraftCategory, RegExp]> = [
  ['bespoke_wallet', /dompet|wallet|card ?holder|cardholder/i],
  ['bespoke_shoes', /sepatu|shoe|boot|loafer|oxford|derby|sneaker/i],
  ['bespoke_bag', /\btas\b|bag|tote|sling|backpack|ransel|clutch|satchel|messenger/i],
];

const SILHOUETTES: Array<[RegExp, string]> = [
  [/sling|selempang|crossbody/i, 'Sling bag'],
  [/tote/i, 'Tote bag'],
  [/messenger/i, 'Messenger bag'],
  [/satchel/i, 'Satchel'],
  [/backpack|ransel/i, 'Backpack'],
  [/clutch/i, 'Clutch'],
  [/bucket/i, 'Bucket bag'],
  [/long wallet|dompet panjang/i, 'Long wallet'],
  [/bifold|lipat dua/i, 'Bifold wallet'],
  [/card ?holder/i, 'Card holder'],
  [/chelsea/i, 'Chelsea boots'],
  [/oxford/i, 'Oxford'],
  [/derby/i, 'Derby'],
  [/loafer/i, 'Loafer'],
  [/top ?handle|hand ?bag|handbag/i, 'Top-handle bag'],
];

const LEATHER_TYPES: Array<[RegExp, string]> = [
  [/veg[\s-]?tan|nabati/i, 'Veg-Tan'],
  [/epsom/i, 'Epsom'],
  [/pull[\s-]?up/i, 'Pull-Up'],
  [/crazy[\s-]?horse/i, 'Crazy Horse'],
  [/nappa|napa/i, 'Nappa'],
  [/saffiano/i, 'Saffiano'],
];

const COLORS: Array<[RegExp, string]> = [
  [/dark brown|coklat tua|cokelat tua/i, 'Dark Brown'],
  [/hitam|black/i, 'Black'],
  [/navy|biru/i, 'Navy'],
  [/etoupe|taupe/i, 'Etoupe'],
  [/cognac/i, 'Cognac'],
  [/natural|natur/i, 'Natural'],
  [/coklat|cokelat|brown/i, 'Brown'],
];

function pick<T>(rules: Array<[RegExp, T]>, text: string): T | undefined {
  return rules.find(([re]) => re.test(text))?.[1];
}

function heuristicExtract(text: string): { category?: CraftCategory; spec: Partial<Specifications> } {
  const spec: Partial<Specifications> = {};
  const category = CATEGORY_RULES.find(([, re]) => re.test(text))?.[0];

  const silhouette = pick(SILHOUETTES, text);
  if (silhouette) {
    const details = [/flap/i.test(text) && 'flap', /turn.?lock|kunci putar/i.test(text) && 'turn-lock'].filter(Boolean);
    spec.silhouette = details.length ? `${silhouette} with ${details.join(' & ')}` : silhouette;
  }

  const dims = /(\d+(?:[.,]\d+)?)\s*[x×*]\s*(\d+(?:[.,]\d+)?)(?:\s*[x×*]\s*(\d+(?:[.,]\d+)?))?/i.exec(text);
  const num = (s?: string) => (s ? Number(s.replace(',', '.')) : 0);
  if (dims) {
    spec.dimensions_cm = dims[3]
      ? { length: num(dims[1]), width: num(dims[2]), height: num(dims[3]) }
      : { length: num(dims[1]), width: 0, height: num(dims[2]) };
  } else {
    const p = /panjang\s*(\d+)/i.exec(text)?.[1];
    const l = /lebar\s*(\d+)/i.exec(text)?.[1];
    const t = /tinggi\s*(\d+)/i.exec(text)?.[1];
    if (p || l || t) spec.dimensions_cm = { length: num(p), width: num(l), height: num(t) };
  }

  const type = pick(LEATHER_TYPES, text);
  if (type) {
    const colorText = LEATHER_TYPES.reduce((t, [re]) => t.replace(new RegExp(re.source, 'gi'), ' '), text);
    const color = pick(COLORS, colorText);
    const thickness = /(\d+(?:[.,]\d+)?)\s*mm/i.exec(text)?.[1];
    spec.exterior_leather = [type, color, thickness && `${thickness.replace(',', '.')}mm`].filter(Boolean).join(' ');
  }

  const capacity = /(?:muat|fit|kapasitas|capacity|bisa masuk)[^.!?\n]{0,50}/i.exec(text)?.[0];
  if (capacity) spec.target_capacity = capacity.trim();

  if (/jahit tangan|hand ?stitch|saddle/i.test(text)) spec.stitching_method = 'Hand saddle stitch';
  else if (/jahit mesin|machine/i.test(text)) spec.stitching_method = 'Machine lockstitch';

  if (/burnish/i.test(text)) spec.edge_finish = 'Burnished edge';
  else if (/edge paint|cat pinggir|painted/i.test(text)) spec.edge_finish = 'Painted edge';
  else if (/turned edge|lipat pinggir/i.test(text)) spec.edge_finish = 'Turned edge';

  if (/suede|beludru/i.test(text)) spec.lining_material = 'Suede lining';
  else if (/kanvas|canvas/i.test(text)) spec.lining_material = 'Canvas lining';
  else if (/tanpa lining|unlined/i.test(text)) spec.lining_material = 'Unlined';

  if (/kaku|structured|terstruktur/i.test(text)) spec.structure_temper = 'Structured';
  else if (/lemas|slouchy|soft|lembut/i.test(text)) spec.structure_temper = 'Soft / slouchy';

  return { category, spec };
}

// ---------------------------------------------------------------------------
// Gemini Flash structured extraction
// ---------------------------------------------------------------------------

const INTAKE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    craft_category: { type: Type.STRING, enum: ['bespoke_bag', 'bespoke_wallet', 'bespoke_shoes'] },
    specifications: {
      type: Type.OBJECT,
      properties: {
        silhouette: { type: Type.STRING },
        target_capacity: { type: Type.STRING },
        dimensions_cm: {
          type: Type.OBJECT,
          properties: {
            length: { type: Type.NUMBER },
            width: { type: Type.NUMBER },
            height: { type: Type.NUMBER },
          },
          required: ['length', 'width', 'height'],
        },
        exterior_leather: { type: Type.STRING, description: 'Leather type, color and thickness, e.g. "Veg-Tan Brown 1.6mm".' },
        lining_material: { type: Type.STRING },
        structure_temper: { type: Type.STRING },
        stitching_method: { type: Type.STRING },
        edge_finish: { type: Type.STRING },
      },
      required: [
        'silhouette',
        'target_capacity',
        'dimensions_cm',
        'exterior_leather',
        'lining_material',
        'structure_temper',
        'stitching_method',
        'edge_finish',
      ],
    },
    confidence: { type: Type.NUMBER, description: '0..1 confidence that the client intent is understood.' },
    reply_to_client: { type: Type.STRING },
  },
  required: ['craft_category', 'specifications', 'confidence', 'reply_to_client'],
};

const SYSTEM_INSTRUCTION = `You are the intake assistant of a bespoke leather workshop on WhatsApp.
Extract the client's product specification from the conversation, sketches and voice notes.
- Use empty strings / 0 for anything the client has not stated. Never invent dimensions or leather.
- Convert inches to cm. Dimensions are length (width of the front) x width (depth) x height.
- Required before quoting: silhouette, dimensions (length & height), exterior leather.
- reply_to_client: short, warm, in the client's language (usually Bahasa Indonesia), asking only for
  the missing required details. Never promise prices or dates; the crafter confirms those.`;

async function transcriptParts(messages: ChatMessage[]): Promise<Part[]> {
  const lines = messages.map((m) => {
    const media = m.media_type ? ` [${m.media_type === 'image' ? 'sent a sketch/photo' : 'sent a voice note'}]` : '';
    return `[${m.sender}] ${m.text ?? ''}${media}`;
  });
  const parts: Part[] = [{ text: `WhatsApp transcript:\n${lines.join('\n')}` }];
  // Attach the most recent client media (sketches / voice notes) for multimodal parsing.
  const media = messages.filter((m) => m.sender === 'CLIENT' && m.media_url).slice(-4);
  for (const m of media) {
    const part = await mediaUrlToPart(m.media_url!, m.media_mime_type);
    if (part) parts.push(part);
  }
  return parts;
}

export async function runIntakeAgent(input: {
  messages: ChatMessage[];
  known: Specifications;
  category: CraftCategory;
  clientName: string;
  presetFor: (c: CraftCategory) => CategoryPreset;
}): Promise<IntakeResult> {
  if (isGeminiConfigured()) {
    try {
      const parts = await transcriptParts(input.messages);
      parts.unshift({ text: `Currently known specification:\n${JSON.stringify(input.known)}` });
      const out = await generateStructured<Omit<IntakeResult, 'missing_fields'>>({
        model: MODELS.flash,
        systemInstruction: SYSTEM_INSTRUCTION,
        schema: INTAKE_SCHEMA,
        parts,
      });
      const merged = applyPresetDefaults(mergeSpecifications(input.known, out.specifications), input.presetFor(out.craft_category));
      return { ...out, specifications: merged, missing_fields: missingFields(merged) };
    } catch (err) {
      console.warn('[intake-agent] Gemini Flash failed, using heuristic parser:', err);
    }
  }

  const clientText = input.messages
    .filter((m) => m.sender === 'CLIENT' && m.text)
    .map((m) => m.text)
    .join('\n');
  const { category, spec } = heuristicExtract(clientText);
  const craft_category = category ?? input.category;
  const merged = applyPresetDefaults(mergeSpecifications(input.known, spec), input.presetFor(craft_category));
  const missing = missingFields(merged);
  const known = REQUIRED_FIELDS.length - missing.length;
  return {
    craft_category,
    specifications: merged,
    missing_fields: missing,
    confidence: Math.min(1, 0.25 + known * 0.25),
    reply_to_client: askForMissing(input.clientName, missing),
  };
}
