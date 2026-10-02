import type { Part } from '@google/genai';
import { generateStructured, generateText, isGeminiConfigured, MODEL_CHAINS, mediaUrlToPart } from '@/lib/gcp/gemini';
import {
  attrs,
  categoryOfConstruction,
  changeCategory,
  coerceValue,
  detectProduct,
  isClassified,
  isFieldSet,
  isValueSet,
  mergeCustomFields,
  normalizeSpecifications,
  schemaOf,
  templateQuestion,
  topicsFor,
  visionGuide,
  type ConversationPlan,
} from '@/lib/spec/catalog';
import { resolveDimensionSource } from '@/lib/spec/dimensions';
import { classificationSchema, extractionSchema } from '@/lib/spec/gemini-schema';
import { referenceGuide } from '@/lib/spec/references';
import { findGlossary, NON_STANDARD, PRICE_OR_TIMELINE, QUESTION, REQUEST_AS_QUESTION, withoutExplanationQuestions } from '@/lib/spec/glossary';
import { DECLINE, FINISHED, num } from '@/lib/spec/parsers';
import type {
  AttributeValue,
  ChatMessage,
  ClientQuestion,
  ConstructionType,
  CraftCategory,
  DimensionMode,
  IntakeProgress,
  IntakeResult,
  Specifications,
} from '@/lib/types';

/**
 * Agent 1 — vision + structured parsing, and the conversational half of requirement gathering.
 *
 *   Stage 1  classify     transcript (+ photos) → category + form factor        (Gemini Flash, small enum schema)
 *   Stage 2  extract      ONLY the active category's attributes                  (Gemini Flash, schema built per category)
 *   Reply    composeReply phrases the planner's next questions                   (Gemini Flash-Lite)
 *
 * Stage 1 runs only while the product is unknown or the client names a product from another category, so a settled
 * conversation costs one structured call per turn. Every stage has a registry-driven offline fallback.
 */

// ---------------------------------------------------------------------------
// Merge helpers
// ---------------------------------------------------------------------------

