import { analyzeReferences, originalityNotice } from '@/lib/spec/design-dna';
import {
  defaultOriginalFeature,
  DIRECTION_CATEGORIES,
  directionDef,
  directionsByFeel,
  directionsNamed,
  isCatalogFeature,
  isDirectionSet,
  OPEN_TOP_BAG_FEATURE,
  originalFeaturePrompt,
  silhouetteLogic,
  type DirectionDef,
} from '@/lib/spec/directions';
import type { ClientBrief, DesignDirection, Specifications } from '@/lib/types';

/**
 * Agent: Direction (Design Intelligence Layer v2, sections 6-8). Deterministic, no AI call and no server imports, so it
 * works offline and the spec finalizer can use it too:
 *   recommendDirections()   rank the ten abstract directions for this client (usage, references, form factor, material)
 *   directionProposal()     up to three cards as WhatsApp bubbles, the recommendation first with the reason it fits
 *   applyDirectionAnswer()  "yang kedua", "gabung 1 dan 3", "quiet luxury aja", "ikut rekomendasi" → the spec
 *   completeDesignIntent()  every concept gets one original feature, one functional advantage, one craftsmanship detail
 *   designRiskFlags()       contradictions the critic and the crafter must see (premium + synthetic, undersized laptop bag)
 */

type Dir = DirectionDef['id'];

export interface DirectionRecommendation {
  id: Dir;
  /** Why it fits, in the client's terms ("karena dipakai untuk kerja"). */
  reason: string;
}

export const MAX_DIRECTION_CARDS = 3;

/** Form-factor priors: what each product naturally leans towards. */
const CONSTRUCTION_PRIORS: Record<string, Dir[]> = {
  EXECUTIVE_BRIEFCASE: ['STRUCTURED_ELEGANCE', 'HERITAGE_CRAFTSMANSHIP', 'QUIET_LUXURY'],
  TOP_HANDLE_BAG: ['STRUCTURED_ELEGANCE', 'QUIET_LUXURY', 'ARCHITECTURAL'],
  STRUCTURED_TOTE: ['STRUCTURED_ELEGANCE', 'QUIET_LUXURY', 'PRACTICAL_LUXURY'],
  SLOUCHY_TOTE: ['SOFT_CONTEMPORARY', 'QUIET_LUXURY', 'CONTEMPORARY_ARTISAN'],
  MESSENGER_BAG: ['PRACTICAL_LUXURY', 'HERITAGE_CRAFTSMANSHIP', 'MODERN_MINIMALISM'],
  BACKPACK: ['PRACTICAL_LUXURY', 'MODULAR_UTILITY', 'MODERN_MINIMALISM'],
  HYBRID_BACKPACK_TOTE: ['MODULAR_UTILITY', 'PRACTICAL_LUXURY', 'SOFT_CONTEMPORARY'],
  CROSSBODY_CAMERA_BAG: ['MODULAR_UTILITY', 'PRACTICAL_LUXURY', 'CONTEMPORARY_ARTISAN'],
  SLING_BAG: ['MODERN_MINIMALISM', 'PRACTICAL_LUXURY', 'SOFT_CONTEMPORARY'],
  CLUTCH: ['ARCHITECTURAL', 'QUIET_LUXURY', 'EXPRESSIVE_CRAFT'],
  PADEL_RACKET_BAG: ['MODULAR_UTILITY', 'PRACTICAL_LUXURY', 'MODERN_MINIMALISM'],
  FLAT_CARD_HOLDER: ['MODERN_MINIMALISM', 'QUIET_LUXURY', 'CONTEMPORARY_ARTISAN'],
  PATTERNED_CARD_HOLDER: ['EXPRESSIVE_CRAFT', 'CONTEMPORARY_ARTISAN', 'HERITAGE_CRAFTSMANSHIP'],
  BIFOLD_WALLET: ['QUIET_LUXURY', 'HERITAGE_CRAFTSMANSHIP', 'MODERN_MINIMALISM'],
  LONG_BIFOLD_WALLET: ['STRUCTURED_ELEGANCE', 'QUIET_LUXURY', 'HERITAGE_CRAFTSMANSHIP'],
  TRIFOLD_WALLET: ['HERITAGE_CRAFTSMANSHIP', 'PRACTICAL_LUXURY', 'QUIET_LUXURY'],
  ZIP_AROUND_LONG_WALLET: ['PRACTICAL_LUXURY', 'QUIET_LUXURY', 'STRUCTURED_ELEGANCE'],
  KITCHEN_SET: ['MODERN_MINIMALISM', 'PRACTICAL_LUXURY', 'CONTEMPORARY_ARTISAN'],
  WARDROBE: ['MODERN_MINIMALISM', 'QUIET_LUXURY', 'PRACTICAL_LUXURY'],
  TV_CONSOLE: ['MODERN_MINIMALISM', 'ARCHITECTURAL', 'QUIET_LUXURY'],
  DINING_TABLE: ['CONTEMPORARY_ARTISAN', 'MODERN_MINIMALISM', 'HERITAGE_CRAFTSMANSHIP'],
  COFFEE_TABLE: ['ARCHITECTURAL', 'MODERN_MINIMALISM', 'CONTEMPORARY_ARTISAN'],
  CHAIR: ['CONTEMPORARY_ARTISAN', 'ARCHITECTURAL', 'SOFT_CONTEMPORARY'],
  NIGHTSTAND: ['MODERN_MINIMALISM', 'QUIET_LUXURY', 'CONTEMPORARY_ARTISAN'],
  BED_FRAME: ['SOFT_CONTEMPORARY', 'MODERN_MINIMALISM', 'HERITAGE_CRAFTSMANSHIP'],
};

