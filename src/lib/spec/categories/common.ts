import type { DimensionsField, EnumField, TextField, TopicDef } from '@/lib/spec/fields';
import type { CraftCategory } from '@/lib/types';

/**
 * Design direction (Design Intelligence Layer v2, section 8): before the first mockup the client picks, combines or
 * adjusts one of up to three abstract directions the Direction Agent proposes ("terserah" takes the recommendation).
 * The proposal itself is built by agents/direction-agent.ts; `ask` is only the fallback wording.
 */
/**
 * Visual probing (asked once, optional): a photo of the hardware, stitching or interior the client likes says more than
 * any description. A photo they send becomes the order's sketch / reference image (taste only, never copied).
 */
export const visualReferenceTopic = <C extends CraftCategory>(details: string): TopicDef<C> => ({
  id: 'visual_reference',
  label: 'Reference photo',
  ask: `do you have a photo of ${details} you like; if so, feel free to send it`,
  required: false,
  fields: [],
  deferrable: true,
  // answered by being asked once (a photo, a description, or "nggak ada")
  is_filled: () => false,
});

export const directionTopic = <C extends CraftCategory>(): TopicDef<C> => ({
  id: 'direction',
  label: 'Design direction',
  ask: 'which of these original design directions suits you best, or would you like to combine them',
  required: true,
  fields: [],
  deferrable: true,
  solo: true,
  is_filled: (s) => s.design_direction !== 'UNSPECIFIED',
});
import {
  parseDimensions,
  parseEdgeFinish,
  parseEmbossingPlacement,
  parseEmbossingText,
  parseEmbossingType,
  parseLeather,
  parseStitchingMethod,
  parseThreadColor,
} from '@/lib/spec/parsers';
import type { EmbossingType, LeatherEdgeFinish } from '@/lib/types';

/** Field definitions reused by categories that share a concept (never shared data: each category stores its own copy). */

export const dimensionsField = <A,>(description: string, required: DimensionsField<A>['required_axes'] = ['length', 'height']): DimensionsField<A> => ({
  type: 'dimensions',
  label: 'Dimensions',
  label_id: 'Ukuran',
  group: 'size',
  unit: 'cm',
  required_axes: required,
  description,
  parse: parseDimensions,
});

export const leatherField = <A,>(label = 'Exterior leather'): TextField<A> => ({
  type: 'text',
  label,
  label_id: 'Kulit',
  group: 'material',
  placeholder: 'e.g. Epsom Black 1.2mm',
  description: 'Leather type + color + thickness ONLY, e.g. "Veg-Tan Brown 1.6mm". Rigidity or softness does not belong here.',
  parse: parseLeather,
});

export const leatherEdgeField = <A,>(): EnumField<A, LeatherEdgeFinish> => ({
  type: 'enum',
  label: 'Edge finish',
  label_id: 'Finishing pinggiran',
  group: 'finish',
  options: { BURNISHED: 'Burnished', EDGE_PAINT: 'Edge paint', RAW: 'Raw / clean cut', TURNED_EDGE: 'Turned edge' },
  description: 'How the cut leather edges are finished.',
  parse: parseEdgeFinish,
});

export const stitchingMethodField = <A,>(): TextField<A> => ({
  type: 'text',
  label: 'Stitching method',
  label_id: 'Metode jahit',
  group: 'finish',
  placeholder: 'e.g. Hand saddle stitch',
  description: 'Hand saddle stitch, machine lockstitch, etc.',
  parse: parseStitchingMethod,
});

export const threadColorField = <A,>(): TextField<A> => ({
  type: 'text',
  label: 'Thread color',
  label_id: 'Warna benang',
  group: 'finish',
  description: 'Thread color, e.g. "natural", "black".',
  parse: parseThreadColor,
});

type WithEmbossing = { embossing_type: EmbossingType };
const embossingActive = (a: WithEmbossing) => a.embossing_type !== 'UNSPECIFIED' && a.embossing_type !== 'NONE';

export const embossingFields = <A extends WithEmbossing>() => ({
  embossing_type: {
    type: 'enum',
    label: 'Personalization',
    label_id: 'Kustomisasi',
    group: 'personalization',
    options: { NONE: 'None', EMBOSS_INITIALS: 'Emboss initials', EMBOSS_LOGO: 'Emboss logo', LASER_ENGRAVING: 'Laser engraving' },
    description: 'Initials/monogram → EMBOSS_INITIALS, brand/logo → EMBOSS_LOGO, carved/laser artwork → LASER_ENGRAVING, client declined → NONE.',
    parse: parseEmbossingType,
  } satisfies EnumField<A, EmbossingType>,
  embossing_text: {
    type: 'text',
    label: 'Personalization text / artwork',
    label_id: 'Tulisan / motif',
    group: 'personalization',
    description: 'The initials, logo name or artwork motif, e.g. "R.W" or "batik mega mendung".',
    parse: parseEmbossingText,
    relevant: (a) => embossingActive(a),
  } satisfies TextField<A>,
  embossing_placement: {
    type: 'text',
    label: 'Placement',
    label_id: 'Posisi',
    group: 'personalization',
    description: 'Where the personalization goes, e.g. "pojok kanan bawah".',
    parse: parseEmbossingPlacement,
    relevant: (a) => embossingActive(a),
  } satisfies TextField<A>,
});
