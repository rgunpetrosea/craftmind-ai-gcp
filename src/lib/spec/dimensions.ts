import { attrs, constructionDef, normalizeSpecifications, schemaOf } from '@/lib/spec/catalog';
import { FULL_CEILING, isBuiltInFurniture } from '@/lib/spec/categories/furniture';
import { parseDimensions, parseKitchenLayout, parseWallRuns } from '@/lib/spec/parsers';
import { ACCESSORY_HINT, matchReference, sizeForContent, SITE_VISIT_HINT } from '@/lib/spec/references';
import type { AttributeValue, Dimensions, DimensionMode, Specifications } from '@/lib/types';

/**
 * Decide how the size was established and make `dimension_mode`, `reference_object` and `dimensions_cm` agree.
 * Runs after every intake turn (Gemini or offline), over the whole client transcript, in this precedence:
 *
 *   0. furniture with a site visit already selected     → stays PENDING_SITE_VISIT; numbers the client gives are kept as
 *                                                         the provisional size (the survey confirms them)
 *   1. explicit centimetres from the client            → EXACT_CM (the client's numbers stand)
 *   2. furniture for a room, no measurements           → PENDING_SITE_VISIT (dimensions cleared; provisional at lock)
 *   3. a reference from the table (Birkin 30, iPad...) → REFERENCE_BASED, dimensions computed from the table
 *   4. a reference Gemini recognised outside the table → REFERENCE_BASED with Gemini's inferred dimensions
 *
 * Footwear has no L x W x H: a stated EU size counts as EXACT_CM. Built-in cabinetry then gets its wall runs (L1, L2,
 * H, layout) from the text in every mode, see `applyWallRuns`.
 */
export function resolveDimensionSource(
  raw: Specifications,
  clientText: string,
  ai: { mode?: DimensionMode; reference?: string } = {},
): Specifications {
  const resolved = resolveSize(raw, clientText, ai);
  return resolved.category === 'FURNITURE' && isBuiltInFurniture(resolved.construction_type) ? applyWallRuns(resolved, clientText) : resolved;
}

function resolveSize(raw: Specifications, clientText: string, ai: { mode?: DimensionMode; reference?: string }): Specifications {
  const spec = normalizeSpecifications(raw);
  const a = attrs(spec);
  const set = (mode: DimensionMode, reference: string, dims?: Dimensions): Specifications => {
    if (dims) a.dimensions_cm = dims as unknown as AttributeValue;
    return { ...spec, dimension_mode: mode, reference_object: reference };
  };

  if (spec.category === 'FOOTWEAR') return (a.eu_size as number) > 0 && spec.dimension_mode === 'UNSPECIFIED' ? set('EXACT_CM', '') : spec;
  if (!('dimensions_cm' in schemaOf(spec.category).fields)) return spec;

  const explicit = parseDimensions(clientText);
  const explicitDims = !!explicit && (explicit.length ?? 0) > 0 && (explicit.height ?? 0) > 0;
  const provisional = (): Dimensions =>
    explicitDims ? { length: explicit!.length ?? 0, width: explicit!.width ?? 0, height: explicit!.height ?? 0 } : { length: 0, width: 0, height: 0 };

  // A site visit already chosen (by the AI or the crafter) stays chosen; the client's numbers become the provisional size.
  const siteVisitSelected = spec.category === 'FURNITURE' && (spec.dimension_mode === 'PENDING_SITE_VISIT' || ai.mode === 'PENDING_SITE_VISIT');
  if (siteVisitSelected) return set('PENDING_SITE_VISIT', '', provisional());

  if (explicitDims) return set('EXACT_CM', spec.dimension_mode === 'EXACT_CM' ? spec.reference_object : '');

  if (spec.category === 'FURNITURE' && SITE_VISIT_HINT.test(clientText)) return set('PENDING_SITE_VISIT', '', provisional());

  const d = a.dimensions_cm as unknown as Dimensions;
  const hasDims = d.length > 0 && d.height > 0;
  // Sizes the crafter typed on the dashboard (EXACT_CM without cm in the chat) are final.
  if (spec.dimension_mode === 'EXACT_CM' && hasDims) return spec;

  const ref = matchReference(clientText, spec.category);
  if (ref) {
    // Compute from the table once per reference; later relative corrections ("+3 cm") are kept.
    if (spec.reference_object === ref.label && hasDims) return set('REFERENCE_BASED', ref.label);
    const dims = ref.kind === 'MODEL' ? { ...ref.dims } : sizeForContent(ref.dims, ACCESSORY_HINT.test(clientText), spec.category);
    return set('REFERENCE_BASED', ref.label, dims);
  }

  if (ai.mode === 'REFERENCE_BASED' && ai.reference?.trim() && hasDims) return set('REFERENCE_BASED', ai.reference.trim());
  if (hasDims && spec.dimension_mode === 'UNSPECIFIED') return set(ai.mode && ai.mode !== 'UNSPECIFIED' ? ai.mode : 'EXACT_CM', ai.reference?.trim() ?? '');
  return spec;
}

