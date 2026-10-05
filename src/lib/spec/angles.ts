import type { ConstructionType, CraftCategory, MockupAngle } from '@/lib/types';

/**
 * Category strategy matrix for the 3-angle mockup set. Each slot (ANGLE_1..3) maps to a VIEW per craft category, and
 * every view declares its SCOPE, which decides which spec fields reach the image prompt:
 *
 *   EXTERIOR  closed / outside only: interior-zone fields (card slots, lining, inner pockets) are withheld and, for
 *             closed angles, an explicit isolation rule tells the model not to render them
 *   INTERIOR  opened up: interior fields are included and emphasised
 *   DETAIL    macro of materials and finishing
 *   FULL      everything (used for crafter custom prompts, which may show any part)
 *
 * Client-safe (no SDK imports): also used by the dashboard tabs, the WhatsApp captions and the client gallery.
 */

export const MOCKUP_ANGLES: MockupAngle[] = ['ANGLE_1', 'ANGLE_2', 'ANGLE_3'];

export type ViewScope = 'EXTERIOR' | 'INTERIOR' | 'DETAIL' | 'FULL';

export interface AngleView {
  /** Semantic key stored on the render, e.g. "CLOSED_EXTERIOR". */
  view: string;
  /** Dashboard tab label. */
  label: string;
  /** Caption for the client (WhatsApp / gallery). */
  label_id: string;
  /** Default camera / shot direction. */
  shot: string;
  scope: ViewScope;
  /** Hard rule appended to the prompt (closed views must not leak interior features). */
  isolation?: string;
}

const CLOSED_ONLY =
  'CLOSED FOLDED VIEW ONLY. Do NOT render interior slots, linings, or open compartments. Render front emboss on exterior shell if specified.';
const CLOSED_BAG = 'CLOSED VIEW ONLY. Do NOT render the interior, lining or open compartments. Render front emboss on the exterior if specified.';

const MATRIX: Record<CraftCategory, [AngleView, AngleView, AngleView]> = {
  SMALL_GOODS: [
    { view: 'CLOSED_EXTERIOR', label: 'Closed exterior', label_id: 'Tampak luar (tertutup)', scope: 'EXTERIOR', isolation: CLOSED_ONLY, shot: 'the wallet CLOSED / FOLDED, front exterior shell facing the camera at a slight three-quarter angle' },
    { view: 'OPEN_INTERIOR', label: 'Open interior', label_id: 'Bagian dalam (terbuka)', scope: 'INTERIOR', shot: 'the wallet FULLY OPEN and laid flat, top-down, showing every card slot, cash compartment and the lining' },
    { view: 'STITCH_EDGE_MACRO', label: 'Stitch & edge macro', label_id: 'Detail jahitan & pinggiran', scope: 'DETAIL', shot: 'macro close-up of the stitch line and edge finish at one corner, shallow depth of field' },
  ],
  BAG: [
    { view: 'HERO_3_4', label: 'Front 3/4 hero', label_id: 'Tampak depan 3/4', scope: 'EXTERIOR', isolation: CLOSED_BAG, shot: 'full front three-quarter hero shot of the closed bag showing the silhouette, closure hardware and strap/handles' },
    { view: 'SIDE_PROFILE', label: 'Side profile', label_id: 'Tampak samping', scope: 'EXTERIOR', isolation: CLOSED_BAG, shot: 'exact side profile showing the gusset depth, strap attachment points and the finished/painted edges' },
    { view: 'TOP_DOWN_INTERIOR', label: 'Open interior', label_id: 'Bagian dalam tas', scope: 'INTERIOR', shot: 'top-down view into the OPEN bag showing the compartments, interior pockets and lining' },
  ],
  FOOTWEAR: [
    { view: 'LATERAL_PROFILE', label: 'Lateral profile', label_id: 'Tampak samping', scope: 'EXTERIOR', shot: 'lateral (outer) side profile of one shoe on a studio display plinth, the pair partly visible behind' },
    { view: 'TOP_DOWN_VAMP', label: 'Top-down vamp', label_id: 'Tampak atas', scope: 'EXTERIOR', shot: 'top-down view of the pair showing the vamp, lacing and toe box shape' },
    { view: 'WELT_SOLE_MACRO', label: 'Welt & sole macro', label_id: 'Detail welt & sol', scope: 'DETAIL', shot: 'macro shot of the welt stitching, sole edge and heel stack craftsmanship' },
  ],
  FURNITURE: [
    { view: 'ISOMETRIC_ROOM', label: 'Isometric in room', label_id: 'Tampak di ruangan', scope: 'EXTERIOR', shot: 'full isometric view of the piece in a styled, minimal room context, natural light' },
    { view: 'FUNCTIONAL_OPEN', label: 'Functional / open', label_id: 'Laci & pintu terbuka', scope: 'INTERIOR', shot: 'functional view with drawers and doors pulled open (or, for tables and chairs without them, the underside showing the frame and structure)' },
    { view: 'JOINERY_MACRO', label: 'Joinery & hardware macro', label_id: 'Detail sambungan & hardware', scope: 'DETAIL', shot: 'macro shot of the wood joinery, any leather wrapping or upholstery, and the hardware handles' },
  ],
  CUSTOM_GENERIC: [
    { view: 'HERO', label: 'Hero', label_id: 'Tampak utama', scope: 'EXTERIOR', shot: 'hero shot of the whole item, three-quarter angle' },
    { view: 'ALTERNATE', label: 'Alternate view', label_id: 'Tampak lain', scope: 'FULL', shot: 'a second angle (back or side) showing how the item is constructed or worn/used' },
    { view: 'DETAIL', label: 'Detail', label_id: 'Detail material', scope: 'DETAIL', shot: 'macro close-up of the material texture and finishing' },
  ],
};

