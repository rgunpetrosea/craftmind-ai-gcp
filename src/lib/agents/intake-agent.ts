import { Type, type Part, type Schema } from '@google/genai';
import { generateStructured, generateText, isGeminiConfigured, MODEL_CHAINS, mediaUrlToPart } from '@/lib/gcp/gemini';
import {
  CONSTRUCTION_IDS,
  EDGE_LABEL,
  detectConstruction,
  getConstruction,
  normalizeSpecifications,
  templateQuestion,
  TOPICS,
  visionGuide,
  type ConversationPlan,
  type TopicId,
} from '@/lib/spec/catalog';
import { DEFER_VALUE } from '@/lib/spec/describe';
import type {
  CategoryPreset,
  ChatMessage,
  CraftCategory,
  EdgeTreatment,
  IntakeProgress,
  IntakeResult,
  PocketLayout,
  Specifications,
} from '@/lib/types';

/**
 * Agent 1 — vision + structured parsing, and the conversational half of requirement gathering.
 *
 *   runIntakeAgent  transcript (+ sketches / voice notes) → merged Specifications   (Gemini Flash, responseSchema)
 *   composeReply    ConversationPlan → the next WhatsApp bubble                       (Gemini Flash-Lite)
 *
 * What to ask next is decided by the deterministic planner in `lib/spec/catalog.ts`, never by the
 * model, so the AI always collects every required parameter (and offers each optional detail once)
 * before the draft quotation is locked.
 */

// ---------------------------------------------------------------------------
// Merge helpers
// ---------------------------------------------------------------------------

export type DeepPartialSpec = Partial<Omit<Specifications, 'dimensions_cm' | 'pocket_layout' | 'finish' | 'customization'>> & {
  dimensions_cm?: Partial<Specifications['dimensions_cm']>;
  pocket_layout?: Partial<PocketLayout>;
  finish?: Partial<Specifications['finish']>;
  customization?: Partial<Specifications['customization']>;
};

const isUnset = (v: unknown) => v === undefined || v === null || v === '' || v === 0 || v === false || v === 'UNSPECIFIED';

/** Overlay newly extracted values onto the known spec; unset values (empty / 0 / false / UNSPECIFIED) never erase known ones. */
export function mergeSpecifications(known: Specifications, incoming: DeepPartialSpec): Specifications {
  const out = normalizeSpecifications(structuredClone(known));
  const overlay = <T extends object>(target: T, patch: Partial<T> | undefined) => {
    if (!patch) return;
    for (const [k, v] of Object.entries(patch)) {
      if (!isUnset(v)) (target as Record<string, unknown>)[k] = typeof v === 'string' ? v.trim() : v;
    }
  };
  const { dimensions_cm, pocket_layout, finish, customization, ...flat } = incoming;
  overlay(out, flat as Partial<Specifications>);
  overlay(out.dimensions_cm, dimensions_cm);
  overlay(out.pocket_layout, pocket_layout);
  overlay(out.finish, finish);
  overlay(out.customization, customization);
  return out;
}

/** Fill still-empty / "ikut standar" fields from the category preset and the construction defaults. Called when the spec is locked. */
export function applyPresetDefaults(spec: Specifications, preset: CategoryPreset): Specifications {
  const def = getConstruction(spec.construction_type);
  const out = normalizeSpecifications(structuredClone(spec));
  const pick = (value: string, fallback: string) => (!value.trim() || value === DEFER_VALUE ? fallback : value);

  out.lining_material = pick(out.lining_material, def.family === 'CARD_HOLDER' ? 'Tanpa lining (full-grain)' : preset.defaults.lining_material);
  out.structure_temper = pick(out.structure_temper, preset.defaults.structure_temper);
  out.stitching_method = pick(out.stitching_method, preset.defaults.stitching_method);
  out.edge_finish = pick(out.edge_finish, out.finish.edge_treatment !== 'UNSPECIFIED' ? edgeLabel(out.finish.edge_treatment) : preset.defaults.edge_finish);
  out.finish.zipper = out.finish.zipper === DEFER_VALUE ? 'YKK standar workshop' : out.finish.zipper;
  out.finish.strap = out.finish.strap === DEFER_VALUE ? 'Strap kulit standar workshop' : out.finish.strap;
  out.finish.hardware_notes = out.finish.hardware_notes === DEFER_VALUE ? 'Hardware standar workshop' : out.finish.hardware_notes;
  out.finish.thread_color = out.finish.thread_color === DEFER_VALUE ? 'serasi dengan kulit' : out.finish.thread_color;
  if (out.finish.edge_treatment === 'UNSPECIFIED') out.finish.edge_treatment = inferEdgeTreatment(out.edge_finish);
  if (out.customization.type === 'UNSPECIFIED') out.customization.type = 'NONE';

  // Seed any layout the client never described from the construction's usual layout.
  const pockets = out.pocket_layout;
  const hasLayout = Object.values(pockets).some((v) => v === true || (typeof v === 'number' && v > 0));
  if (!hasLayout) Object.assign(pockets, def.default_pockets);
  return out;
}