/** Overlay incoming attribute values that are set and valid for the spec's category; unset values never erase. */
export function mergeAttributes(spec: Specifications, incoming: Record<string, unknown> | undefined): Specifications {
  if (!incoming) return spec;
  const out = normalizeSpecifications(structuredClone(spec));
  const fields = schemaOf(out.category).fields;
  const target = attrs(out);
  for (const [key, raw] of Object.entries(incoming)) {
    const field = fields[key];
    if (!field) continue; // attribute of another category → dropped, never mixed in
    const value = coerceValue(field, raw);
    if (value === undefined || !isValueSet(field, value)) continue;
    if (field.type === 'dimensions') {
      const cur = target[key] as unknown as Record<string, number>;
      const inc = value as unknown as Record<string, number>;
      target[key] = { length: inc.length || cur.length, width: inc.width || cur.width, height: inc.height || cur.height } as AttributeValue;
    } else target[key] = value;
  }
  return out;
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
// Offline (heuristic) extraction, driven by each field's `parse`
// ---------------------------------------------------------------------------

export function heuristicAttributes(category: CraftCategory, text: string): Record<string, AttributeValue> {
  const out: Record<string, AttributeValue> = {};
  for (const [key, field] of Object.entries(schemaOf(category).fields)) {
    const parsed = field.parse?.(text);
    if (parsed === undefined) continue;
    const value = coerceValue(field, parsed);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** "+3 cm taller", "tambah saku depan": corrections relative to the spec before this message. */
export function applyRelativeEdits(spec: Specifications, burstText: string, known: Specifications): Specifications {
  if (spec.category !== known.category) return spec;
  const out = structuredClone(spec);
  const a = attrs(out);
  const k = attrs(known);
  const m = /(kurang|tambah|lebih|kekecilan|kebesaran)\s+(tinggi|panjang|lebar)\D{0,15}(\d+(?:[.,]\d+)?)\s*cm/i.exec(burstText);
  if (m && k.dimensions_cm) {
    const d = { ...(k.dimensions_cm as unknown as Record<string, number>) };
    if (d.length > 0 || d.height > 0) {
      const sign = /lebih|kebesaran/i.test(m[1]) ? -1 : 1;
      const axis = ({ tinggi: 'height', panjang: 'length', lebar: 'width' } as const)[m[2].toLowerCase() as 'tinggi' | 'panjang' | 'lebar'];
      d[axis] = Math.max(0, d[axis] + sign * num(m[3]));
      a.dimensions_cm = d as unknown as AttributeValue;
    }
  }
  if (out.category === 'BAG' && /tambah\w*\s+(saku|kantong)\s+depan|(saku|kantong)\s+depan\s+(dong|ya|juga)/i.test(burstText)) {
    a.exterior_pockets = (k.exterior_pockets as number) + 1;
  }
  return out;
}

/**
 * Read a short answer against the topics just asked. "Terserah" defers them to workshop defaults; with a single open
 * topic, field parsers get the raw reply first ("full kulit" → strap), then it becomes the topic's first text field.
 */
export function applyAnswerToAsked(spec: Specifications, lastAsked: string[], burstText: string): { spec: Specifications; deferred: string[] } {
  const text = burstText.trim();
  const topics = topicsFor(spec).filter((t) => lastAsked.includes(`${spec.category}:${t.id}`));
  if (!text || topics.length === 0) return { spec, deferred: [] };

  const open = topics.filter((t) => t.fields.length && !t.fields.some((f) => isFieldSet(spec, f)));
  if (DECLINE.test(text)) return { spec, deferred: open.filter((t) => t.deferrable).map((t) => `${spec.category}:${t.id}`) };
  if (open.length !== 1 || open[0].required) return { spec, deferred: [] };

  const fields = schemaOf(spec.category).fields;
  const out = structuredClone(spec);
  for (const key of open[0].fields) {
    const parsed = fields[key].parse?.(text);
    const value = parsed === undefined ? undefined : coerceValue(fields[key], parsed);
    if (value !== undefined && isValueSet(fields[key], value)) {
      attrs(out)[key] = value;
      return { spec: out, deferred: [] };
    }
  }
  // A question ("raw edge itu kayak gimana?") is not an answer; never store it as the field value.
  if (QUESTION.test(text)) return { spec, deferred: [] };
  const textKey = open[0].fields.find((k) => fields[k].type === 'text');
  if (textKey) attrs(out)[textKey] = text.replace(/\s+/g, ' ').slice(0, 80);
  return { spec: out, deferred: [] };
}

// ---------------------------------------------------------------------------
// Questions & non-standard requests (offline detection; Gemini classifies these itself)
// ---------------------------------------------------------------------------

const DESIGN_QUESTION = /motif|bentuk|model(nya)?|warna|tampilan|depan(nya)?|belakang(nya)?|kelihatan|jadinya|hasilnya|gambar/i;

export function detectQuestions(burstText: string, category: CraftCategory): ClientQuestion[] {
  return burstText
    .split(/(?<=[?.!])\s+|\n+/)
    .map((t) => t.trim())
    .filter((t) => t && QUESTION.test(t) && !REQUEST_AS_QUESTION.test(t))
    .map((text) => ({
      text,
      kind: PRICE_OR_TIMELINE.test(text)
        ? 'PRICE_TIMELINE'
        : findGlossary(text, category).length
          ? 'TERMINOLOGY'
          : DESIGN_QUESTION.test(text)
            ? 'DESIGN'
            : 'OTHER',
    }));
}

export function detectNonStandard(burstText: string): string | undefined {
  const hits = [...new Set([...burstText.matchAll(new RegExp(NON_STANDARD.source, 'gi'))].map((m) => m[0].toLowerCase()))];
  return hits.length ? `Permintaan di luar standar workshop: ${hits.map((h) => `"${h}"`).join(', ')}` : undefined;
}

// ---------------------------------------------------------------------------
// Gemini
// ---------------------------------------------------------------------------

const CLASSIFY_INSTRUCTION = `You classify bespoke craft requests that arrive on WhatsApp (mostly Bahasa Indonesia).
Decide which ONE craft category the conversation is about and, if possible, the exact form factor.
Use the photo/sketch first, then the words. Categories and form factors:
${visionGuide()}
Rules: a sleeve with no fold line is FLAT_CARD_HOLDER, never BIFOLD_WALLET. Wallets/card holders are SMALL_GOODS, not BAG.
If the client clearly switched to a different product, classify the NEW product. If nothing is known yet, construction_type = UNSPECIFIED
and pick the most likely category (CUSTOM_GENERIC if unclear).`;

function extractInstruction(category: CraftCategory): string {
  const s = schemaOf(category);
  return `You are the intake specialist of a bespoke workshop. The client wants a ${s.noun} (category ${s.id}: ${s.scope}).
Read the transcript plus any attached photos / voice notes and return the complete, UPDATED specification for THIS category only.
- Start from the "currently known specification"; change only what the client's messages add or correct.
- Anything not stated: "" / 0 / false / "UNSPECIFIED". Never invent materials, counts or personalization.
- If the ASSISTANT recommended something and the client agrees ("iya", "boleh", "sip", "oke"), adopt it.
- A term inside a QUESTION ("raw edge itu kayak gimana?", "bedanya Epsom sama Togo apa?") is NOT a choice: leave that
  attribute unchanged until the client states a preference. A request phrased as a question ("bisa bikin X?") IS a request.
- Corrections are relative to the known spec ("kurang tinggi 3cm" adds 3 cm).
- Put requests that no attribute covers into custom_fields as short label/value pairs.

DIMENSIONS (dimension_mode + reference_object + dimensions_cm), clients rarely know centimetres:
- Client gives cm ("36x6x26", "9.5x7cm") → EXACT_CM, copy them exactly (two numbers = length x height).
- No cm, but a REFERENCE MODEL ("mirip Birkin 30", "seukuran Kelly 28", "kayak Speedy") → REFERENCE_BASED, reference_object = the model,
  dimensions_cm = that model's real outer size (a "mirip / tapi ga persis" request still uses the model's size as the starting point).
- No cm, but an OBJECT TO HOLD ("muat iPad Air 11 inch", "laptop 14 inch", "dokumen A4") → REFERENCE_BASED, reference_object = the object,
  dimensions_cm = the object + ~2 cm room per side, deeper (≥6 cm) if accessories like a charger go in too.
- Furniture that must fit a room / bedside / wall and no measurements → PENDING_SITE_VISIT, dimensions 0 (we measure on site).
- Otherwise UNSPECIFIED with dimensions 0. Known references for calibration:
${referenceGuide(category) || '- (none for this category; use your own knowledge of real product sizes)'}

Form factors in this category:
${visionGuide([category])}`;
}

function transcriptText(messages: ChatMessage[]): string {
  return messages
    .map((m) => `[${m.sender}] ${m.text ?? ''}${m.media_type ? ` [${m.media_type === 'image' ? 'attached a photo/sketch' : 'sent a voice note'}]` : ''}`)
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

interface Classification {
  vision_notes: string;
  craft_category: CraftCategory;
  construction_type: ConstructionType;
  confidence: number;
}

interface Extraction {
  vision_notes: string;
  construction_type: ConstructionType;
  model_name: string;
  dimension_mode: DimensionMode;
  reference_object: string;
  attributes: Record<string, unknown>;
  custom_fields: Array<{ label: string; value: string }>;
  deferred_topics: string[];
  client_finished: boolean;
  client_questions: ClientQuestion[];
  non_standard_request: { detected: boolean; reason: string };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function runIntakeAgent(input: { messages: ChatMessage[]; known: Specifications; progress?: IntakeProgress }): Promise<IntakeResult> {
  const known = normalizeSpecifications(input.known);
  const burst = lastClientBurst(input.messages);
  const burstText = burst.map((m) => m.text ?? '').join('\n');
  const allClientText = input.messages.filter((m) => m.sender === 'CLIENT' && m.text).map((m) => m.text).join('\n');
  const alreadyProcessed = burst.length > 0 && burst.at(-1)!.id === input.progress?.processed_message_id;
  const hinted = detectProduct(burstText);
  const switchHint = isClassified(known) && hinted.construction !== undefined && hinted.category !== known.category;
  const needsClassification = !isClassified(known) || switchHint;

  let spec = known;
  let vision_notes = input.progress?.vision_notes;
  let client_finished = FINISHED.test(burstText);
  let deferred: string[] = [];
  let usedGemini = false;
  let aiDimensions: { mode?: DimensionMode; reference?: string } = {};
  let questions: ClientQuestion[] = [];
  let nonStandard: string | undefined;

  if (isGeminiConfigured()) {
    try {
      const media = await mediaParts(input.messages);
      const transcript = { text: `WhatsApp transcript:\n${transcriptText(input.messages)}` };

      // Stage 1: category / form factor
      if (needsClassification) {
        const c = await generateStructured<Classification>({
          models: MODEL_CHAINS.flash,
          systemInstruction: CLASSIFY_INSTRUCTION,
          schema: classificationSchema(),
          parts: [{ text: `Currently known: ${known.category} / ${known.construction_type}` }, transcript, ...media],
        });
        const construction = categoryOfConstruction(c.construction_type) === c.craft_category ? c.construction_type : 'UNSPECIFIED';
        if (c.craft_category !== spec.category) spec = changeCategory(spec, c.craft_category, construction);
        else if (construction !== 'UNSPECIFIED') spec = normalizeSpecifications({ ...spec, construction_type: construction });
        vision_notes = c.vision_notes || vision_notes;
      }

      // Stage 2: the active category's own schema
      const x = await generateStructured<Extraction>({
        models: MODEL_CHAINS.flash,
        systemInstruction: extractInstruction(spec.category),
        schema: extractionSchema(spec.category),
        parts: [
          {
            text:
              `Currently known specification:\n${JSON.stringify({ construction_type: spec.construction_type, model_name: spec.model_name, dimension_mode: spec.dimension_mode, reference_object: spec.reference_object, attributes: spec.attributes, custom_fields: spec.custom_fields })}\n\n` +
              `Topics the assistant just asked about: ${(input.progress?.last_asked ?? []).join(', ') || 'none'}`,
          },
          transcript,
          ...media,
        ],
      });
      spec = mergeAttributes(spec, x.attributes);
      if (categoryOfConstruction(x.construction_type) === spec.category) spec = normalizeSpecifications({ ...spec, construction_type: x.construction_type });
      if (x.model_name?.trim()) spec = { ...spec, model_name: x.model_name.trim() };
      spec = { ...spec, custom_fields: mergeCustomFields(spec.custom_fields, x.custom_fields ?? []) };
      deferred = (x.deferred_topics ?? []).filter((t) => t !== 'none').map((t) => `${spec.category}:${t}`);
      client_finished = client_finished || x.client_finished;
      vision_notes = x.vision_notes || vision_notes;
      aiDimensions = { mode: x.dimension_mode, reference: x.reference_object };
      questions = (x.client_questions ?? []).filter((q) => q.text?.trim());
      if (x.non_standard_request?.detected) nonStandard = x.non_standard_request.reason?.trim() || 'Permintaan di luar standar workshop';
      usedGemini = true;
    } catch (err) {
      console.warn('[intake-agent] ALL Gemini models failed — answering with the offline heuristic parser:', err);
      spec = known;
    }
  }

  if (!usedGemini) {
    const detected = needsClassification ? (hinted.category ? hinted : detectProduct(allClientText)) : {};
    if (detected.category && detected.category !== spec.category) spec = changeCategory(spec, detected.category, detected.construction);
    else if (detected.construction && !isClassified(spec)) spec = normalizeSpecifications({ ...spec, construction_type: detected.construction });
    // whole history first, newest burst last so it wins on conflicts; "what is X?" sentences are not choices
    spec = mergeAttributes(spec, heuristicAttributes(spec.category, withoutExplanationQuestions(allClientText)));
    spec = mergeAttributes(spec, heuristicAttributes(spec.category, withoutExplanationQuestions(burstText)));
    if (!alreadyProcessed) spec = applyRelativeEdits(spec, burstText, known);
  }

  // Explicit cm > site visit > reference table > Gemini's own reference: keeps mode, reference and size consistent.
  spec = resolveDimensionSource(spec, allClientText, aiDimensions);

  if (!alreadyProcessed) {
    const answered = applyAnswerToAsked(spec, input.progress?.last_asked ?? [], burstText);
    spec = answered.spec;
    deferred = [...new Set([...deferred, ...answered.deferred])];
  }

  // Heuristics back Gemini up: explicit "?" questions it missed, and clear non-standard keywords.
  if (!questions.length) questions = detectQuestions(burstText, spec.category);
  nonStandard ??= detectNonStandard(burstText);

  return { specifications: spec, client_finished, deferred_topics: deferred, vision_notes, questions, non_standard_reason: nonStandard };
}

// ---------------------------------------------------------------------------
// Conversational reply
// ---------------------------------------------------------------------------

const REPLY_INSTRUCTION = `You are the friendly WhatsApp assistant of a bespoke craft workshop. Reply in the client's language (usually casual-polite Bahasa Indonesia, address them as "kak").
Write ONE short WhatsApp message (2-5 sentences, at most one or two emoji). Greet the client by name ONLY when the prompt says FIRST TURN.
1. If there are CLIENT QUESTIONS, ANSWER THEM FIRST, clearly and concretely:
   - terminology: explain using the GLOSSARY FACTS (you may simplify, never contradict them);
   - design ("apakah depannya ada motif?"): answer from the SPECIFICATION only. Features not in it do not exist yet
     (e.g. no motif unless personalization is set); offer the option instead of inventing it;
   - price / timeline: the crafter sends the official quote once the specification is complete; never give numbers.
2. Otherwise briefly acknowledge what the client just said.
3. Then ask ONLY the topics under "ASK NOW", woven naturally (max two). If a question was about one of those topics, ask
   which option they prefer (e.g. "mau raw edge atau tetap burnished?"). Never ask anything else.
No markdown headings or long lists.`;

/** Offline answer: glossary explanations, a spec-based answer to design questions, then the preference question. */
function templateAnswer(spec: Specifications, questions: ClientQuestion[]): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  for (const q of questions) {
    if (q.kind === 'PRICE_TIMELINE') {
      if (!seen.has('price')) parts.push('Untuk harga dan estimasi waktu, crafter kami kirimkan penawaran resminya setelah spesifikasinya lengkap ya kak.');
      seen.add('price');
      continue;
    }
    for (const g of findGlossary(q.text, spec.category)) {
      if (!seen.has(g.id)) parts.push(g.explanation);
      seen.add(g.id);
    }
    if (q.kind === 'DESIGN' && /motif|ukir|emboss|gambar|logo|tulisan/i.test(q.text) && !seen.has('motif')) {
      const emb = (spec.attributes as { embossing_type?: string; embossing_text?: string }).embossing_type;
      parts.push(
        emb && emb !== 'UNSPECIFIED' && emb !== 'NONE'
          ? `Untuk motif: sesuai catatan kami ada ${emb === 'LASER_ENGRAVING' ? 'ukiran laser' : 'emboss'}${(spec.attributes as { embossing_text?: string }).embossing_text ? ` "${(spec.attributes as { embossing_text?: string }).embossing_text}"` : ''}.`
          : 'Untuk saat ini desainnya polos tanpa motif; kalau kakak mau, bisa ditambah emboss inisial/logo atau ukiran laser.',
      );
      seen.add('motif');
    }
  }
  if (!parts.length) parts.push('Pertanyaan kakak kami catat ya, crafter kami akan bantu jelaskan detailnya.');
  return parts.join('\n\n');
}

export async function composeReply(input: {
  clientName: string;
  plan: ConversationPlan;
  spec: Specifications;
  messages: ChatMessage[];
  visionNotes?: string;
  isFirstTurn: boolean;
  questions?: ClientQuestion[];
}): Promise<string> {
  const questions = input.questions ?? [];
  const siteVisit = input.spec.dimension_mode === 'PENDING_SITE_VISIT' ? '\nUntuk ukurannya, kami akan jadwalkan survei ukur ke lokasi kakak ya 📏' : '';
  const asks = input.plan.ask.length ? templateQuestion(input.clientName, input.plan.ask, input.isFirstTurn && !questions.length) : '';
  const fallback = questions.length
    ? `${templateAnswer(input.spec, questions)}${asks ? `\n\n${asks.replace(/^.*\n/, 'Kakak mau pilih yang mana untuk:\n')}` : ''}${siteVisit}`
    : `${asks}${siteVisit}`;
  if (!isGeminiConfigured() || (input.plan.ask.length === 0 && questions.length === 0)) return fallback;
  try {
    const topics = input.plan.ask.map((t) => `- ${t.label}: ${t.ask}`).join('\n');
    const facts = [...new Map(questions.flatMap((q) => findGlossary(q.text, input.spec.category)).map((g) => [g.id, g])).values()]
      .map((g) => `- ${g.term}: ${g.explanation}`)
      .join('\n');
    return await generateText({
      models: MODEL_CHAINS.fast,
      systemInstruction: REPLY_INSTRUCTION,
      parts: [
        {
          text:
            `Client name: ${input.clientName}\n${input.isFirstTurn ? 'FIRST TURN (greet the client)' : 'FOLLOW-UP TURN (no greeting)'}\n` +
            `Product category: ${schemaOf(input.spec.category).label}\n` +
            (input.spec.dimension_mode === 'REFERENCE_BASED'
              ? `Size was inferred from the reference "${input.spec.reference_object}"; mention the estimated size briefly and that it can be adjusted.\n`
              : input.spec.dimension_mode === 'PENDING_SITE_VISIT'
                ? 'Size needs an on-site measurement: say the workshop will schedule a measurement visit (survei ukur) and ask the client\'s area/available day if not known.\n'
                : '') +
            `SPECIFICATION: ${JSON.stringify({ construction_type: input.spec.construction_type, attributes: input.spec.attributes, custom_fields: input.spec.custom_fields })}\n` +
            (input.visionNotes ? `What the photo shows: ${input.visionNotes}\n` : '') +
            (questions.length ? `\nCLIENT QUESTIONS:\n${questions.map((q) => `- (${q.kind}) ${q.text}`).join('\n')}\n` : '') +
            (facts ? `\nGLOSSARY FACTS:\n${facts}\n` : '') +
            `\nRecent chat:\n${transcriptText(input.messages.slice(-10))}\n\nASK NOW:\n${topics || '- (nothing; just answer)'}`,
        },
      ],
    });
  } catch (err) {
    console.warn('[intake-agent] reply composition failed, using template answer:', err);
    return fallback;
  }
}