const CATEGORY_FALLBACK: Record<string, Dir[]> = {
  BAG: ['QUIET_LUXURY', 'STRUCTURED_ELEGANCE', 'CONTEMPORARY_ARTISAN'],
  SMALL_GOODS: ['QUIET_LUXURY', 'HERITAGE_CRAFTSMANSHIP', 'MODERN_MINIMALISM'],
  FURNITURE: ['MODERN_MINIMALISM', 'CONTEMPORARY_ARTISAN', 'HERITAGE_CRAFTSMANSHIP'],
  OTHER: ['QUIET_LUXURY', 'CONTEMPORARY_ARTISAN', 'MODERN_MINIMALISM'],
};

/** Lifestyle cues in the client's words → directions, with the reason quoted back to them. */
const CUES: Array<{ re: RegExp; dirs: Array<[Dir, number]>; reason: string }> = [
  { re: /kerja|kantor|meeting|formal|profesional|bisnis|office/i, dirs: [['STRUCTURED_ELEGANCE', 3], ['QUIET_LUXURY', 1]], reason: 'since it is for work and formal occasions' },
  { re: /travel|traveling|perjalanan|mudik|liburan|commut|mobile|ringan/i, dirs: [['PRACTICAL_LUXURY', 3], ['MODULAR_UTILITY', 1]], reason: 'since it travels with you a lot' },
  { re: /laptop|kamera|camera|banyak barang|organi[sz]|rapi di dalam|sekat/i, dirs: [['PRACTICAL_LUXURY', 2], ['MODULAR_UTILITY', 1.5]], reason: 'since what you carry needs to stay organized' },
  { re: /santai|kasual|casual|weekend|hangout|nongkrong|jalan[- ]jalan/i, dirs: [['SOFT_CONTEMPORARY', 3], ['MODERN_MINIMALISM', 1]], reason: 'since it is for relaxed, everyday use' },
  { re: /vintage|retro|klasik|classic|awet|warisan|turun[- ]?temurun|seumur hidup/i, dirs: [['HERITAGE_CRAFTSMANSHIP', 3], ['CONTEMPORARY_ARTISAN', 1]], reason: 'since you want something classic that lasts' },
  { re: /handmade|buatan tangan|jahit(an)? tangan|berkarakter|karakter|cerita/i, dirs: [['CONTEMPORARY_ARTISAN', 3], ['HERITAGE_CRAFTSMANSHIP', 1]], reason: 'since you love a handmade touch' },
  { re: /mewah|elegan|elegant|premium|luxury|berkelas/i, dirs: [['QUIET_LUXURY', 2], ['STRUCTURED_ELEGANCE', 1]], reason: 'since you want an elegant, premium feel' },
  { re: /simpel|simple|polos|clean|bersih|ga ribet|nggak ribet/i, dirs: [['MODERN_MINIMALISM', 2.5], ['QUIET_LUXURY', 1]], reason: 'since you like it simple and clean' },
  { re: /statement|berani|mencolok|nyentrik|warna[- ]warni|kontras|two[- ]?tone|anyam|tooling|ukir/i, dirs: [['EXPRESSIVE_CRAFT', 3]], reason: 'since you want it to make a statement' },
  { re: /lepas[- ]?pasang|detachable|convertible|2 ?in ?1|multi ?fungsi|serbaguna|modular/i, dirs: [['MODULAR_UTILITY', 3], ['PRACTICAL_LUXURY', 1]], reason: 'since you need it to switch between uses' },
  { re: /unik|beda dari yang lain|sculpt|lengkung|asimetris|bentuk(nya)? (unik|beda)/i, dirs: [['ARCHITECTURAL', 3], ['EXPRESSIVE_CRAFT', 1]], reason: 'since you want a distinctive, recognisable shape' },
];