const edgeLabel = (e: EdgeTreatment) => (e === 'UNSPECIFIED' ? '' : EDGE_LABEL[e]);

function inferEdgeTreatment(text: string): EdgeTreatment {
  if (/burnish/i.test(text)) return 'BURNISHED';
  if (/paint|cat/i.test(text)) return 'EDGE_PAINT';
  if (/raw|clean.?cut|rata/i.test(text)) return 'RAW';
  if (/turned|lipat/i.test(text)) return 'TURNED_EDGE';
  return 'BURNISHED';
}

/** Messages the client sent since the last non-client message (the burst the AI is answering). */
export function lastClientBurst(messages: ChatMessage[]): ChatMessage[] {
  const burst: ChatMessage[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].sender !== 'CLIENT') break;
    burst.unshift(messages[i]);
  }
  return burst;
}

// ---------------------------------------------------------------------------
// Heuristic parser (offline / all Gemini models unavailable)
// ---------------------------------------------------------------------------

const LEATHER_TYPES: Array<[RegExp, string]> = [
  [/veg[\s-]?tan|nabati/i, 'Veg-Tan'],
  [/chrome[\s-]?tan|chrome/i, 'Chrome-Tan'],
  [/epsom/i, 'Epsom'],
  [/pull[\s-]?up/i, 'Pull-Up'],
  [/crazy[\s-]?horse/i, 'Crazy Horse'],
  [/nappa|napa/i, 'Nappa'],
  [/saffiano/i, 'Saffiano'],
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
  [/merah|red|burgundy/i, 'Red'],
  [/hijau|green/i, 'Green'],
  [/natural|natur/i, 'Natural'],
  [/coklat|cokelat|brown/i, 'Brown'],
];

const THREAD_COLORS = 'hitam|putih|coklat|cokelat|merah|biru|krem|cream|natural|emas|gold|silver|navy|hijau|abu|black|white|brown';
const num = (s?: string) => (s ? Number(s.replace(',', '.')) : 0);
const pickRule = <T,>(rules: Array<[RegExp, T]>, text: string) => rules.find(([re]) => re.test(text))?.[1];

