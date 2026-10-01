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
import { classificationSchema, extractionSchema } from '@/lib/spec/gemini-schema';
import { DECLINE, FINISHED, num } from '@/lib/spec/parsers';
import type { AttributeValue, ChatMessage, ConstructionType, CraftCategory, IntakeProgress, IntakeResult, Specifications } from '@/lib/types';

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
  const textKey = open[0].fields.find((k) => fields[k].type === 'text');
  if (textKey) attrs(out)[textKey] = text.replace(/\s+/g, ' ').slice(0, 80);
  return { spec: out, deferred: [] };
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
- Anything not stated: "" / 0 / false / "UNSPECIFIED". NEVER invent sizes, materials, counts or personalization.
- If the ASSISTANT recommended something and the client agrees ("iya", "boleh", "sip", "oke"), adopt it.
- Corrections are relative to the known spec ("kurang tinggi 3cm" adds 3 cm).
- Put requests that no attribute covers into custom_fields as short label/value pairs.
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
  attributes: Record<string, unknown>;
  custom_fields: Array<{ label: string; value: string }>;
  deferred_topics: string[];
  client_finished: boolean;
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
              `Currently known specification:\n${JSON.stringify({ construction_type: spec.construction_type, model_name: spec.model_name, attributes: spec.attributes, custom_fields: spec.custom_fields })}\n\n` +
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
    // whole history first, newest burst last so it wins on conflicts
    spec = mergeAttributes(spec, heuristicAttributes(spec.category, allClientText));
    spec = mergeAttributes(spec, heuristicAttributes(spec.category, burstText));
    if (!alreadyProcessed) spec = applyRelativeEdits(spec, burstText, known);
  }

  if (!alreadyProcessed) {
    const answered = applyAnswerToAsked(spec, input.progress?.last_asked ?? [], burstText);
    spec = answered.spec;
    deferred = [...new Set([...deferred, ...answered.deferred])];
  }

  return { specifications: spec, client_finished, deferred_topics: deferred, vision_notes };
}

// ---------------------------------------------------------------------------
// Conversational reply
// ---------------------------------------------------------------------------

const REPLY_INSTRUCTION = `You are the friendly WhatsApp assistant of a bespoke craft workshop. Reply in the client's language (usually casual-polite Bahasa Indonesia, address them as "kak").
Write ONE short WhatsApp message (2-4 sentences, at most one or two emoji). Greet the client by name ONLY when the prompt says FIRST TURN:
1. Briefly acknowledge what the client just told you, using their details (and what you understood from any photo).
2. Where it helps, add a one-line expert recommendation relevant to THIS product type only.
3. Ask ONLY the topics listed under "ASK NOW", woven naturally (maximum two questions). Never ask about anything else.
Never quote prices, discounts or delivery dates; the crafter confirms those. No markdown headings or long lists.`;

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
    const topics = input.plan.ask.map((t) => `- ${t.label}: ${t.ask}`).join('\n');
    return await generateText({
      models: MODEL_CHAINS.fast,
      systemInstruction: REPLY_INSTRUCTION,
      parts: [
        {
          text:
            `Client name: ${input.clientName}\n${input.isFirstTurn ? 'FIRST TURN (greet the client)' : 'FOLLOW-UP TURN (no greeting)'}\n` +
            `Product category: ${schemaOf(input.spec.category).label}\n` +
            `Specification so far: ${JSON.stringify({ construction_type: input.spec.construction_type, attributes: input.spec.attributes, custom_fields: input.spec.custom_fields })}\n` +
            (input.visionNotes ? `What the photo shows: ${input.visionNotes}\n` : '') +
            `\nRecent chat:\n${transcriptText(input.messages.slice(-10))}\n\nASK NOW:\n${topics}`,
        },
      ],
    });
  } catch (err) {
    console.warn('[intake-agent] reply composition failed, using template question:', err);
    return fallback;
  }
}