const attr = (spec: Specifications) => spec.attributes as unknown as Record<string, unknown>;
const text = (v: unknown) => (typeof v === 'string' ? v : '');

/**
 * Up to three directions ranked for this client. Explicitly named directions come first, then the taste behind any
 * reference ("mirip Birkin" → Structured Elegance / Heritage), lifestyle cues, the form factor and the material.
 */
export function recommendDirections(spec: Specifications, brief?: Partial<ClientBrief>, clientText = ''): DirectionRecommendation[] {
  const score = new Map<Dir, number>();
  const reasons = new Map<Dir, Array<[number, string]>>();
  const add = (id: Dir, w: number, reason?: string) => {
    score.set(id, (score.get(id) ?? 0) + w);
    if (reason) reasons.set(id, [...(reasons.get(id) ?? []), [w, reason]]);
  };
  const words = [clientText, brief?.usage_context, brief?.style_preference, brief?.fitment_size, spec.notes, spec.model_name].filter(Boolean).join('\n');
  const a = attr(spec);

  for (const id of directionsNamed(words)) add(id, 10, 'it matches the style you mentioned');
  const refs = analyzeReferences([words, spec.reference_object, ...spec.reference_likes].join('\n'));
  refs.taste.forEach((id, i) => add(id, i === 0 ? 6 : 4, refs.references[0] ? `since you like the feel of ${refs.references[0]}, while keeping the design original` : undefined));
  for (const cue of CUES) if (cue.re.test(words)) for (const [id, w] of cue.dirs) add(id, w, cue.reason);

  const priors = CONSTRUCTION_PRIORS[spec.construction_type] ?? [];
  priors.forEach((id, i) => add(id, [4, 3, 2][i] ?? 1, i === 0 ? 'since it suits the piece you want best' : undefined));
  (CATEGORY_FALLBACK[spec.category] ?? CATEGORY_FALLBACK.OTHER).forEach((id, i) => add(id, [1.5, 1, 0.5][i] ?? 0));

  const material = text(a.exterior_leather ?? a.primary_material ?? a.upper_material);
  const signals: Array<[boolean, Array<[Dir, number]>]> = [
    [a.structure === 'RIGID', [['STRUCTURED_ELEGANCE', 2], ['ARCHITECTURAL', 1]]],
    [a.structure === 'SOFT', [['SOFT_CONTEMPORARY', 2.5]]],
    [a.strap_type === 'CONVERTIBLE' || a.strap_type === 'DETACHABLE_LEATHER', [['MODULAR_UTILITY', 1]]],
    [/croc|buaya|python|ostrich|lizard|stingray|exotic/i.test(material), [['EXPRESSIVE_CRAFT', 2], ['QUIET_LUXURY', 1]]],
    [/veg[\s-]?tan|pull[\s-]?up|crazy horse/i.test(material), [['CONTEMPORARY_ARTISAN', 1.5], ['HERITAGE_CRAFTSMANSHIP', 1]]],
    [/epsom|saffiano/i.test(material), [['STRUCTURED_ELEGANCE', 1], ['PRACTICAL_LUXURY', 1]]],
    [/jati|teak|mahoni/i.test(material), [['HERITAGE_CRAFTSMANSHIP', 1], ['CONTEMPORARY_ARTISAN', 1]]],
    [/besi|metal|iron|baja/i.test(`${material} ${text(a.secondary_material)}`), [['MODERN_MINIMALISM', 1], ['ARCHITECTURAL', 1]]],
  ];
  for (const [on, dirs] of signals) if (on) for (const [id, w] of dirs) add(id, w);

  return [...score.entries()]
    .sort((x, y) => y[1] - x[1])
    .slice(0, MAX_DIRECTION_CARDS)
    .map(([id]) => ({
      id,
      reason: (reasons.get(id) ?? []).sort((x, y) => y[0] - x[0])[0]?.[1] ?? `since it suits ${spec.model_name.trim() || 'your order'}`,
    }));
}