/** A flat card holder has no closed/open state: its "interior" is the slot face, the "exterior" is the plain outer face. */
const FLAT_CARD_HOLDER_VIEWS: Partial<Record<MockupAngle, Partial<AngleView>>> = {
  ANGLE_1: {
    view: 'OUTER_FACE',
    label: 'Outer face',
    label_id: 'Tampak luar (sisi polos)',
    shot: 'the plain OUTER face of the flat card holder (the side without card slots), flat-lay at a slight angle',
    isolation: 'OUTER FACE ONLY. Do NOT render card slots, cards, linings or pockets. Render front emboss on the outer face if specified.',
  },
  ANGLE_2: { view: 'SLOT_FACE', label: 'Slot face', label_id: 'Sisi slot kartu', shot: 'the SLOT face of the flat card holder with cards inserted in every slot and the central pocket visible, top-down' },
};

const index = (angle: MockupAngle) => MOCKUP_ANGLES.indexOf(angle);

export function angleDef(category: CraftCategory, angle: MockupAngle, construction?: ConstructionType): AngleView {
  const base = (MATRIX[category] ?? MATRIX.CUSTOM_GENERIC)[index(angle)] ?? MATRIX.CUSTOM_GENERIC[0];
  const flat = construction === 'FLAT_CARD_HOLDER' || construction === 'PATTERNED_CARD_HOLDER';
  return flat ? { ...base, ...FLAT_CARD_HOLDER_VIEWS[angle] } : base;
}

/** View used when the crafter overrides the shot with a custom prompt: every field is available. */
export function customView(category: CraftCategory, angle: MockupAngle, construction?: ConstructionType): AngleView {
  const base = angleDef(category, angle, construction);
  return { ...base, view: 'CUSTOM', scope: 'FULL', isolation: undefined };
}

/** Legacy angle ids (before category views) → slots. */
export const LEGACY_ANGLE: Record<string, MockupAngle> = { EXTERIOR_CLOSED: 'ANGLE_1', INTERIOR_OPEN: 'ANGLE_2', DETAIL_MACRO: 'ANGLE_3' };

/** First slot of this category that shows the given scope (e.g. the open interior), if any. */
export function angleForScope(category: CraftCategory, scope: ViewScope, construction?: ConstructionType): MockupAngle | undefined {
  return MOCKUP_ANGLES.find((a) => angleDef(category, a, construction).scope === scope);
}

