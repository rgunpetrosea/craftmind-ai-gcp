import type {
  ConstructionType,
  EdgeTreatment,
  CraftCategory,
  Dimensions,
  IntakeProgress,
  PocketLayout,
  Specifications,
} from '@/lib/types';

/**
 * Single source of truth for form factors and the requirement-gathering checklist.
 * Used by the vision prompt, the offline parser, the pattern generator, the conversation
 * planner and the dashboard dropdowns, so a new construction type is added in one place.
 */

export type ConstructionFamily = 'CARD_HOLDER' | 'WALLET' | 'ZIP_WALLET' | 'BAG' | 'SHOE' | 'OTHER';

export type TopicId =
  | 'construction'
  | 'dimensions'
  | 'leather'
  | 'card_layout'
  | 'customization'
  | 'thread'
  | 'lining'
  | 'edge'
  | 'zipper'
  | 'strap'
  | 'hardware';

export interface ConstructionDef {
  id: ConstructionType;
  label: string;
  category: CraftCategory;
  family: ConstructionFamily;
  /** EN + ID keywords for the offline parser. Defs are tested in catalog order. */
  detect: RegExp;
  /** What distinguishes this form factor in a photo or sketch (fed to the vision model). */
  vision_cue: string;
  default_dimensions: Dimensions;
  default_pockets: Partial<PocketLayout>;
  /** Optional topics asked (once each) before the spec card is locked, in order. */
  detail_topics: TopicId[];
}