export interface DirectionCard {
  id: Dir;
  name: string;
  /** What the client sees: the practical feel and one short sentence. */
  feel: string;
  pitch: string;
  personality: string;
  use_fit: string;
  silhouette_material_logic: string;
  original_feature: string;
  practical_benefit: string;
  trade_off: string;
  recommended: boolean;
  reason?: string;
}

export function directionCards(spec: Specifications, recs: DirectionRecommendation[]): DirectionCard[] {
  return recs.map((r, i) => {
    const d = directionDef(r.id)!;
    return {
      id: d.id,
      name: d.name,
      feel: d.feel,
      pitch: d.pitch,
      personality: d.personality,
      use_fit: d.use_fit,
      silhouette_material_logic: silhouetteLogic(d, spec.category),
      original_feature: featureFor(spec, d.id),
      practical_benefit: d.benefit,
      trade_off: d.trade_off,
      recommended: i === 0,
      ...(i === 0 && { reason: r.reason }),
    };
  });
}

/**
 * The proposal as WhatsApp bubbles, kept light: one list bubble (a short question, then one line per card: the practical
 * feel + one short sentence, the recommendation first) and one closing bubble (why the recommendation fits + "pick a
 * number, or let me choose"). The full cards (use fit, silhouette & material logic, original feature, benefit,
 * trade-off) stay on the dashboard. With `notice`, the originality explanation for a copy request opens the list bubble.
 */
export function directionProposal(spec: Specifications, recs: DirectionRecommendation[], notice?: string): { list: string; closing: string; cards: DirectionCard[] } {
  const cards = directionCards(spec, recs);
  const lines = cards.map((c, i) => `${i + 1}. *${c.feel}*${c.recommended ? ' (recommended)' : ''}: ${c.pitch}.`);
  const header = `${notice ? `${notice} ` : ''}To get the design right, which feel do you prefer?`;
  const first = cards[0];
  return {
    cards,
    list: [header, ...lines].join('\n'),
    closing: `I'd suggest number 1, ${first.reason ?? ''}. Just reply with a number, or say "you choose" and I'll pick for you.`.replace(/\s+\./g, '.'),
  };
}