/** `angle_id` 1..3 from the mockup tool → slot. */
export function angleFromId(id: unknown): MockupAngle | undefined {
  const n = Math.round(Number(id));
  return n >= 1 && n <= MOCKUP_ANGLES.length ? MOCKUP_ANGLES[n - 1] : undefined;
}

const INTERIOR_REQUEST =
  /\b(posisi terbuka|terbuka(nya)?|dibuka|kebuka|bukaan|bagian dalam(nya)?|dalamnya|sisi dalam|interior|inside|open ?view|opened|slot ?kartu(nya)?|card ?slots?|isinya|furing(nya)?|lining)\b/i;
const DETAIL_REQUEST = /\b(detail jahitan|jahitan(nya)?|stitch\w*|pinggiran(nya)?|edge|close ?-?up|macro|makro|dari dekat)\b/i;
const EXTERIOR_REQUEST = /\b(tampak luar|luarnya|posisi tertutup|tertutup|ditutup|closed|exterior|tampak depan)\b/i;

/**
 * The view the client explicitly asked to see ("posisi terbuka", "slot kartunya", "detail jahitan", "tampak luar"),
 * mapped to this category's slot. Undefined when no specific view was asked for.
 */
export function angleForRequest(text: string, category: CraftCategory, construction?: ConstructionType): MockupAngle | undefined {
  if (INTERIOR_REQUEST.test(text)) return angleForScope(category, 'INTERIOR', construction);
  if (DETAIL_REQUEST.test(text)) return angleForScope(category, 'DETAIL', construction);
  if (EXTERIOR_REQUEST.test(text)) return 'ANGLE_1';
  return undefined;
}

/** Products whose outside and inside are designed separately (emboss / two-tone outside, card slots / lining inside). */
const PAIRED_CATEGORIES = new Set<CraftCategory>(['SMALL_GOODS', 'BAG']);

/**
 * Angles a mockup round shows by default. Wallets, card holders and bags always get the closed exterior AND the open
 * interior (wallets: ANGLE_2, bags: ANGLE_3) as one paired render, so the client sees the card slots / lining too.
 * Footwear, furniture and custom items start with the hero view.
 */
export function defaultMockupAngles(category: CraftCategory, construction?: ConstructionType): MockupAngle[] {
  const interior = PAIRED_CATEGORIES.has(category) ? angleForScope(category, 'INTERIOR', construction) : undefined;
  return interior ? ['ANGLE_1', interior] : ['ANGLE_1'];
}

/**
 * The full set rendered when the spec is confirmed (spec card), in ONE tool call: the default angles plus the category's
 * detail macro when it has one (wallets: closed + open interior + stitch & edge macro = all 3; footwear / furniture /
 * custom: hero + macro; bags have no macro slot and keep their pair).
 */
export function confirmationMockupAngles(category: CraftCategory, construction?: ConstructionType): MockupAngle[] {
  const detail = angleForScope(category, 'DETAIL', construction);
  const set = new Set([...defaultMockupAngles(category, construction), ...(detail ? [detail] : [])]);
  return MOCKUP_ANGLES.filter((a) => set.has(a));
}

/** Does this product get a detail macro shot (and therefore the larger AI render budget)? */
export function needsDetailMacro(category: CraftCategory, construction?: ConstructionType): boolean {
  return angleForScope(category, 'DETAIL', construction) !== undefined;
}

/** `angles` [1, 2, 3] from the mockup tool → slots (invalid ids dropped, duplicates removed, slot order). */
export function anglesFromIds(ids: unknown): MockupAngle[] {
  if (!Array.isArray(ids)) return [];
  const set = new Set(ids.map(angleFromId).filter((a): a is MockupAngle => Boolean(a)));
  return MOCKUP_ANGLES.filter((a) => set.has(a));
}

/** Human list of the slots for the tool description: "1 = Closed exterior, 2 = Open interior, 3 = ...". */
export function angleChoices(category: CraftCategory, construction?: ConstructionType): string {
  return MOCKUP_ANGLES.map((a, i) => {
    const d = angleDef(category, a, construction);
    return `${i + 1} = ${d.label} (${d.scope.toLowerCase()})`;
  }).join(', ');
}
