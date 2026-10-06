import type {
  AttributesByCategory,
  ConstructionByCategory,
  CraftCategory,
  Dimensions,
  Specifications,
} from '@/lib/types';

/**
 * Field-definition registry types. Each category declares a `FieldMap` over its attribute interface, so TypeScript
 * enforces that every attribute has exactly one definition and that the definition matches the attribute's type
 * (an enum attribute must list a label for every option). The dashboard form, the Gemini responseSchema, the offline
 * parser, the requirement checklist and the client spec card are all generated from these definitions.
 */

export type FieldGroup = 'form' | 'size' | 'material' | 'layout' | 'construction' | 'finish' | 'personalization' | 'other';

export const GROUP_LABEL: Record<FieldGroup, string> = {
  form: 'Form factor',
  size: 'Size & fit',
  material: 'Material',
  layout: 'Pockets & layout',
  construction: 'Construction',
  finish: 'Finishing',
  personalization: 'Personalization',
  other: 'Other',
};

interface FieldBase<A, V> {
  label: string;
  /** Indonesian label used in the WhatsApp spec card. */
  label_id: string;
  group: FieldGroup;
  /** Extraction guidance for Gemini (becomes the responseSchema description). */
  description: string;
  unit?: string;
  /** Offline / heuristic extraction from client text. Return undefined when nothing was found. */
  parse?: (text: string) => V | undefined;
  /**
   * Where the attribute is visible on the finished piece. 'interior' fields (card slots, lining, inner pockets) are kept
   * out of closed/exterior mockup angles so the image model doesn't render them; default 'exterior'.
   */
  zone?: 'exterior' | 'interior';
  /** Hide the field when it does not apply (e.g. zipper on a flat card holder). Defaults to always relevant. */
  relevant?: (attrs: A, construction: string) => boolean;
}

export interface TextField<A> extends FieldBase<A, string> {
  type: 'text';
  placeholder?: string;
}
export interface NumberField<A> extends FieldBase<A, number> {
  type: 'number';
  step?: number;
}
export interface BooleanField<A> extends FieldBase<A, boolean> {
  type: 'boolean';
}
export interface DimensionsField<A> extends FieldBase<A, Partial<Dimensions>> {
  type: 'dimensions';
  /** Which axes must be > 0 for the field to count as filled. */
  required_axes: Array<keyof Dimensions>;
  axis_labels?: Partial<Record<keyof Dimensions, string>>;
}
export interface EnumField<A, V extends string> extends FieldBase<A, V> {
  type: 'enum';
  /** Label for every value except the unset value 'UNSPECIFIED'. */
  options: Record<Exclude<V, 'UNSPECIFIED'>, string>;
}

/** Picks the field kind from the attribute's TypeScript type ([T] wrappers stop enum unions from distributing). */
export type FieldFor<A, T> = [T] extends [Dimensions]
  ? DimensionsField<A>
  : [T] extends [number]
    ? NumberField<A>
    : [T] extends [boolean]
      ? BooleanField<A>
      : [string] extends [T]
        ? TextField<A>
        : EnumField<A, T & string>;

/** Exactly one definition per attribute, in display order. */
export type FieldMap<A> = { [K in keyof A]-?: FieldFor<A, A[K]> };

/** Loosely typed view used by generic code (UI renderer, schema builders). */
export type AnyField =
  | TextField<Record<string, unknown>>
  | NumberField<Record<string, unknown>>
  | BooleanField<Record<string, unknown>>
  | DimensionsField<Record<string, unknown>>
  | EnumField<Record<string, unknown>, string>;

export interface ConstructionDef<C extends CraftCategory> {
  id: ConstructionByCategory[C];
  label: string;
  /** EN + ID keywords for the offline parser. Defs are tested in order, most specific first. */
  detect: RegExp;
  /** What distinguishes this form factor in a photo or sketch (fed to the vision model). */
  vision_cue: string;
  /** Typical values used when the client defers ("terserah") or leaves a whole topic open. */
  defaults: Partial<AttributesByCategory[C]>;
  /** Labor relative to the category preset's base hours. */
  labor_factor: number;
}

export interface TopicDef<C extends CraftCategory> {
  id: string;
  /** Short chip label (simulator checklist). */
  label: string;
  /** Indonesian question fragment, used verbatim offline and as guidance for Gemini. */
  ask: string;
  required: boolean;
  fields: Array<keyof AttributesByCategory[C] & string>;
  /** Restrict to these form factors (e.g. card layout only for wallets). */
  applies_to?: Array<ConstructionByCategory[C]>;
  /** Never for these form factors (e.g. "permanen vs bongkar pasang" for built-in cabinetry). */
  excludes?: Array<ConstructionByCategory[C]>;
  /** Custom completeness test; default = any of `fields` is set. */
  is_filled?: (spec: Extract<Specifications, { category: C }>) => boolean;
  /** Whether "terserah" may close the topic with workshop defaults (size and material never can). */
  deferrable: boolean;
}

export interface CategorySchema<C extends CraftCategory> {
  id: C;
  label: string;
  label_id: string;
  /** Noun used in prompts, e.g. "leather wallet / small leather good". */
  noun: string;
  /** One line for the classifier: what belongs in this category. */
  scope: string;
  /** Keywords that put a message in this category when no form factor matches. */
  detect: RegExp;
  /** Attribute matched against inventory and priced per sqft. */
  material_field: keyof AttributesByCategory[C] & string;
  /** Label for the quantity on the BOM ("Leather", "Wood board", "Material"). */
  material_label: string;
  constructions: Array<ConstructionDef<C>>;
  fields: FieldMap<AttributesByCategory[C]>;
  /** Asked in this order; required topics first. */
  topics: Array<TopicDef<C>>;
}

export type CategorySchemas = { [C in CraftCategory]: CategorySchema<C> };
