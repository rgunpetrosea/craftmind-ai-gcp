import { BAG } from '@/lib/spec/categories/bag';
import { CUSTOM_GENERIC } from '@/lib/spec/categories/custom-generic';
import { FOOTWEAR } from '@/lib/spec/categories/footwear';
import { FURNITURE } from '@/lib/spec/categories/furniture';
import { SMALL_GOODS } from '@/lib/spec/categories/small-goods';
import type { AnyField, CategorySchemas, ConstructionDef, TopicDef } from '@/lib/spec/fields';
import type {
  AttributeValue,
  ConstructionType,
  CraftCategory,
  CustomField,
  Dimensions,
  IntakeProgress,
  Specifications,
} from '@/lib/types';

/**
 * Public API over the category registry. Everything category-specific is looked up here; no other module
 * hard-codes which fields a category has.
 */

export const CATEGORY_SCHEMAS: CategorySchemas = { SMALL_GOODS, BAG, FOOTWEAR, FURNITURE, CUSTOM_GENERIC };
export const CATEGORIES = Object.keys(CATEGORY_SCHEMAS) as CraftCategory[];

/** Category-agnostic view of a schema for generic code (renderer, schema builder, planner). */
export interface LooseSchema {
  id: CraftCategory;
  label: string;
  label_id: string;
  noun: string;
  scope: string;
  detect: RegExp;
  material_field: string;
  material_label: string;
  constructions: Array<ConstructionDef<CraftCategory> & { id: ConstructionType; defaults: Record<string, AttributeValue> }>;
  fields: Record<string, AnyField>;
  topics: Array<Omit<TopicDef<CraftCategory>, 'fields' | 'is_filled' | 'applies_to'> & { fields: string[]; applies_to?: string[]; is_filled?: (s: Specifications) => boolean }>;
}

export function schemaOf(category: CraftCategory): LooseSchema {
  return CATEGORY_SCHEMAS[category] as unknown as LooseSchema;
}

export const attrs = (spec: Specifications) => spec.attributes as unknown as Record<string, AttributeValue>;

// ---------------------------------------------------------------------------
// Form factors
// ---------------------------------------------------------------------------

export const ALL_CONSTRUCTIONS = CATEGORIES.flatMap((c) => schemaOf(c).constructions.map((d) => ({ ...d, category: c })));

export function constructionDef(id: ConstructionType) {
  return ALL_CONSTRUCTIONS.find((d) => d.id === id);
}

export function categoryOfConstruction(id: ConstructionType): CraftCategory | undefined {
  return constructionDef(id)?.category;
}

export function constructionLabel(id: ConstructionType): string {
  return constructionDef(id)?.label ?? 'Not yet identified';
}

/** Most specific form factor mentioned in the text (across all categories), else the category whose keywords match. */
export function detectProduct(text: string): { category?: CraftCategory; construction?: ConstructionType } {
  const hit = ALL_CONSTRUCTIONS.find((d) => d.detect.test(text));
  if (hit) return { category: hit.category, construction: hit.id };
  const category = CATEGORIES.find((c) => schemaOf(c).detect.test(text));
  return { category };
}

/** Vision briefing that separates look-alike form factors, grouped by category. */
export function visionGuide(categories: CraftCategory[] = CATEGORIES): string {
  return categories
    .map((c) => {
      const s = schemaOf(c);
      const lines = s.constructions.filter((d) => !d.id.startsWith('OTHER_')).map((d) => `  - ${d.id}: ${d.vision_cue}`);
      return `${c} (${s.scope})\n${lines.join('\n')}`;
    })
    .join('\n');
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

export function blankValue(field: AnyField): AttributeValue {
  switch (field.type) {
    case 'text':
      return '';
    case 'number':
      return 0;
    case 'boolean':
      return false;
    case 'enum':
      return 'UNSPECIFIED';
    case 'dimensions':
      return { length: 0, width: 0, height: 0 };
  }
}

export function isValueSet(field: AnyField, value: unknown): boolean {
  switch (field.type) {
    case 'text':
      return typeof value === 'string' && value.trim() !== '';
    case 'number':
      return typeof value === 'number' && value > 0;
    case 'boolean':
      return value === true;
    case 'enum':
      return typeof value === 'string' && value !== 'UNSPECIFIED' && value !== '';
    case 'dimensions': {
      const d = value as Partial<Dimensions> | undefined;
      if (!d) return false;
      const axes = field.required_axes.length ? field.required_axes : (['length', 'width', 'height'] as const);
      return field.required_axes.length ? axes.every((a) => (d[a] ?? 0) > 0) : axes.some((a) => (d[a] ?? 0) > 0);
    }
  }
}

/** Coerce an incoming value (from Gemini, the form or the parser) to the field's type; undefined when invalid. */
export function coerceValue(field: AnyField, value: unknown): AttributeValue | undefined {
  switch (field.type) {
    case 'text':
      return typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : undefined;
    case 'number': {
      const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.replace(',', '.')) : NaN;
      return Number.isFinite(n) && n >= 0 ? n : undefined;
    }
    case 'boolean':
      return typeof value === 'boolean' ? value : value === 'true' ? true : value === 'false' ? false : undefined;
    case 'enum':
      return typeof value === 'string' && (value === 'UNSPECIFIED' || value in field.options) ? value : undefined;
    case 'dimensions': {
      if (!value || typeof value !== 'object') return undefined;
      const d = value as Partial<Record<keyof Dimensions, unknown>>;
      const n = (v: unknown) => (typeof v === 'number' && v >= 0 ? v : 0);
      return { length: n(d.length), width: n(d.width), height: n(d.height) };
    }
  }
}