export const CONSTRUCTIONS: ConstructionDef[] = [
  {
    id: 'ZIP_AROUND_LONG_WALLET',
    label: 'Zip-around long wallet',
    category: 'bespoke_wallet',
    family: 'ZIP_WALLET',
    detect: /(sleting|zip|resleting)[^.]{0,30}(melingkar|around|keliling)|zip[\s-]?around|dompet panjang.{0,30}(sleting|zip)/i,
    vision_cue: 'Long rectangular wallet closed by a zipper running around three sides; interior card slots and often a coin zip pocket.',
    default_dimensions: { length: 20, width: 2.5, height: 10 },
    default_pockets: { front_slots: 6, back_slots: 6, cash_compartments: 2, coin_zip_pocket: true },
    detail_topics: ['zipper', 'lining', 'customization', 'thread'],
  },
  {
    id: 'PATTERNED_CARD_HOLDER',
    label: 'Patterned / engraved card holder',
    category: 'bespoke_wallet',
    family: 'CARD_HOLDER',
    detect: /(kartu|card).{0,40}(motif|batik|ukir|engrav|ornamen|pattern)|(motif|batik|ukir|engrav|ornamen).{0,40}(kartu|card)/i,
    vision_cue: 'Flat card holder whose outer face carries a carved, stamped or laser-engraved pattern or artwork.',
    default_dimensions: { length: 10, width: 0.6, height: 7 },
    default_pockets: { front_slots: 2, back_slots: 2, central_pockets: 1 },
    detail_topics: ['customization', 'edge', 'thread'],
  },
  {
    id: 'FLAT_CARD_HOLDER',
    label: 'Flat card holder (single panel, no fold)',
    category: 'bespoke_wallet',
    family: 'CARD_HOLDER',
    detect: /dompet kartu|card ?holder|card ?sleeve|card ?case|kartu pipih|pipih|slim wallet/i,
    vision_cue:
      'A SINGLE FLAT panel/sleeve with card slots visible on the front (and/or back) face. There is NO center fold line and it does not open like a book. Cards are slid in from the top edge. Often a central pocket for folded cash.',
    default_dimensions: { length: 10, width: 0.6, height: 7 },
    default_pockets: { front_slots: 2, back_slots: 2, central_pockets: 1 },
    detail_topics: ['customization', 'edge', 'thread'],
  },
  {
    id: 'TRIFOLD_WALLET',
    label: 'Trifold wallet',
    category: 'bespoke_wallet',
    family: 'WALLET',
    detect: /tri[\s-]?fold|lipat tiga/i,
    vision_cue: 'Wallet that folds twice into three panels; visibly thicker than a bifold, with two fold lines.',
    default_dimensions: { length: 10, width: 2.5, height: 9 },
    default_pockets: { front_slots: 3, back_slots: 3, cash_compartments: 1, id_window: true },
    detail_topics: ['customization', 'lining', 'edge', 'thread'],
  },
  {
    id: 'ACCORDION_WALLET',
    label: 'Accordion wallet',
    category: 'bespoke_wallet',
    family: 'WALLET',
    detect: /accordion|akordeon|harmonika|z[\s-]?fold/i,
    vision_cue: 'Wallet with a Z-folded pleated gusset that expands like an accordion, with stacked card pockets.',
    default_dimensions: { length: 11, width: 3, height: 8 },
    default_pockets: { front_slots: 4, back_slots: 4, cash_compartments: 1 },
    detail_topics: ['customization', 'lining', 'edge', 'thread'],
  },
  {
    id: 'BIFOLD_WALLET',
    label: 'Bifold wallet',
    category: 'bespoke_wallet',
    family: 'WALLET',
    detect: /bi[\s-]?fold|lipat dua|dompet lipat/i,
    vision_cue:
      'Wallet that folds ONCE along a center spine like a book; two halves each holding card slots, with a full-length cash compartment between them.',
    default_dimensions: { length: 11, width: 2, height: 9 },
    default_pockets: { front_slots: 3, back_slots: 3, cash_compartments: 2 },
    detail_topics: ['customization', 'lining', 'edge', 'thread'],
  },
  {
    id: 'PADEL_RACKET_BAG',
    label: 'Padel racket bag',
    category: 'bespoke_bag',
    family: 'BAG',
    detect: /padel|raket|racket|racquet/i,
    vision_cue: 'Tall narrow sleeve-style bag sized for a padel/tennis racket, usually with a zipper along one side and a carry strap.',
    default_dimensions: { length: 30, width: 10, height: 60 },
    default_pockets: { exterior_pockets: 1 },
    detail_topics: ['strap', 'lining', 'hardware', 'thread'],
  },
  {
    id: 'EXECUTIVE_BRIEFCASE',
    label: 'Executive briefcase',
    category: 'bespoke_bag',
    family: 'BAG',
    detect: /briefcase|tas kerja|tas kantor|attache|executive/i,
    vision_cue: 'Rigid rectangular business case with top handle(s), a flap or zipper top, and often reinforced corners.',
    default_dimensions: { length: 42, width: 10, height: 31 },
    default_pockets: { interior_zip_pockets: 1, exterior_pockets: 1 },
    detail_topics: ['hardware', 'lining', 'strap', 'customization'],
  },
  {
    id: 'HYBRID_BACKPACK_TOTE',
    label: 'Hybrid backpack-tote',
    category: 'bespoke_bag',
    family: 'BAG',
    detect: /hybrid|campuran|backpack.{0,25}tote|tote.{0,25}backpack|ransel.{0,25}tote|tote.{0,25}ransel/i,
    vision_cue: 'Tote body with convertible backpack straps.',
    default_dimensions: { length: 32, width: 14, height: 40 },
    default_pockets: { interior_zip_pockets: 1 },
    detail_topics: ['strap', 'lining', 'customization', 'thread'],
  },
  {
    id: 'BACKPACK',
    label: 'Backpack',
    category: 'bespoke_bag',
    family: 'BAG',
    detect: /backpack|ransel/i,
    vision_cue: 'Bag worn on the back with two shoulder straps and a top handle.',
    default_dimensions: { length: 30, width: 13, height: 40 },
    default_pockets: { interior_zip_pockets: 1, exterior_pockets: 1 },
    detail_topics: ['strap', 'lining', 'customization', 'thread'],
  },
  {
    id: 'CROSSBODY_CAMERA_BAG',
    label: 'Crossbody camera bag',
    category: 'bespoke_bag',
    family: 'BAG',
    detect: /kamera|camera|mirrorless|dslr/i,
    vision_cue: 'Small boxy crossbody bag with a padded interior sized for a camera body.',
    default_dimensions: { length: 18, width: 8, height: 14 },
    default_pockets: { exterior_pockets: 0 },
    detail_topics: ['strap', 'lining', 'customization', 'thread'],
  },
  {
    id: 'MESSENGER_BAG',
    label: 'Messenger / laptop bag',
    category: 'bespoke_bag',
    family: 'BAG',
    detect: /messenger|tas laptop|laptop bag|satchel/i,
    vision_cue: 'Wide, shallow bag with a long front flap, a crossbody strap and a padded laptop compartment.',
    default_dimensions: { length: 38, width: 10, height: 28 },
    default_pockets: { interior_zip_pockets: 1, exterior_pockets: 1 },
    detail_topics: ['strap', 'lining', 'customization', 'thread'],
  },
  {
    id: 'SLOUCHY_TOTE',
    label: 'Slouchy shoulder tote',
    category: 'bespoke_bag',
    family: 'BAG',
    detect: /slouchy|lemas.{0,25}tote|tote.{0,25}lemas|soft tote|hobo/i,
    vision_cue: 'Soft, unstructured open-top tote that folds and slumps; two shoulder handles.',
    default_dimensions: { length: 38, width: 14, height: 32 },
    default_pockets: { interior_zip_pockets: 1 },
    detail_topics: ['lining', 'customization', 'thread'],
  },
  {
    id: 'STRUCTURED_TOTE',
    label: 'Structured tote',
    category: 'bespoke_bag',
    family: 'BAG',
    detect: /tote/i,
    vision_cue: 'Rigid open-top tote that holds its shape, two top handles.',
    default_dimensions: { length: 35, width: 14, height: 28 },
    default_pockets: { interior_zip_pockets: 1 },
    detail_topics: ['lining', 'customization', 'thread'],
  },
  {
    id: 'SLING_BAG',
    label: 'Sling / shoulder bag',
    category: 'bespoke_bag',
    family: 'BAG',
    detect: /sling|selempang|crossbody|shoulder bag/i,
    vision_cue: 'Medium bag with a single adjustable shoulder strap, usually with a front flap.',
    default_dimensions: { length: 30, width: 10, height: 22 },
    default_pockets: { exterior_pockets: 0 },
    detail_topics: ['strap', 'lining', 'customization', 'thread'],
  },
  {
    id: 'CLUTCH',
    label: 'Clutch',
    category: 'bespoke_bag',
    family: 'BAG',
    detect: /clutch|pouch/i,
    vision_cue: 'Small handheld flat bag with no straps.',
    default_dimensions: { length: 25, width: 4, height: 16 },
    default_pockets: {},
    detail_topics: ['lining', 'customization'],
  },
  {
    id: 'DERBY_SHOES',
    label: 'Derby shoes',
    category: 'bespoke_shoes',
    family: 'SHOE',
    detect: /derby/i,
    vision_cue: 'Lace-up shoe with open lacing (quarters sewn on top of the vamp).',
    default_dimensions: { length: 28, width: 10, height: 12 },
    default_pockets: {},
    detail_topics: ['lining', 'customization'],
  },
  {
    id: 'OXFORD_SHOES',
    label: 'Oxford shoes',
    category: 'bespoke_shoes',
    family: 'SHOE',
    detect: /oxford/i,
    vision_cue: 'Lace-up shoe with closed lacing (quarters sewn under the vamp).',
    default_dimensions: { length: 28, width: 10, height: 12 },
    default_pockets: {},
    detail_topics: ['lining', 'customization'],
  },
  {
    id: 'LOAFERS',
    label: 'Loafers',
    category: 'bespoke_shoes',
    family: 'SHOE',
    detect: /loafer/i,
    vision_cue: 'Slip-on shoe with no laces.',
    default_dimensions: { length: 28, width: 10, height: 11 },
    default_pockets: {},
    detail_topics: ['lining', 'customization'],
  },
  {
    id: 'CHELSEA_BOOTS',
    label: 'Chelsea boots',
    category: 'bespoke_shoes',
    family: 'SHOE',
    detect: /chelsea|boots?\b|sepatu boot/i,
    vision_cue: 'Ankle boot with elastic side gussets and a pull tab.',
    default_dimensions: { length: 28, width: 10, height: 20 },
    default_pockets: {},
    detail_topics: ['lining', 'customization'],
  },
  {
    id: 'OTHER_CUSTOM',
    label: 'Other / custom (crafter to interpret)',
    category: 'bespoke_bag',
    family: 'OTHER',
    detect: /(?!)/, // never auto-detected
    vision_cue: 'Anything that fits none of the above.',
    default_dimensions: { length: 30, width: 12, height: 22 },
    default_pockets: {},
    detail_topics: ['lining', 'customization'],
  },
];