const ORDINALS: Array<[RegExp, number]> = [
  [/\b(pertama|satu|nomor\s*1|no\.?\s*1|opsi\s*1|yang\s*1|pilihan\s*1|#1|first|number\s*1|option\s*1)\b|^\s*1\s*$/i, 0],
  [/\b(kedua|dua|nomor\s*2|no\.?\s*2|opsi\s*2|yang\s*2|pilihan\s*2|#2|second|number\s*2|option\s*2)\b|^\s*2\s*$/i, 1],
  [/\b(ketiga|tiga|terakhir|nomor\s*3|no\.?\s*3|opsi\s*3|yang\s*3|pilihan\s*3|#3|third|last one|number\s*3|option\s*3)\b|^\s*3\s*$/i, 2],
];
/** "1 dan 3", "1 & 2", "gabung 2 sama 3": bare digits joined as a combination. */
const COMBO_DIGITS = /\b([123])\s*(?:dan|&|\+|sama|,|plus|and|with)\s*([123])\b/i;
const ACCEPT = /rekomendasi|saran(an)?\s*(kakak|kak|mas|mbak)?|terserah|bebas|pilih(in|kan)|ikut (aja|saja|yang)|boleh|\boke?\b|\bok\b|\bsip\b|setuju|yang itu|mantap|gas\b|recommend\w*|suggest\w*|you (choose|pick|decide)|up to you|your (call|choice)|go (with|for) (it|that)|sounds good|\bsure\b|\byes\b|agreed?|that one/i;
const COMBINE = /gabung|kombinasi|campur|mix|perpaduan|digabung|\bdan\b|&|\+|sama|combin\w*|blend|\band\b|\bboth\b/i;

/**
 * Reads the client's answer to the direction proposal. `proposed` is the order the cards were shown in, so "yang kedua"
 * and "gabung 1 dan 3" map to the right directions; a plain "boleh / ikut rekomendasi / terserah" takes the recommended
 * one. Anything said beyond the choice ("yang 1 tapi lebih santai") is kept as a design adjustment for the crafter.
 */
export function applyDirectionAnswer(spec: Specifications, answer: string, proposed: DesignDirection[]): { spec: Specifications; chosen: boolean } {
  const t = answer.trim();
  if (!t) return { spec, chosen: false };
  const shown = proposed.filter(isDirectionSet) as Dir[];
  const combo = COMBO_DIGITS.exec(t);
  const byOrdinal = combo
    ? [Number(combo[1]) - 1, Number(combo[2]) - 1]
    : ORDINALS.map(([re, i]) => ({ i, at: t.search(re) })).filter((x) => x.at >= 0).sort((a, b) => a.at - b.at).map((x) => x.i);
  const named = directionsNamed(t);
  // "yang kalem aja", "yang simpel": the card's everyday feel (only when no direction was named outright)
  const byFeel = named.length || byOrdinal.length ? [] : directionsByFeel(t, shown);
  const picks = [...new Set([...named, ...byOrdinal.map((i) => shown[i]).filter(Boolean), ...byFeel])] as Dir[];
  if (!picks.length && shown.length && ACCEPT.test(t)) picks.push(shown[0]);
  if (!picks.length) return { spec, chosen: false };
  const out = structuredClone(spec);
  out.design_direction = picks[0];
  out.secondary_direction = picks.length > 1 && COMBINE.test(t) ? picks[1] : 'UNSPECIFIED';
  // "yang 1 tapi lebih santai, tanpa hardware emas" → kept for the crafter and every later render
  if (t.length > 30 && /tapi|cuma|tanpa|lebih|kurang|ganti|dengan|pakai|\bbut\b|\bwithout\b|\bmore\b|\bless\b|\binstead\b|\bwith\b/i.test(t) && !out.custom_fields.some((f) => f.value === t)) {
    out.custom_fields = [...out.custom_fields, { id: `cf-dir-${Date.now().toString(36)}`, label: 'Design direction adjustment', value: t.slice(0, 160), surcharge_idr: 0, source: 'AI' }];
  }
  return { spec: out, chosen: true };
}

/** Does this spec's category gate the first mockup on an approved direction? */
export const needsDirection = (spec: Specifications) => DIRECTION_CATEGORIES.includes(spec.category);

const CARD_HOLDERS = /CARD_HOLDER|KEY_POUCH|PASSPORT/;

function functionalAdvantage(spec: Specifications): string {
  const a = attr(spec);
  const c = spec.construction_type;
  switch (spec.category) {
    case 'BAG':
      if (Number(a.laptop_size_inch) > 0) return `a padded ${a.laptop_size_inch}-inch laptop compartment kept apart from everything else`;
      if (c === 'CROSSBODY_CAMERA_BAG') return 'padded camera dividers that can be rearranged';
      if (c === 'PADEL_RACKET_BAG') return 'a padded racket compartment with a separate ball pocket';
      if (c === 'BACKPACK' || c === 'HYBRID_BACKPACK_TOTE') return 'quick side access without taking the bag off';
      return 'a quick-access pocket for phone and keys without opening the main compartment';
    case 'SMALL_GOODS':
      return CARD_HOLDERS.test(c) ? 'the most-used card comes out without removing the others' : 'stays slim when full thanks to staggered card slots';
    case 'FURNITURE':
      if (c === 'KITCHEN_SET') return 'modules follow the kitchen workflow: store, wash, cook';
      if (c === 'WARDROBE') return 'hanging space, drawers and shelves laid out around how you dress';
      if (c === 'TV_CONSOLE') return 'hidden cable management and ventilation for devices';
      if (/TABLE|DESK/.test(c)) return 'leg placement leaves generous knee and chair room';
      if (/CABINET|SHELF|NIGHTSTAND/.test(c)) return 'hidden storage that is easy to reach';
      return 'sturdy construction that is easy to maintain';
    case 'FOOTWEAR':
      return 'comfortable for long wear thanks to a last fitted to your foot';
    default:
      return 'designed around how you use it every day';
  }
}

/** Open-top bags (totes, or an explicit open-top closure) can't carry a flap feature. */
const isOpenTopBag = (spec: Specifications) =>
  spec.category === 'BAG' && (spec.attributes.main_closure === 'OPEN_TOP' || (spec.attributes.main_closure === 'UNSPECIFIED' && /TOTE/.test(spec.construction_type)));

/** The direction's original feature for THIS product (open-top bags get their variant). */
function featureFor(spec: Specifications, direction: DesignDirection): string {
  const variant = isOpenTopBag(spec) ? OPEN_TOP_BAG_FEATURE[direction as Dir] : undefined;
  return (variant ?? defaultOriginalFeature(direction, spec.category))?.en ?? '';
}

/** Craftsmanship lines this agent writes itself (regenerated when the spec changes). */
const GENERATED_CRAFT = /^(jahitan tangan pelana \(saddle stitch\) dengan |hand saddle stitching with )/;

function craftsmanshipDetail(spec: Specifications): string {
  const a = attr(spec);
  if (spec.category === 'BAG' || spec.category === 'SMALL_GOODS') {
    const edge = a.edge_finish === 'EDGE_PAINT' ? 'neatly layered painted edges' : a.edge_finish === 'TURNED_EDGE' ? 'crisp turned edges' : 'hand-burnished edges';
    return `hand saddle stitching with ${edge}`;
  }
  if (spec.category === 'FURNITURE') {
    const joinery = text(a.joinery_type);
    return joinery && joinery !== 'UNSPECIFIED' ? 'precise wood joinery with a hand-applied finish' : 'precise door gaps and joints with neatly finished edges';
  }
  if (spec.category === 'FOOTWEAR') return 'a neat, consistent welt and stitching';
  return 'careful hand finishing on every detail';
}

/**
 * Section 5: every concept has one proposition (the direction), one original feature, one functional advantage and one
 * craftsmanship opportunity. Missing ones are filled from the direction's card; a feature that came from another
 * direction's card (the client switched direction) is replaced, the client's own idea never is.
 */
export function completeDesignIntent(raw: Specifications): Specifications {
  if (!isDirectionSet(raw.design_direction)) return raw;
  const spec = structuredClone(raw);
  // a catalog feature is re-picked whenever it no longer fits (another direction, or a flap feature on an open-top bag);
  // the client's own idea is never replaced
  const feature = spec.originality_feature.trim();
  const fitting = featureFor(spec, spec.design_direction);
  if (!feature || (isCatalogFeature(feature) && feature !== fitting)) spec.originality_feature = fitting;
  if (!spec.functional_advantage.trim()) spec.functional_advantage = functionalAdvantage(spec);
  // a generated craftsmanship line follows the current edge finish (Epsom → painted edges); the client's own text stays
  if (!spec.craftsmanship_detail.trim() || GENERATED_CRAFT.test(spec.craftsmanship_detail)) spec.craftsmanship_detail = craftsmanshipDetail(spec);
  return spec;
}

/** The direction a spec ends up with when the client left it to the workshop: the top recommendation. */
export function resolveDirection(spec: Specifications, brief?: Partial<ClientBrief>, clientText = ''): Specifications {
  if (isDirectionSet(spec.design_direction) || !needsDirection(spec)) return completeDesignIntent(spec);
  const top = recommendDirections(spec, brief, clientText)[0];
  return completeDesignIntent({ ...spec, design_direction: top.id } as Specifications);
}

/**
 * Caption of the first concept image (section 12): the direction and the original feature, and that the picture is a
 * visual concept the crafter still checks (never a manufacturing guarantee).
 */
export function conceptIntro(spec: Specifications): string {
  const d = directionDef(spec.design_direction);
  const feature = spec.originality_feature.trim();
  const concept = d ? `Here's the first look at your design, in a *${d.feel}* feel${feature ? `, with ${originalFeaturePrompt(feature)} as its signature detail` : ''}.` : "Here's the first look at your design.";
  return `${concept} It's a visual concept our crafter will check; if you'd like a different feel or something isn't quite right, just let me know.`;
}

/** Typical laptop widths (cm) by screen size; a laptop bag body must be wider than the laptop. */
const LAPTOP_WIDTH_CM: Array<[number, number]> = [[11, 29], [12, 29], [13, 30.5], [14, 32.5], [15, 35.5], [16, 36], [17, 39.5]];

const SYNTHETIC = /sintetis|synthetic|\bpu\b|imitasi/i;
const PREMIUM_WISH = /premium|mewah|luxury|berkelas|elegan/i;

/** A laptop bag body smaller than the laptop it must carry: the long side it would need, else undefined. */
function laptopShortfall(spec: Specifications): { inch: number; need: number; length: number; height: number } | undefined {
  const a = attr(spec);
  const inch = Number(a.laptop_size_inch);
  const d = a.dimensions_cm as { length: number; height: number } | undefined;
  if (spec.category !== 'BAG' || !(inch > 0) || !d || !(d.length > 0)) return undefined;
  const need = (LAPTOP_WIDTH_CM.find(([size]) => inch <= size)?.[1] ?? 39.5) + 2;
  return Math.max(d.length, d.height) < need ? { inch, need, length: d.length, height: d.height } : undefined;
}

const premiumWithSynthetic = (spec: Specifications, clientText: string) =>
  SYNTHETIC.test(text(attr(spec).exterior_leather ?? attr(spec).primary_material ?? attr(spec).upper_material)) && PREMIUM_WISH.test(`${clientText} ${spec.notes}`);

/** Contradictions the critic and the crafter must see (section 14: cheap details on a premium request, undersized bag). */
export function designRiskFlags(spec: Specifications, clientText = ''): string[] {
  const flags: string[] = [];
  if (premiumWithSynthetic(spec, clientText)) flags.push('Premium look requested with synthetic leather: material undermines premium perception');
  const short = laptopShortfall(spec);
  if (short) flags.push(`Body ${short.length} x ${short.height} cm is too small for a ${short.inch}" laptop (needs ≥ ${short.need} cm on the long side)`);
  const materials = spec.custom_fields.filter((f) => /kulit|leather|bahan|material/i.test(f.label)).length;
  if (materials >= 2) flags.push('Several extra materials requested: check material harmony (max two leathers, one hardware finish)');
  if (spec.reference_do_not_copy.length && !spec.originality_feature.trim()) flags.push('Designer reference without an original feature yet: risk of a lookalike');
  return flags;
}

/**
 * The same risks as consultant advice to the client (sent once each, as their own bubble): a size that will not hold the
 * laptop it is for, and synthetic leather on a request for a premium look. The client decides; nothing is changed for them.
 */
export function designAdvisories(spec: Specifications, clientText = ''): Array<{ id: 'LAPTOP_FIT' | 'SYNTHETIC_PREMIUM'; text: string }> {
  const out: Array<{ id: 'LAPTOP_FIT' | 'SYNTHETIC_PREMIUM'; text: string }> = [];
  const short = laptopShortfall(spec);
  if (short) {
    out.push({
      id: 'LAPTOP_FIT',
      text: `Just a heads-up: ${short.length} x ${short.height} cm probably won't fit a ${short.inch}-inch laptop (it needs about ${short.need} cm on the long side). Shall we adjust the size so the laptop fits?`,
    });
  }
  if (premiumWithSynthetic(spec, clientText)) {
    out.push({
      id: 'SYNTHETIC_PREMIUM',
      text: 'Just a heads-up: synthetic leather rarely looks premium and starts to look cheap quickly. For a luxury look, genuine leather such as veg-tan or Epsom suits far better. Would you like to stay with synthetic or consider genuine leather?',
    });
  }
  return out;
}

export { originalityNotice };