export function blankAttributes(category: CraftCategory): Record<string, AttributeValue> {
  return Object.fromEntries(Object.entries(schemaOf(category).fields).map(([k, f]) => [k, blankValue(f)]));
}

export function emptySpecifications(category: CraftCategory = 'CUSTOM_GENERIC'): Specifications {
  return {
    category,
    construction_type: 'UNSPECIFIED',
    model_name: '',
    notes: '',
    attributes: blankAttributes(category),
    custom_fields: [],
  } as unknown as Specifications;
}

export function isFieldSet(spec: Specifications, key: string): boolean {
  const field = schemaOf(spec.category).fields[key];
  return !!field && isValueSet(field, attrs(spec)[key]);
}

export function isFieldRelevant(spec: Specifications, key: string): boolean {
  const field = schemaOf(spec.category).fields[key];
  return !!field && (field.relevant ? field.relevant(attrs(spec), spec.construction_type) : true);
}

// ---------------------------------------------------------------------------
// Normalization, legacy migration, category switching
// ---------------------------------------------------------------------------

const LEGACY_CATEGORY: Record<string, CraftCategory> = { bespoke_wallet: 'SMALL_GOODS', bespoke_bag: 'BAG', bespoke_shoes: 'FOOTWEAR' };

/** Orders written before category isolation (flat spec with pocket_layout / finish / customization). */
function migrateLegacy(raw: Record<string, unknown>, legacyCategory?: string): Specifications {
  const construction = (raw.construction_type as ConstructionType) ?? 'UNSPECIFIED';
  const category = categoryOfConstruction(construction) ?? LEGACY_CATEGORY[legacyCategory ?? ''] ?? 'CUSTOM_GENERIC';
  const pockets = (raw.pocket_layout ?? {}) as Record<string, unknown>;
  const finish = (raw.finish ?? {}) as Record<string, unknown>;
  const custom = (raw.customization ?? {}) as Record<string, unknown>;
  const flat: Record<string, unknown> = {
    ...pockets,
    dimensions_cm: raw.dimensions_cm,
    exterior_leather: raw.exterior_leather,
    upper_material: raw.exterior_leather,
    primary_material: raw.exterior_leather,
    color: finish.color_finish,
    lining: raw.lining_material,
    stitching_method: raw.stitching_method,
    edge_finish: finish.edge_treatment,
    thread_color: finish.thread_color,
    thread_material: finish.thread_material,
    stitch_pattern: finish.stitch_pattern,
    zipper: finish.zipper,
    hardware: finish.hardware_notes,
    target_capacity: raw.target_capacity,
    embossing_type: custom.type,
    embossing_text: custom.detail,
    embossing_placement: custom.placement,
  };
  return normalizeSpecifications({
    category,
    construction_type: categoryOfConstruction(construction) === category ? construction : 'UNSPECIFIED',
    model_name: raw.silhouette ?? '',
    notes: '',
    attributes: flat,
    custom_fields: [],
  });
}

/**
 * Bring any stored / incoming spec to the exact shape of its category: unknown attribute keys are dropped (no mixing
 * across categories), missing ones get blank values, values are coerced to the field type, and the construction type
 * must belong to the category.
 */