const BY_ID = new Map<ConstructionType, ConstructionDef>(CONSTRUCTIONS.map((c) => [c.id, c]));

const FALLBACK_DEF: ConstructionDef = {
  ...CONSTRUCTIONS[CONSTRUCTIONS.length - 1],
  id: 'UNSPECIFIED',
  label: 'Not yet identified',
  detail_topics: [],
};

export function getConstruction(id: ConstructionType): ConstructionDef {
  return BY_ID.get(id) ?? FALLBACK_DEF;
}

/** Construction types offered for a given craft category (dashboard dropdown). */
export function constructionsFor(category: CraftCategory): ConstructionDef[] {
  return CONSTRUCTIONS.filter((c) => c.category === category);
}

export const CONSTRUCTION_IDS = CONSTRUCTIONS.map((c) => c.id) as ConstructionType[];

/** First matching construction type in free text, or undefined. */
export function detectConstruction(text: string): ConstructionDef | undefined {
  return CONSTRUCTIONS.find((c) => c.detect.test(text));
}

/** The vision-model briefing that separates look-alike form factors. */
export function visionGuide(): string {
  return CONSTRUCTIONS.filter((c) => c.id !== 'OTHER_CUSTOM')
    .map((c) => `- ${c.id}: ${c.vision_cue}`)
    .join('\n');
}