/**
 * Built-in cabinetry measured in wall runs: "L1: 300, L2: 200, H: 240", "bentuk L 3m x 2m tinggi 2,4m". Fills what is
 * missing and repairs what the generic L x W x H parser misread ("300 x 200" read as length x height, or the second wall
 * read as the depth), in any dimension mode, so a pending site visit still shows the client's numbers. A second wall
 * without a layout word means an L-shape. Values the crafter set deliberately (a depth under 1 m, a set L2) are kept.
 */
export function applyWallRuns(raw: Specifications, clientText: string): Specifications {
  const spec = normalizeSpecifications(raw);
  if (spec.category !== 'FURNITURE') return spec;
  const a = spec.attributes;
  const runs = parseWallRuns(clientText);
  const shape = parseKitchenLayout(clientText);
  const d = { ...a.dimensions_cm };
  const depth = (constructionDef(spec.construction_type)?.defaults as { dimensions_cm?: Dimensions } | undefined)?.dimensions_cm?.width ?? 60;
  if (runs?.l1 && !(d.length > 0)) d.length = runs.l1;
  if (runs?.l2) {
    if (d.height === runs.l2 && runs.h) d.height = runs.h;
    if (d.width === runs.l2 || d.width > 100) d.width = depth;
  }
  if (runs?.h && !(d.height > 0)) d.height = runs.h;
  if (d.length > 0 && !(d.width > 0)) d.width = depth;
  // "sampai plafon" in the chat always reaches the spec card (Gemini may miss the flag); without a stated room height
  // the cabinetry runs to a standard 240 cm ceiling
  const fullHeight = a.floor_to_ceiling || FULL_CEILING.test(clientText);
  if (fullHeight && !(d.height >= 200)) d.height = 240;
  const attributes = { ...a, dimensions_cm: d, floor_to_ceiling: fullHeight };
  if (spec.construction_type === 'KITCHEN_SET') {
    if (runs?.l2 && !(a.second_wall_cm > 0)) attributes.second_wall_cm = runs.l2;
    if (a.layout_shape === 'UNSPECIFIED') attributes.layout_shape = shape ?? (attributes.second_wall_cm > 0 ? 'L_SHAPE' : a.layout_shape);
  }
  return { ...spec, attributes };
}

/** Human-readable note on where the size came from (spec card, quotation, dashboard). */
export function dimensionNote(spec: Specifications): string {
  switch (spec.dimension_mode) {
    case 'REFERENCE_BASED':
      return `estimasi dari referensi ${spec.reference_object}`;
    case 'PENDING_SITE_VISIT':
      return 'menunggu survei ukur di lokasi; ukuran sementara';
    case 'EXACT_CM':
      return 'ukuran dari klien';
    default:
      return '';
  }
}