export function normalizeSpecifications(raw: unknown, legacyCategory?: string): Specifications {
  if (!raw || typeof raw !== 'object') return emptySpecifications();
  const r = raw as Record<string, unknown>;
  if (!('attributes' in r) || !('category' in r)) return migrateLegacy(r, legacyCategory);

  const category = (CATEGORIES as string[]).includes(r.category as string) ? (r.category as CraftCategory) : 'CUSTOM_GENERIC';
  const schema = schemaOf(category);
  const incoming = (r.attributes ?? {}) as Record<string, unknown>;
  const attributes: Record<string, AttributeValue> = {};
  for (const [key, field] of Object.entries(schema.fields)) {
    attributes[key] = coerceValue(field, incoming[key]) ?? blankValue(field);
  }
  const construction = r.construction_type as ConstructionType;
  return {
    category,
    construction_type: categoryOfConstruction(construction) === category ? construction : 'UNSPECIFIED',
    model_name: typeof r.model_name === 'string' ? r.model_name : '',
    notes: typeof r.notes === 'string' ? r.notes : '',
    attributes,
    custom_fields: Array.isArray(r.custom_fields) ? (r.custom_fields as CustomField[]).filter((f) => f && f.label?.trim()) : [],
  } as unknown as Specifications;
}

/** Switch category: start from a blank schema, carry over only same-named fields of the same type (e.g. dimensions). */
export function changeCategory(spec: Specifications, category: CraftCategory, construction: ConstructionType = 'UNSPECIFIED'): Specifications {
  if (spec.category === category) return normalizeSpecifications({ ...spec, construction_type: construction === 'UNSPECIFIED' ? spec.construction_type : construction });
  const from = schemaOf(spec.category).fields;
  const to = schemaOf(category).fields;
  const carried: Record<string, AttributeValue> = {};
  for (const [key, field] of Object.entries(to)) {
    if (from[key]?.type === field.type && isValueSet(field, attrs(spec)[key])) carried[key] = attrs(spec)[key];
  }
  return normalizeSpecifications({ ...spec, category, construction_type: construction, attributes: carried });
}