export const EDGE_LABEL: Record<Exclude<EdgeTreatment, 'UNSPECIFIED'>, string> = {
  BURNISHED: 'Burnished edge',
  EDGE_PAINT: 'Painted edge',
  RAW: 'Raw / clean-cut edge',
  TURNED_EDGE: 'Turned edge',
};

// ---------------------------------------------------------------------------
// Blank / normalised specification
// ---------------------------------------------------------------------------

export function emptyPockets(): PocketLayout {
  return {
    front_slots: 0,
    back_slots: 0,
    central_pockets: 0,
    cash_compartments: 0,
    id_window: false,
    coin_zip_pocket: false,
    interior_zip_pockets: 0,
    exterior_pockets: 0,
  };
}

export function emptySpecifications(): Specifications {
  return {
    silhouette: '',
    target_capacity: '',
    dimensions_cm: { length: 0, width: 0, height: 0 },
    exterior_leather: '',
    lining_material: '',
    structure_temper: '',
    stitching_method: '',
    edge_finish: '',
    construction_type: 'UNSPECIFIED',
    pocket_layout: emptyPockets(),
    finish: {
      edge_treatment: 'UNSPECIFIED',
      surface_finish: '',
      color_finish: '',
      thread_color: '',
      thread_material: '',
      stitch_pattern: '',
      zipper: '',
      strap: '',
      hardware_notes: '',
    },
    customization: { type: 'UNSPECIFIED', detail: '', placement: '' },
  };
}

/** Fill any missing (older / partial) fields so downstream code can rely on the full shape. */
export function normalizeSpecifications(spec: Partial<Specifications> | undefined): Specifications {
  const base = emptySpecifications();
  if (!spec) return base;
  return {
    ...base,
    ...spec,
    dimensions_cm: { ...base.dimensions_cm, ...spec.dimensions_cm },
    pocket_layout: { ...base.pocket_layout, ...spec.pocket_layout },
    finish: { ...base.finish, ...spec.finish },
    customization: { ...base.customization, ...spec.customization },
  };
}

/** Total pockets / slots the client asked for. */
export function totalSlots(p: PocketLayout): number {
  return p.front_slots + p.back_slots + p.central_pockets + p.cash_compartments;
}

// ---------------------------------------------------------------------------
// Requirement-gathering checklist
// ---------------------------------------------------------------------------

interface TopicDef {
  required: boolean;
  isFilled: (s: Specifications) => boolean;
  /** Indonesian question fragment: used verbatim by the offline replier and as guidance for Gemini. */
  ask: string;
}