function extractCustomization(text: string): DeepPartialSpec['customization'] | undefined {
  if (/(tanpa|ga usah|gak usah|nggak usah|tidak usah|ga perlu|gak perlu)\s+(emboss|inisial|initial|logo|ukir|engrav)/i.test(text)) return { type: 'NONE' };
  const placement = /(pojok kanan bawah|pojok kiri bawah|pojok kanan atas|pojok kiri atas|kanan bawah|kiri bawah|kanan atas|kiri atas|di tengah|cover luar|bagian luar|bagian dalam)/i.exec(text)?.[1];
  if (/laser|ukir|engrav/i.test(text)) {
    const detail = /motif\s+([a-z ]{3,30}?)(?:\s+di\b|,|\.|\?|$)/i.exec(text)?.[1];
    return { type: 'LASER_ENGRAVING', detail: detail?.trim() ?? '', placement: placement ?? '' };
  }
  const initials = /(?:inisial|initial)\w*\s+["']?([A-Z](?:\.?[A-Z]){1,3}\.?)/.exec(text)?.[1];
  if (initials || /inisial|initial/i.test(text)) return { type: 'EMBOSS_INITIALS', detail: initials ?? '', placement: placement ?? '' };
  if (/emboss|logo|merek|brand/i.test(text)) return { type: 'EMBOSS_LOGO', detail: '', placement: placement ?? '' };
  return undefined;
}

export function heuristicExtract(text: string): { category?: CraftCategory; spec: DeepPartialSpec } {
  const spec: DeepPartialSpec = {};
  const def = detectConstruction(text);
  let category: CraftCategory | undefined = def?.category;
  if (!category) {
    if (/dompet|wallet/i.test(text)) category = 'bespoke_wallet';
    else if (/sepatu|shoe|boot/i.test(text)) category = 'bespoke_shoes';
    else if (/\btas\b|bag/i.test(text)) category = 'bespoke_bag';
  }
  if (def) {
    spec.construction_type = def.id;
    spec.silhouette = def.label;
  }

  // dimensions: explicit AxBxC, else derive from a named laptop size
  const dims = /(\d+(?:[.,]\d+)?)\s*[x×*]\s*(\d+(?:[.,]\d+)?)(?:\s*[x×*]\s*(\d+(?:[.,]\d+)?))?/i.exec(text);
  const laptop = /laptop[^.]{0,15}?(\d{2})\s*(?:inch|inci|"|in\b)|(\d{2})\s*(?:inch|inci)[^.]{0,15}laptop/i.exec(text);
  if (dims) {
    spec.dimensions_cm = dims[3]
      ? { length: num(dims[1]), width: num(dims[2]), height: num(dims[3]) }
      : { length: num(dims[1]), width: 0, height: num(dims[2]) };
  } else if (laptop) {
    const diag = Number(laptop[1] ?? laptop[2]) * 2.54;
    spec.dimensions_cm = { length: Math.round(0.915 * diag + 4), width: 10, height: Math.round(0.63 * diag + 4) };
    spec.target_capacity = `Laptop ${laptop[1] ?? laptop[2]} inch`;
  }

  // leather
  const type = pickRule(LEATHER_TYPES, text);
  if (type) {
    const colorText = LEATHER_TYPES.reduce((t, [re]) => t.replace(new RegExp(re.source, 'gi'), ' '), text);
    const color = pickRule(COLORS, colorText);
    const thickness = /(\d+(?:[.,]\d+)?)\s*mm/i.exec(text)?.[1];
    spec.exterior_leather = [type, color, thickness && `${thickness.replace(',', '.')}mm`].filter(Boolean).join(' ');
    if (color) spec.finish = { ...spec.finish, color_finish: color };
  } else if (/kulit|bahan|leather|warna/i.test(text)) {
    // Color without a leather type ("bahan kulit warna Hijau Zaitun"): keep the color so stock matching / sourcing can run;
    // the crafter picks the exact leather on the dashboard.
    const color = pickRule(COLORS, text);
    if (color) {
      spec.exterior_leather = `${color} leather`;
      spec.finish = { ...spec.finish, color_finish: color };
    }
  }

  // pockets / slots
  const pockets: Partial<PocketLayout> = {};
  const cards = /(\d+)\s*(?:slot\s*)?kartu|(\d+)\s*card/i.exec(text);
  if (cards) {
    const n = Number(cards[1] ?? cards[2]);
    pockets.front_slots = Math.ceil(n / 2);
    pockets.back_slots = Math.floor(n / 2);
  }
  const cash = /(\d+)\s*(?:slot|kompartemen|ruang)\s*(?:uang|cash)/i.exec(text)?.[1];
  if (cash) pockets.cash_compartments = Number(cash);
  else if (/selipan uang|tempat uang|uang tunai|kantong tengah|saku tengah|pocket tengah/i.test(text)) pockets.central_pockets = 1;
  if (/mika|foto transparan|id window|jendela|window/i.test(text)) pockets.id_window = true;
  if (/koin.{0,25}(zip|sleting|resleting)|(zip|sleting).{0,25}koin/i.test(text)) pockets.coin_zip_pocket = true;
  if (/(saku|kantong|pocket)\s*(zipper|zip|sleting)/i.test(text)) pockets.interior_zip_pockets = 1;
  if (/saku depan|kantong depan|front pocket/i.test(text)) pockets.exterior_pockets = 1;
  if (Object.keys(pockets).length) spec.pocket_layout = pockets;

  // stitching & thread
  if (/jahit(an)? (tangan|manual)|hand ?stitch|saddle/i.test(text)) spec.stitching_method = 'Hand saddle stitch';
  else if (/jahit mesin|machine/i.test(text)) spec.stitching_method = 'Machine lockstitch';
  const threadMaterial = /benang[^.,]{0,20}?(linen|polyester|nylon|katun|cotton|waxed)/i.exec(text)?.[1];
  const threadColor = new RegExp(`benang[^.,]{0,25}?\\b(${THREAD_COLORS})\\b`, 'i').exec(text)?.[1];
  const stitchPattern = /(diamond|saddle|baseball|running)\s*stitch/i.exec(text)?.[0];
  if (threadMaterial || threadColor || stitchPattern) {
    spec.finish = { ...spec.finish, thread_material: threadMaterial ?? '', thread_color: threadColor ?? '', stitch_pattern: stitchPattern ?? '' };
  }

  // edge
  if (/burnish/i.test(text)) spec.finish = { ...spec.finish, edge_treatment: 'BURNISHED' };
  else if (/edge paint|cat pinggir|painted/i.test(text)) spec.finish = { ...spec.finish, edge_treatment: 'EDGE_PAINT' };
  else if (/clean.?cut|rata|\braw\b/i.test(text)) spec.finish = { ...spec.finish, edge_treatment: 'RAW' };
  else if (/turned edge|lipat pinggir/i.test(text)) spec.finish = { ...spec.finish, edge_treatment: 'TURNED_EDGE' };
  if (spec.finish?.edge_treatment) spec.edge_finish = edgeLabel(spec.finish.edge_treatment);

  // lining / structure
  if (/suede|beludru/i.test(text)) spec.lining_material = 'Suede lining';
  else if (/kanvas|canvas/i.test(text)) spec.lining_material = 'Canvas lining';
  else if (/foam|busa|eva/i.test(text)) spec.lining_material = 'Foam-padded lining';
  else if (/tanpa lining|unlined/i.test(text)) spec.lining_material = 'Tanpa lining';
  if (/kaku|tegap|structured|terstruktur/i.test(text)) spec.structure_temper = 'Structured / rigid';
  else if (/lemas|slouchy|soft|lembut/i.test(text)) spec.structure_temper = 'Soft / slouchy';

  // zipper, strap, hardware
  const zipper = /(ykk(?:\s*excella)?)[^.,]{0,15}?(gold|silver|emas|perak|hitam|black)?|sleting\s+(gold|silver|emas|perak|hitam|black)/i.exec(text);
  if (zipper) spec.finish = { ...spec.finish, zipper: [zipper[1] ?? 'Zipper', zipper[2] ?? zipper[3]].filter(Boolean).join(' ') };
  const strap = /(strap|tali|selempang)[^.?!]{0,40}?(full kulit|kulit|webbing|lepas|permanen)[^.?!,]{0,20}/i.exec(text)?.[0];
  if (strap) spec.finish = { ...spec.finish, strap: strap.trim() };
  const hardware = /(solid brass|kuningan|nikel|nickel|gold|emas)[^.?!,]{0,30}/i.exec(text)?.[0];
  if (hardware && /hardware|buckle|gesper|kuningan|brass/i.test(text)) spec.finish = { ...spec.finish, hardware_notes: hardware.trim() };

  const customization = extractCustomization(text);
  if (customization) spec.customization = customization;
  const capacity = /(?:muat|fit|kapasitas|capacity)\s+[^.!?\n]{0,50}/i.exec(text)?.[0];
  if (capacity && !spec.target_capacity) spec.target_capacity = capacity.trim();

  return { category, spec };
}

/** "+3 cm taller", "add a front pocket": relative edits to an already-parsed spec. Offline parser only. */
export function applyRelativeEdits(spec: Specifications, burstText: string, known: Specifications): Specifications {
  const out = structuredClone(spec);
  const hasSize = known.dimensions_cm.length > 0 || known.dimensions_cm.height > 0;
  const m = /(kurang|tambah|lebih|kekecilan|kebesaran)\s+(tinggi|panjang|lebar)\D{0,15}(\d+(?:[.,]\d+)?)\s*cm/i.exec(burstText);
  if (m && hasSize) {
    const sign = /lebih|kebesaran/i.test(m[1]) ? -1 : 1;
    const key = ({ tinggi: 'height', panjang: 'length', lebar: 'width' } as const)[m[2].toLowerCase() as 'tinggi' | 'panjang' | 'lebar'];
    out.dimensions_cm[key] = Math.max(0, known.dimensions_cm[key] + sign * num(m[3]));
  }
  if (hasSize && /tambah\w*\s+(saku|kantong)\s+depan|(saku|kantong)\s+depan\s+(dong|ya|juga)/i.test(burstText)) {
    // relative to the spec before this message (the heuristic pass may already have counted "saku depan" once)
    out.pocket_layout.exterior_pockets = known.pocket_layout.exterior_pockets + 1;
  }
  return out;
}

const DECLINE = /^\s*(ga|gak|nggak|enggak|tidak|no|skip|nope)\b|terserah|bebas|ikut (aja|standar|workshop|mas|kakak)|standar( aja)?\b|apa aja|seadanya|default/i;

/**
 * Interpret a short answer against the question that was just asked. "Terserah" defers the topic to
 * workshop defaults; with a single open text question, the raw reply is taken as the answer.
 */
export function applyAnswerToAsked(spec: Specifications, lastAsked: string[], burstText: string): Specifications {
  const text = burstText.trim();
  if (!text || lastAsked.length === 0) return spec;
  const out = structuredClone(spec);
  const declined = DECLINE.test(text);
  // Card layout is required but has a sensible standard per form factor, so it may be deferred; size and leather may not.
  const deferrable = (t: TopicId) => !TOPICS[t].required || t === 'card_layout';
  const openTopics = (lastAsked as TopicId[]).filter((t) => TOPICS[t] && !TOPICS[t].isFilled(out) && deferrable(t));
  const raw = text.replace(/\s+/g, ' ').slice(0, 80);

  for (const topic of openTopics) {
    if (declined) {
      if (topic === 'card_layout') Object.assign(out.pocket_layout, getConstruction(out.construction_type).default_pockets);
      else if (topic === 'customization') out.customization.type = 'NONE';
      else if (topic === 'thread') out.finish.thread_color = DEFER_VALUE;
      else if (topic === 'lining') out.lining_material = DEFER_VALUE;
      else if (topic === 'edge') out.edge_finish = DEFER_VALUE;
      else if (topic === 'zipper') out.finish.zipper = DEFER_VALUE;
      else if (topic === 'strap') out.finish.strap = DEFER_VALUE;
      else if (topic === 'hardware') out.finish.hardware_notes = DEFER_VALUE;
    } else if (openTopics.length === 1) {
      if (topic === 'strap') out.finish.strap = raw;
      else if (topic === 'hardware') out.finish.hardware_notes = raw;
      else if (topic === 'zipper') out.finish.zipper = raw;
      else if (topic === 'lining') out.lining_material = raw;
      else if (topic === 'thread') out.finish.thread_color = raw;
      else if (topic === 'edge') out.edge_finish = raw;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Gemini structured extraction (vision + text)
// ---------------------------------------------------------------------------

const S = { type: Type.STRING } as const;
const N = { type: Type.NUMBER } as const;
const B = { type: Type.BOOLEAN } as const;
const obj = (properties: Record<string, Schema>): Schema => ({ type: Type.OBJECT, properties, required: Object.keys(properties) });

const INTAKE_SCHEMA: Schema = obj({
  vision_notes: { ...S, description: 'What you SEE in any attached sketch/photo that decides the construction type (fold lines, slot count/position, zips, straps). Empty string if no image.' },
  craft_category: { type: Type.STRING, enum: ['bespoke_bag', 'bespoke_wallet', 'bespoke_shoes'] },
  client_finished: { ...B, description: 'True only if the client says they have nothing more to add (e.g. "itu saja", "udah segitu").' },
  specifications: obj({
    construction_type: { type: Type.STRING, enum: ['UNSPECIFIED', ...CONSTRUCTION_IDS.filter((c) => c !== 'UNSPECIFIED')] },
    silhouette: S,
    target_capacity: S,
    dimensions_cm: obj({ length: N, width: N, height: N }),
    exterior_leather: { ...S, description: 'Leather type + color + thickness ONLY, e.g. "Epsom Black 1.2mm". Rigidity/softness goes in structure_temper.' },
    lining_material: S,
    structure_temper: S,
    stitching_method: S,
    edge_finish: S,
    pocket_layout: obj({
      front_slots: N,
      back_slots: N,
      central_pockets: N,
      cash_compartments: N,
      id_window: B,
      coin_zip_pocket: B,
      interior_zip_pockets: N,
      exterior_pockets: N,
    }),
    finish: obj({
      edge_treatment: { type: Type.STRING, enum: ['UNSPECIFIED', 'BURNISHED', 'EDGE_PAINT', 'RAW', 'TURNED_EDGE'] },
      surface_finish: S,
      color_finish: S,
      thread_color: S,
      thread_material: S,
      stitch_pattern: S,
      zipper: S,
      strap: S,
      hardware_notes: S,
    }),
    customization: obj({
      type: { type: Type.STRING, enum: ['UNSPECIFIED', 'NONE', 'EMBOSS_INITIALS', 'EMBOSS_LOGO', 'LASER_ENGRAVING'] },
      detail: S,
      placement: S,
    }),
  }),
});

const SYSTEM_INSTRUCTION = `You are the intake specialist of a bespoke leather workshop that talks to clients on WhatsApp (mostly Bahasa Indonesia).
Read the whole transcript plus any attached sketches / photos / voice notes and return the complete, UPDATED product specification.

HOW TO FILL FIELDS
- Start from the "currently known specification" and change only what the client's latest messages add or correct.
- If the ASSISTANT recommended something (a leather, zipper, strap, hardware...) and the client agrees ("iya", "boleh", "sip", "oke", "itu aja"), adopt the recommendation as the client's choice.
- Corrections are relative to the known spec: "kurang tinggi 3cm" adds 3 cm to height; "tambah saku depan" adds one exterior pocket.
- Anything the client has not said: "" / 0 / false / "UNSPECIFIED". NEVER invent dimensions, leather, counts or customization.
- You MAY derive dimensions from a named object the client wants to fit (e.g. 14-inch laptop ≈ 36 x 8 x 27 cm bag; padel racket ≈ 30 x 10 x 60 cm sleeve) — put the object in target_capacity.
- Convert inches to cm. dimensions_cm = length (front width) x width (depth) x height.
- If the client answers a question with "terserah", "bebas", "ikut standar", "ga usah" or similar for a detail topic, write exactly "${DEFER_VALUE}" in that text field (for customization use type NONE; for edge use edge_finish = "${DEFER_VALUE}"; for pocket_layout leave the counts at 0 — the workshop's standard layout is applied).
- Pocket counts: split card slots between front_slots and back_slots (flat card holders: front/back faces; wallets: left/right halves). "selipan uang di tengah" = central_pockets 1.
- customization: initials/monogram → EMBOSS_INITIALS (detail = the letters, placement = where); brand/logo emboss → EMBOSS_LOGO; laser/carved artwork → LASER_ENGRAVING (detail = the motif).

CONSTRUCTION TYPE — decide carefully, this drives the pattern, price and mockup. Use the photo first, then the words:
${visionGuide()}
Do not call a single flat sleeve a bifold, or a bifold a card holder. If a photo shows no fold line, it is NOT bifold/trifold. If it truly fits none, use OTHER_CUSTOM; if there is no evidence yet, UNSPECIFIED.
craft_category must match the construction type's family (wallets and card holders are bespoke_wallet).`;

function transcriptText(messages: ChatMessage[]): string {
  return messages
    .map((m) => {
      const media = m.media_type ? ` [${m.media_type === 'image' ? 'attached a sketch/photo' : 'sent a voice note'}]` : '';
      return `[${m.sender}] ${m.text ?? ''}${media}`;
    })
    .join('\n');
}

async function mediaParts(messages: ChatMessage[]): Promise<Part[]> {
  const parts: Part[] = [];
  for (const m of messages.filter((x) => x.sender === 'CLIENT' && x.media_url).slice(-4)) {
    const part = await mediaUrlToPart(m.media_url!, m.media_mime_type).catch(() => null);
    if (part) parts.push(part);
  }
  return parts;
}

export async function runIntakeAgent(input: {
  messages: ChatMessage[];
  known: Specifications;
  category: CraftCategory;
  progress?: IntakeProgress;
}): Promise<IntakeResult> {
  const known = normalizeSpecifications(input.known);
  const burst = lastClientBurst(input.messages);
  const burstText = burst.map((m) => m.text ?? '').join('\n');
  const lastAsked = input.progress?.last_asked ?? [];
  const alreadyProcessed = burst.length > 0 && burst[burst.length - 1].id === input.progress?.processed_message_id;

  let merged: Specifications | null = null;
  let result: Pick<IntakeResult, 'client_finished' | 'vision_notes'> & { craft_category?: CraftCategory } = { client_finished: false };

  if (isGeminiConfigured()) {
    try {
      const parts: Part[] = [
        {
          text:
            `Currently known specification:\n${JSON.stringify(known)}\n\n` +
            `Topics the assistant just asked about (the client's latest reply most likely answers these): ${lastAsked.join(', ') || 'none'}\n\n` +
            `WhatsApp transcript:\n${transcriptText(input.messages)}`,
        },
        ...(await mediaParts(input.messages)),
      ];
      const out = await generateStructured<{
        vision_notes: string;
        craft_category: CraftCategory;
        client_finished: boolean;
        specifications: Specifications;
      }>({ models: MODEL_CHAINS.flash, systemInstruction: SYSTEM_INSTRUCTION, schema: INTAKE_SCHEMA, parts });
      merged = mergeSpecifications(known, out.specifications);
      result = { client_finished: out.client_finished, vision_notes: out.vision_notes || input.progress?.vision_notes, craft_category: out.craft_category };
    } catch (err) {
      console.warn('[intake-agent] ALL Gemini models failed — answering with the offline heuristic parser:', err);
    }
  }

  if (!merged) {
    const all = input.messages.filter((m) => m.sender === 'CLIENT' && m.text).map((m) => m.text).join('\n');
    const first = heuristicExtract(all);
    const latest = heuristicExtract(burstText); // the newest message wins on conflicts
    merged = mergeSpecifications(mergeSpecifications(known, first.spec), latest.spec);
    if (!alreadyProcessed) merged = applyRelativeEdits(merged, burstText, known);
    result = {
      client_finished: /itu (saja|aja)|udah (segitu|cukup)|sudah (segitu|cukup)|cukup (segitu|itu)/i.test(burstText),
      vision_notes: input.progress?.vision_notes,
      craft_category: latest.category ?? first.category,
    };
  }

  if (!alreadyProcessed) merged = applyAnswerToAsked(merged, lastAsked, burstText);

  const def = getConstruction(merged.construction_type);
  const craft_category = merged.construction_type !== 'UNSPECIFIED' ? def.category : (result.craft_category ?? input.category);
  if (!merged.silhouette && merged.construction_type !== 'UNSPECIFIED') merged.silhouette = def.label;

  return { craft_category, specifications: merged, client_finished: result.client_finished, vision_notes: result.vision_notes };
}

// ---------------------------------------------------------------------------
// Conversational reply (what the client reads)
// ---------------------------------------------------------------------------

const REPLY_INSTRUCTION = `You are the friendly WhatsApp assistant of a bespoke leather workshop. Reply in the client's language (usually casual-polite Bahasa Indonesia, address them as "kak").
Write ONE short WhatsApp message (2-4 sentences, light emoji at most one or two). Greet the client by name ONLY when the prompt says FIRST TURN; otherwise continue the conversation without a greeting:
1. Briefly acknowledge what the client just told you, using their own details (and, if they sent a photo or sketch, what you understood from it).
2. Where it helps, add a one-line recommendation (e.g. Epsom resists scratches; veg-tan develops patina; flat card holders are slimmer than bifolds).
3. Then ask ONLY the topics listed under "ASK NOW", woven naturally into the message (maximum two questions). Do not ask anything else and do not repeat questions the client already answered.
Never quote prices, discounts or delivery dates; the crafter confirms those later. Do not use markdown headings or long bullet lists.`;

export async function composeReply(input: {
  clientName: string;
  plan: ConversationPlan;
  spec: Specifications;
  messages: ChatMessage[];
  visionNotes?: string;
  isFirstTurn: boolean;
}): Promise<string> {
  const fallback = templateQuestion(input.clientName, input.plan.ask, input.isFirstTurn);
  if (!isGeminiConfigured() || input.plan.ask.length === 0) return fallback;
  try {
    const topics = input.plan.ask.map((t) => `- ${t}: ${TOPICS[t].ask}`).join('\n');
    return await generateText({
      models: MODEL_CHAINS.fast,
      systemInstruction: REPLY_INSTRUCTION,
      parts: [
        {
          text:
            `Client name: ${input.clientName}\n${input.isFirstTurn ? 'FIRST TURN (greet the client)' : 'FOLLOW-UP TURN (no greeting)'}\n` +
            `Specification collected so far: ${JSON.stringify(input.spec)}\n` +
            (input.visionNotes ? `What the photo/sketch shows: ${input.visionNotes}\n` : '') +
            `\nRecent chat:\n${transcriptText(input.messages.slice(-10))}\n\nASK NOW:\n${topics}`,
        },
      ],
    });
  } catch (err) {
    console.warn('[intake-agent] reply composition failed, using template question:', err);
    return fallback;
  }
}