/** Upsert AI-extracted custom fields by label; crafter-entered fields are never overwritten. */
export function mergeCustomFields(existing: CustomField[], incoming: Array<{ label: string; value: string }>): CustomField[] {
  const out = [...existing];
  for (const { label, value } of incoming) {
    if (!label?.trim() || !value?.trim()) continue;
    const i = out.findIndex((f) => f.label.trim().toLowerCase() === label.trim().toLowerCase());
    if (i === -1) out.push({ id: `cf-${Date.now().toString(36)}-${out.length}`, label: label.trim(), value: value.trim(), surcharge_idr: 0, source: 'AI' });
    else if (out[i].source === 'AI') out[i] = { ...out[i], value: value.trim() };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Requirement-gathering checklist (per category)
// ---------------------------------------------------------------------------

export type LooseTopic = LooseSchema['topics'][number];

export function topicsFor(spec: Specifications): LooseTopic[] {
  return schemaOf(spec.category).topics.filter((t) => !t.applies_to || t.applies_to.includes(spec.construction_type));
}

export function isTopicFilled(spec: Specifications, topic: LooseTopic, progress?: Pick<IntakeProgress, 'deferred_topics'>): boolean {
  if (topic.deferrable && progress?.deferred_topics?.includes(`${spec.category}:${topic.id}`)) return true;
  if (topic.is_filled) return topic.is_filled(spec);
  return topic.fields.some((f) => isFieldSet(spec, f));
}

export const isClassified = (spec: Specifications) => spec.construction_type !== 'UNSPECIFIED';

/**
 * Required topics still open. While the product is completely unknown (still the CUSTOM_GENERIC placeholder with no
 * form factor) only "what product?" is asked; once a real category is detected its own required topics apply.
 */
export function missingRequired(spec: Specifications, progress?: Pick<IntakeProgress, 'deferred_topics'>): LooseTopic[] {
  const required = topicsFor(spec).filter((t) => t.required && !isTopicFilled(spec, t, progress));
  if (!isClassified(spec) && spec.category === 'CUSTOM_GENERIC') return required.filter((t) => t.id === 'construction');
  return required;
}

export function filledTopicCount(spec: Specifications, progress?: Pick<IntakeProgress, 'deferred_topics'>): number {
  return (isClassified(spec) ? 1 : 0) + topicsFor(spec).filter((t) => t.id !== 'construction' && isTopicFilled(spec, t, progress)).length;
}

export const MAX_QUESTIONS_PER_TURN = 2;

export interface ConversationPlan {
  missing_required: LooseTopic[];
  pending_details: LooseTopic[];
  /** Topics for the next bubble (≤ MAX_QUESTIONS_PER_TURN), required first. */
  ask: LooseTopic[];
  ready: boolean;
}

/**
 * Required topics of the active category first, then its optional detail topics (each asked once). Ready when every
 * required topic is filled and either no detail is left or the client said they are done.
 */
export function planConversation(spec: Specifications, progress: IntakeProgress | undefined, clientFinished: boolean): ConversationPlan {
  const asked = new Set(progress?.asked_topics ?? []);
  const missing_required = missingRequired(spec, progress);
  const pending_details = isClassified(spec)
    ? topicsFor(spec).filter((t) => !t.required && !isTopicFilled(spec, t, progress) && !asked.has(`${spec.category}:${t.id}`))
    : [];
  const ask = missing_required.slice(0, MAX_QUESTIONS_PER_TURN);
  if (!clientFinished) for (const t of pending_details) if (ask.length < MAX_QUESTIONS_PER_TURN) ask.push(t);
  const ready = missing_required.length === 0 && (clientFinished || pending_details.length === 0);
  return { missing_required, pending_details, ask: ready ? [] : ask, ready };
}

/** Topic keys are namespaced by category so switching category re-asks that category's own details. */
export const topicKey = (spec: Specifications, topic: LooseTopic) => `${spec.category}:${topic.id}`;

export function templateQuestion(clientName: string, topics: LooseTopic[], isFirstTurn: boolean): string {
  const bullets = topics.map((t, i) => `${topics.length > 1 ? `${i + 1}. ` : ''}${t.ask}`).join('\n');
  const opener = isFirstTurn
    ? `Halo kak ${clientName}! 🙏 Terima kasih sudah menghubungi kami. Supaya desainnya pas, boleh dibantu info:`
    : `Siap kak ${clientName}, sudah kami catat ya 👍 Selanjutnya, boleh info:`;
  return `${opener}\n${bullets}`;
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

export function formatValue(field: AnyField, value: AttributeValue): string {
  switch (field.type) {
    case 'dimensions': {
      const d = value as Dimensions;
      return `${[d.length, d.width, d.height].filter((n) => n > 0).join(' x ')} cm`;
    }
    case 'enum':
      return (field.options as Record<string, string>)[value as string] ?? String(value);
    case 'boolean':
      return value ? 'Ya' : 'Tidak';
    case 'number':
      return `${value}${field.unit ? ` ${field.unit}` : ''}`;
    default:
      return String(value);
  }
}

/** Set + relevant fields of a spec in registry order: the basis of the spec card, mockup prompt and quotation. */
export function describeFields(spec: Specifications): Array<{ key: string; field: AnyField; value: AttributeValue; text: string }> {
  const schema = schemaOf(spec.category);
  return Object.entries(schema.fields)
    .filter(([key, field]) => isValueSet(field, attrs(spec)[key]) && isFieldRelevant(spec, key))
    .map(([key, field]) => ({ key, field, value: attrs(spec)[key], text: formatValue(field, attrs(spec)[key]) }));
}

// ---------------------------------------------------------------------------
// Locking the spec card
// ---------------------------------------------------------------------------

/**
 * Called when the spec card is locked. Topics the client left open (or deferred) get the form factor's typical values,
 * then any field still unset gets the category preset's workshop default. Only keys of the spec's own category are touched.
 */
export function finalizeSpecifications(spec: Specifications, presetDefaults: Partial<Record<string, string | number | boolean>>): Specifications {
  const out = normalizeSpecifications(structuredClone(spec));
  const a = attrs(out);
  const schema = schemaOf(out.category);
  const construction = constructionDef(out.construction_type);
  const cDefaults = (construction?.defaults ?? {}) as Record<string, AttributeValue>;

  for (const topic of topicsFor(out)) {
    if (topic.fields.some((k) => isFieldSet(out, k))) continue;
    for (const k of topic.fields) if (cDefaults[k] !== undefined) a[k] = structuredClone(cDefaults[k]);
  }

  if (out.category === 'BAG' && !isFieldSet(out, 'dimensions_cm') && (a.laptop_size_inch as number) > 0) {
    const inch = a.laptop_size_inch as number;
    const diag = inch * 2.54;
    a.dimensions_cm = { length: Math.round(0.915 * diag + 4), width: 10, height: Math.round(0.63 * diag + 4) };
  }

  for (const [key, field] of Object.entries(schema.fields)) {
    if (isValueSet(field, a[key])) continue;
    const fromConstruction = field.type === 'dimensions' ? cDefaults[key] : undefined;
    const value = coerceValue(field, presetDefaults[key] ?? fromConstruction);
    if (value !== undefined && isValueSet(field, value)) a[key] = value;
  }
  if (!out.model_name.trim() && construction) out.model_name = construction.label;
  return out;
}