export const TOPICS: Record<TopicId, TopicDef> = {
  construction: {
    required: true,
    isFilled: (s) => s.construction_type !== 'UNSPECIFIED',
    ask: 'model/bentuk yang diinginkan (mis. dompet kartu pipih satu panel, bifold, sling bag, tote, derby)',
  },
  dimensions: {
    required: true,
    isFilled: (s) => s.dimensions_cm.length > 0 && s.dimensions_cm.height > 0,
    ask: 'ukuran perkiraan (P x L x T dalam cm), atau mau muat barang apa (mis. laptop 14 inch)',
  },
  leather: {
    required: true,
    isFilled: (s) => s.exterior_leather.trim() !== '',
    ask: 'jenis & warna kulit (mis. Veg-Tan coklat 1.6mm, Epsom hitam, Pull-Up)',
  },
  card_layout: {
    required: true,
    isFilled: (s) => totalSlots(s.pocket_layout) > 0,
    ask: 'jumlah slot kartu dan tempat uang/selipan (mis. 4 kartu + 1 kantong tengah untuk uang)',
  },
  customization: {
    required: false,
    isFilled: (s) => s.customization.type !== 'UNSPECIFIED',
    ask: 'apakah mau emboss inisial/logo atau ukiran laser (kalau iya, tulisan/motif dan posisinya)',
  },
  thread: {
    required: false,
    isFilled: (s) => s.finish.thread_color.trim() !== '' || s.finish.thread_material.trim() !== '',
    ask: 'warna & jenis benang jahitan (mis. benang linen hitam, saddle stitch)',
  },
  lining: {
    required: false,
    isFilled: (s) => s.lining_material.trim() !== '',
    ask: 'bahan lining bagian dalam (mis. suede, kulit, kanvas) atau tanpa lining',
  },
  edge: {
    required: false,
    isFilled: (s) => s.finish.edge_treatment !== 'UNSPECIFIED' || s.edge_finish.trim() !== '',
    ask: 'finishing pinggiran kulit: burnished (polos, vintage), edge paint (dicat), atau raw',
  },
  zipper: {
    required: false,
    isFilled: (s) => s.finish.zipper.trim() !== '',
    ask: 'tipe & warna sleting (mis. YKK Excella gold atau silver)',
  },
  strap: {
    required: false,
    isFilled: (s) => s.finish.strap.trim() !== '',
    ask: 'tali/strap: full kulit atau kombinasi webbing, lepas-pasang atau permanen',
  },
  hardware: {
    required: false,
    isFilled: (s) => s.finish.hardware_notes.trim() !== '',
    ask: 'hardware yang diinginkan (mis. solid brass, nikel, gold) dan apakah perlu penguat/reinforcement',
  },
};

/** How many checklist topics are filled; the orchestrator compares this across turns to detect a stalled conversation. */
export function filledTopicCount(spec: Specifications): number {
  return (Object.keys(TOPICS) as TopicId[]).filter((t) => TOPICS[t].isFilled(spec)).length;
}

export const MAX_QUESTIONS_PER_TURN = 2;

export function requiredTopics(spec: Specifications): TopicId[] {
  const family = getConstruction(spec.construction_type).family;
  const needsSlots = family === 'CARD_HOLDER' || family === 'WALLET' || family === 'ZIP_WALLET';
  return ['construction', 'dimensions', 'leather', ...(needsSlots ? (['card_layout'] as TopicId[]) : [])];
}

export interface ConversationPlan {
  /** Required topics still empty. */
  missing_required: TopicId[];
  /** Optional topics not yet filled and never asked. */
  pending_details: TopicId[];
  /** Topics to ask in the next bubble (≤ MAX_QUESTIONS_PER_TURN), required first. */
  ask: TopicId[];
  /** True when the spec card can be locked and the draft quotation built. */
  ready: boolean;
}

/**
 * Decide what the AI says next. Required topics come first; remaining slots in the bubble go to
 * optional detail topics (embossing, thread, lining, ...), each asked at most once. The spec is
 * ready when every required topic is filled and either no detail topics are left or the client
 * said they have nothing more to add.
 */
export function planConversation(spec: Specifications, progress: IntakeProgress | undefined, clientFinished: boolean): ConversationPlan {
  const asked = new Set(progress?.asked_topics ?? []);
  const missing_required = requiredTopics(spec).filter((t) => !TOPICS[t].isFilled(spec));
  const pending_details = getConstruction(spec.construction_type).detail_topics.filter(
    (t) => !TOPICS[t].isFilled(spec) && !asked.has(t),
  );

  const ask: TopicId[] = missing_required.slice(0, MAX_QUESTIONS_PER_TURN);
  if (!clientFinished) {
    for (const t of pending_details) {
      if (ask.length >= MAX_QUESTIONS_PER_TURN) break;
      ask.push(t);
    }
  }
  const ready = missing_required.length === 0 && (clientFinished || pending_details.length === 0);
  return { missing_required, pending_details, ask: ready ? [] : ask, ready };
}

/** Offline reply: acknowledge, then ask the planned topics. */
export function templateQuestion(clientName: string, topics: TopicId[], isFirstTurn: boolean): string {
  const bullets = topics.map((t, i) => `${topics.length > 1 ? `${i + 1}. ` : ''}${TOPICS[t].ask}`).join('\n');
  const opener = isFirstTurn
    ? `Halo kak ${clientName}! 🙏 Terima kasih sudah menghubungi kami. Supaya desainnya pas, boleh dibantu info:`
    : `Siap kak ${clientName}, sudah kami catat ya 👍 Selanjutnya, boleh info:`;
  return `${opener}\n${bullets}`;
}
