import { attrs, normalizeSpecifications, schemaOf } from '@/lib/spec/catalog';
import { parseDimensions } from '@/lib/spec/parsers';
import { ACCESSORY_HINT, matchReference, sizeForContent, SITE_VISIT_HINT } from '@/lib/spec/references';
import type { AttributeValue, Dimensions, DimensionMode, Specifications } from '@/lib/types';

/**
 * Decide how the size was established and make `dimension_mode`, `reference_object` and `dimensions_cm` agree.
 * Runs after every intake turn (Gemini or offline), over the whole client transcript, in this precedence:
 *
 *   1. explicit centimetres from the client            → EXACT_CM (the client's numbers stand)
 *   2. furniture for a room, no measurements           → PENDING_SITE_VISIT (dimensions cleared; provisional at lock)
 *   3. a reference from the table (Birkin 30, iPad...) → REFERENCE_BASED, dimensions computed from the table
 *   4. a reference Gemini recognised outside the table → REFERENCE_BASED with Gemini's inferred dimensions
 *
 * Footwear has no L x W x H: a stated EU size counts as EXACT_CM.
 */
export function resolveDimensionSource(
  raw: Specifications,
  clientText: string,
  ai: { mode?: DimensionMode; reference?: string } = {},
): Specifications {
  const spec = normalizeSpecifications(raw);
  const a = attrs(spec);
  const set = (mode: DimensionMode, reference: string, dims?: Dimensions): Specifications => {
    if (dims) a.dimensions_cm = dims as unknown as AttributeValue;
    return { ...spec, dimension_mode: mode, reference_object: reference };
  };

  if (spec.category === 'FOOTWEAR') return (a.eu_size as number) > 0 && spec.dimension_mode === 'UNSPECIFIED' ? set('EXACT_CM', '') : spec;
  if (!('dimensions_cm' in schemaOf(spec.category).fields)) return spec;

  const explicit = parseDimensions(clientText);
  if (explicit && (explicit.length ?? 0) > 0 && (explicit.height ?? 0) > 0) return set('EXACT_CM', spec.dimension_mode === 'EXACT_CM' ? spec.reference_object : '');

  const wantsSiteVisit = ai.mode === 'PENDING_SITE_VISIT' || spec.dimension_mode === 'PENDING_SITE_VISIT' || (spec.category === 'FURNITURE' && SITE_VISIT_HINT.test(clientText));
  if (wantsSiteVisit && spec.category === 'FURNITURE') return set('PENDING_SITE_VISIT', '', { length: 0, width: 0, height: 0 });

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
