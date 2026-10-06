// ---------------------------------------------------------------------------
// Core order contract (mirrors CLAUDE.md "System Interfaces")
// ---------------------------------------------------------------------------

export type SessionState = 'IDLE' | 'REQUIREMENT_GATHERING' | 'PENDING_CRAFTER_APPROVAL' | 'APPROVED';
export type AutomationMode = 'AI_COPILOT' | 'PARTIAL_PAUSE' | 'FULL_MANUAL';
/** CONFUSION_RULE = loop / unproductive-chat detector; SESSION_LIMIT = AI turn budget for the session was used up. */
/** NON_STANDARD: outside the crafting scope (electronics, certifications...). PRICE_NEGOTIATION: discount far below floor. */
export type EscalationReason = 'CLIENT_REQUEST' | 'CONFUSION_RULE' | 'CRAFTER_OVERRIDE' | 'SESSION_LIMIT' | 'NON_STANDARD' | 'PRICE_NEGOTIATION';
/**
 * Isolated craft categories. Each has its own attribute schema; attributes are never shared or mixed across categories.
 * Field definitions (labels, UI, Gemini schema, parsers) live in `src/lib/spec/categories/*`.
 */
export type CraftCategory = 'SMALL_GOODS' | 'BAG' | 'FOOTWEAR' | 'FURNITURE' | 'CUSTOM_GENERIC';
export type SourcingStatus = 'IN_STOCK' | 'SPECIAL_SOURCING_NEEDED';

export interface Dimensions {
  length: number;
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------
// Form factors per category
// ---------------------------------------------------------------------------

export type SmallGoodsConstruction =
  | 'FLAT_CARD_HOLDER'
  | 'PATTERNED_CARD_HOLDER'
  | 'BIFOLD_WALLET'
  | 'LONG_BIFOLD_WALLET'
  | 'TRIFOLD_WALLET'
  | 'ACCORDION_WALLET'
  | 'ZIP_AROUND_LONG_WALLET'
  | 'PASSPORT_COVER'
  | 'KEY_POUCH'
  | 'OTHER_SMALL_GOODS';

export type BagConstruction =
  | 'SLING_BAG'
  | 'CROSSBODY_CAMERA_BAG'
  | 'MESSENGER_BAG'
  | 'SLOUCHY_TOTE'
  | 'STRUCTURED_TOTE'
  | 'BACKPACK'
  | 'EXECUTIVE_BRIEFCASE'
  | 'PADEL_RACKET_BAG'
  | 'HYBRID_BACKPACK_TOTE'
  | 'CLUTCH'
  | 'TOP_HANDLE_BAG'
  | 'OTHER_BAG';

export type FootwearConstruction = 'DERBY_SHOES' | 'OXFORD_SHOES' | 'LOAFERS' | 'CHELSEA_BOOTS' | 'SANDALS' | 'OTHER_FOOTWEAR';

export type FurnitureConstruction =
  | 'KITCHEN_SET'
  | 'WARDROBE'
  | 'TV_CONSOLE'
  | 'DINING_TABLE'
  | 'COFFEE_TABLE'
  | 'DESK'
  | 'CHAIR'
  | 'STOOL'
  | 'BENCH'
  | 'SHELF'
  | 'CABINET'
  | 'NIGHTSTAND'
  | 'BED_FRAME'
  | 'OTHER_FURNITURE';

export type CustomGenericConstruction = 'BELT' | 'WATCH_STRAP' | 'APPAREL' | 'JEWELRY' | 'SPORTS_GEAR' | 'HOME_DECOR' | 'OTHER_CUSTOM';

export interface ConstructionByCategory {
  SMALL_GOODS: SmallGoodsConstruction;
  BAG: BagConstruction;
  FOOTWEAR: FootwearConstruction;
  FURNITURE: FurnitureConstruction;
  CUSTOM_GENERIC: CustomGenericConstruction;
}

/** 'UNSPECIFIED' = not identified yet (the order is still unclassified). */
export type ConstructionType = 'UNSPECIFIED' | ConstructionByCategory[CraftCategory];

// ---------------------------------------------------------------------------
// Shared enums (each category opts in to the ones it uses)
// 'UNSPECIFIED' is the unset value of every enum.
// ---------------------------------------------------------------------------

export type EmbossingType = 'UNSPECIFIED' | 'NONE' | 'EMBOSS_INITIALS' | 'EMBOSS_LOGO' | 'LASER_ENGRAVING';
export type LeatherEdgeFinish = 'UNSPECIFIED' | 'BURNISHED' | 'EDGE_PAINT' | 'RAW' | 'TURNED_EDGE';

// ---------------------------------------------------------------------------
// Category attribute schemas. Unset values: '' / 0 / false / 'UNSPECIFIED' / {0,0,0}.
// ---------------------------------------------------------------------------

/** Wallets, card holders and other small leather goods. No straps, laptop size or bag hardware. */
export interface SmallGoodsAttributes {
  dimensions_cm: Dimensions;
  exterior_leather: string;
  color: string;
  front_slots: number;
  back_slots: number;
  central_pockets: number;
  cash_compartments: number;
  id_window: boolean;
  coin_zip_pocket: boolean;
  /** Only relevant for zip-around wallets / coin zip pockets. */
  zipper: string;
  lining: string;
  edge_finish: LeatherEdgeFinish;
  stitching_method: string;
  stitch_pattern: string;
  thread_material: string;
  thread_color: string;
  embossing_type: EmbossingType;
  embossing_text: string;
  embossing_placement: string;
}

export type BagStructure = 'UNSPECIFIED' | 'RIGID' | 'SEMI_STRUCTURED' | 'SOFT';
export type BagClosure = 'UNSPECIFIED' | 'MAGNETIC_FLAP' | 'TURN_LOCK_FLAP' | 'BUCKLE_FLAP' | 'ZIPPER' | 'DRAWSTRING' | 'OPEN_TOP';
export type BagStrap =
  | 'UNSPECIFIED'
  | 'NONE'
  | 'TOP_HANDLE_ONLY'
  | 'FIXED_LEATHER'
  | 'DETACHABLE_LEATHER'
  | 'WEBBING'
  | 'BACKPACK_STRAPS'
  | 'CONVERTIBLE';

/** Bags of every kind. No card slots. */
export interface BagAttributes {
  dimensions_cm: Dimensions;
  /** Depth of the side gusset when it differs from the body width. */
  gusset_depth_cm: number;
  laptop_size_inch: number;
  target_capacity: string;
  exterior_leather: string;
  color: string;
  structure: BagStructure;
  main_closure: BagClosure;
  strap_type: BagStrap;
  hardware: string;
  interior_zip_pockets: number;
  exterior_pockets: number;
  lining: string;
  padding: string;
  edge_finish: LeatherEdgeFinish;
  stitching_method: string;
  thread_color: string;
  embossing_type: EmbossingType;
  embossing_text: string;
  embossing_placement: string;
}

export type LastShape = 'UNSPECIFIED' | 'ROUND' | 'ALMOND' | 'CHISEL' | 'SQUARE' | 'POINTED';
export type WidthFit = 'UNSPECIFIED' | 'NARROW' | 'REGULAR' | 'WIDE';
export type OutsoleType = 'UNSPECIFIED' | 'LEATHER' | 'RUBBER' | 'DAINITE' | 'CREPE' | 'COMMANDO_LUG';
export type WeltMethod = 'UNSPECIFIED' | 'GOODYEAR' | 'BLAKE' | 'STITCHDOWN' | 'CEMENTED';

export interface FootwearAttributes {
  eu_size: number;
  width_fit: WidthFit;
  last_shape: LastShape;
  upper_material: string;
  color: string;
  toe_style: string;
  lining: string;
  outsole_type: OutsoleType;
  welt_method: WeltMethod;
  heel_height_cm: number;
}

export type FurnitureFinish = 'UNSPECIFIED' | 'NATURAL_OIL' | 'WAX' | 'WATER_BASED_LACQUER' | 'PU_VARNISH' | 'DUCO_PAINT' | 'POWDER_COAT' | 'HPL' | 'MELAMIC';
/** Hinges and drawer rails of built-in cabinetry. */
export type FurnitureHardware = 'UNSPECIFIED' | 'STANDARD' | 'SOFT_CLOSE' | 'PREMIUM_SOFT_CLOSE';
/** Kitchen run layout. */
export type KitchenLayout = 'UNSPECIFIED' | 'STRAIGHT' | 'L_SHAPE' | 'U_SHAPE' | 'GALLEY';
export type JoineryType =
  | 'UNSPECIFIED'
  | 'MORTISE_TENON'
  | 'DOVETAIL'
  | 'DOWEL'
  | 'FINGER_JOINT'
  | 'POCKET_SCREW'
  | 'KNOCK_DOWN_FITTINGS'
  | 'WELDED';
export type FurnitureAssembly = 'UNSPECIFIED' | 'ASSEMBLED' | 'KNOCK_DOWN';

export interface FurnitureAttributes {
  dimensions_cm: Dimensions;
  /** Wood or metal species/type, e.g. "Jati (teak) grade A", "besi hollow". */
  primary_material: string;
  secondary_material: string;
  finish_coating: FurnitureFinish;
  color_stain: string;
  joinery_type: JoineryType;
  upholstery: string;
  seating_capacity: number;
  assembly: FurnitureAssembly;
  /** Built-ins: hinges & drawer rails grade. */
  hardware_fittings: FurnitureHardware;
  /** Kitchen sets: countertop / top table, material + stone or colour as said: "Granite (Nero Marquina)". */
  countertop: string;
  /** Built-ins: cabinetry runs floor to ceiling ("sampai plafon"), no top gap. */
  floor_to_ceiling: boolean;
  /** Built-ins: appliances the cabinetry houses, e.g. "kulkas 2 pintu, kompor tanam". */
  appliances: string;
  /** Kitchen sets: run layout; dimensions_cm.length is the main wall (L1). */
  layout_shape: KitchenLayout;
  /** Kitchen sets: second wall run (L2) of an L / U / galley layout, cm. */
  second_wall_cm: number;
  /** Built-ins: where things are in the room ("jendela di pojok kiri, kulkas di kanan"), the client's words. */
  layout_notes: string;
}

/** Fallback for any other bespoke craft (apparel, jewelry, sports gear...): a few universal fields + custom fields. */
export interface CustomGenericAttributes {
  dimensions_cm: Dimensions;
  primary_material: string;
  color: string;
  intended_use: string;
  quantity: number;
}

export interface AttributesByCategory {
  SMALL_GOODS: SmallGoodsAttributes;
  BAG: BagAttributes;
  FOOTWEAR: FootwearAttributes;
  FURNITURE: FurnitureAttributes;
  CUSTOM_GENERIC: CustomGenericAttributes;
}

export type AttributeValue = string | number | boolean | Dimensions;

/**
 * How the size was established.
 *  EXACT_CM            the client (or crafter) gave centimetres.
 *  REFERENCE_BASED     inferred from a named reference: an iconic model ("Hermès Birkin 30") or an object the item must
 *                      hold ("iPad Air 11 inch", "laptop 14 inch"); `reference_object` names it.
 *  PENDING_SITE_VISIT  the piece must fit a physical space and needs an on-site measurement; dimensions are provisional.
 *  UNSPECIFIED         size not discussed yet.
 */
export type DimensionMode = 'UNSPECIFIED' | 'EXACT_CM' | 'REFERENCE_BASED' | 'PENDING_SITE_VISIT';

/** Free key-value detail for requests no schema field covers (added by the AI or by the crafter). */
export interface CustomField {
  id: string;
  label: string;
  value: string;
  /** Price impact; added to the quotation. A negative value is a discount, taken off after the margin. */
  surcharge_idr: number;
  source: 'AI' | 'CRAFTER';
  /** ADD_ON: catalog accessory (LED strip, pop-up socket, magic corner...); DISCOUNT: price reduction / freebie. */
  kind?: 'ADD_ON' | 'DISCOUNT';
}

interface SpecOf<C extends CraftCategory> {
  category: C;
  construction_type: ConstructionByCategory[C] | 'UNSPECIFIED';
  /** Client-facing product name, e.g. "Dompet kartu pipih" or "Meja makan 6 kursi". */
  model_name: string;
  notes: string;
  dimension_mode: DimensionMode;
  /** The reference the size was inferred from (REFERENCE_BASED), e.g. "Hermès Birkin 30"; '' otherwise. */
  reference_object: string;
  attributes: AttributesByCategory[C];
  custom_fields: CustomField[];
}

export type SmallGoodsSpec = SpecOf<'SMALL_GOODS'>;
export type BagSpec = SpecOf<'BAG'>;
export type FootwearSpec = SpecOf<'FOOTWEAR'>;
export type FurnitureSpec = SpecOf<'FURNITURE'>;
export type CustomGenericSpec = SpecOf<'CUSTOM_GENERIC'>;

/** Discriminated by `category`; narrow with `spec.category === 'BAG'` before reading typed attributes. */
export type Specifications = SmallGoodsSpec | BagSpec | FootwearSpec | FurnitureSpec | CustomGenericSpec;

export interface MaterialSourcing {
  status: SourcingStatus;
  allocated_stock_id?: string;
  sourcing_fee_idr: number;
  additional_lead_days: number;
}

export interface BomComponent {
  part_name: string;
  qty: number;
  dimensions_cm: string;
}

export interface PatternAndBom {
  components_breakdown: BomComponent[];
  /** Primary material incl. wastage: leather hide sqft, or wood board-surface sqft for furniture. */
  estimated_material_sqft: number;
  hardware_list: string[];
  estimated_labor_hours: number;
  suggested_quotation_idr: number;
}

export type MockupEngine = 'gemini-image' | 'imagen' | 'offline-svg';

/**
 * Slots of the 3-angle studio mockup set. What each slot shows (its "view") is chosen per craft category in
 * `src/lib/spec/angles.ts`, e.g. ANGLE_2 is the open interior of a wallet but the side profile of a bag.
 */
export type MockupAngle = 'ANGLE_1' | 'ANGLE_2' | 'ANGLE_3';

export interface MockupRender {
  angle: MockupAngle;
  /** Category view rendered in this slot, e.g. "CLOSED_EXTERIOR", "SIDE_PROFILE", or "CUSTOM" for a crafter prompt. */
  view: string;
  url: string;
  engine: MockupEngine;
  created_at: string;
  /** Why this render fell back to the offline concept, if it did. */
  error?: string;
  /** Crafter's custom shot direction used for this render, if any. */
  custom_prompt?: string;
  /** Crafter feedback applied to this angle, oldest first. */
  feedback?: string[];
  /** `mockupSignature()` of the finalized spec this render shows: equal → the render is still current, reuse it. */
  signature?: string;
}

export interface MediaAssets {
  original_sketch_url?: string;
  ai_generated_mockup_url?: string;
  /** Which renderer produced the current mockup (offline-svg ignores free-text feedback). */
  mockup_engine?: MockupEngine;
  /** Crafter feedback applied to the mockup, oldest first. */
  mockup_feedback?: string[];
  /** Why the last render fell back to the offline concept (quota, billing, API error). */
  mockup_error?: string;
  /** Multi-angle set (EXTERIOR_CLOSED mirrors ai_generated_mockup_url / mockup_engine / mockup_error). */
  mockup_angles?: MockupRender[];
  /** Angles the crafter sent to the client with the formal quotation. */
  approved_angles?: MockupAngle[];
  /** Dashboard-triggered render requests on this order (cost safety cap, see MAX_CRAFTER_RENDERS_PER_ORDER). */
  crafter_render_count?: number;
  /** Crafter's saved custom shot direction per angle slot (overrides the category default until cleared). */
  angle_prompts?: Partial<Record<MockupAngle, string>>;
}

/**
 * Lifestyle-level brief the intake assistant keeps in the background (never shown to the client). Filled from client AND
 * crafter messages, including while a human has taken over. Free text in the client's own terms ('' = unknown).
 */
export interface ClientBrief {
  product_type: string;
  /** What it's for / daily use, e.g. "kerja harian, bawa laptop + charger". */
  usage_context: string;
  /** Size in human terms, e.g. "muat laptop 14 inch", "saku celana depan", "untuk 6 orang". */
  fitment_size: string;
  style_preference: string;
  hardware_requirement: string;
  target_deadline: string;
  budget: string;
}

/** Multi-turn requirement-gathering progress, owned by the orchestrator. Topic keys are "<CATEGORY>:<topic id>". */
export interface IntakeProgress {
  /** Topics the AI has already asked about (each optional topic is asked at most once). */
  asked_topics: string[];
  /** Topics in the AI's most recent question bubble; used to interpret short answers like "full kulit mas". */
  last_asked: string[];
  /** Topics the client left to the workshop ("terserah"); filled from presets when the spec is locked. */
  deferred_topics: string[];
  /** What the vision model saw in the client's sketch / photo. */
  vision_notes?: string;
  /** Last client message already processed (prevents re-applying "+3 cm" style edits). */
  processed_message_id?: string;
  /** Number of AI gathering questions sent. */
  question_rounds: number;
  /** Cost guardrails (per intake session): AI replies sent, AI mockup render rounds, silent background parses. */
  session_turn_count?: number;
  mockup_render_count?: number;
  silent_parse_count?: number;
}

export interface OrderPayload {
  order_id: string;
  created_at: string;
  crafter_id: string;
  client_info: {
    phone_number: string;
    client_name_wa: string;
  };
  session_state: SessionState;
  automation_mode: AutomationMode;
  paused_until?: string; // ISO Timestamp for Partial Takeover
  escalation_reason?: EscalationReason;
  /** Human-readable reason shown to the crafter when the AI handed over (e.g. the non-standard request). */
  escalation_note?: string;
  craft_category: CraftCategory;
  specifications: Specifications;
  material_sourcing: MaterialSourcing;
  pattern_and_bom: PatternAndBom;
  media_assets: MediaAssets;
  intake?: IntakeProgress;
  /** Background brief, see ClientBrief. */
  client_brief?: ClientBrief;
}

// ---------------------------------------------------------------------------
// Conversation / WhatsApp session buffer
// ---------------------------------------------------------------------------

export type MessageSender = 'CLIENT' | 'AI' | 'CRAFTER' | 'SYSTEM';
export type MessageMediaType = 'image' | 'audio';

export interface ChatMessage {
  id: string;
  order_id: string;
  sender: MessageSender;
  text?: string;
  media_type?: MessageMediaType;
  media_url?: string;
  media_mime_type?: string;
  created_at: string;
  /** Set on inbound client messages that arrived while the AI was paused. */
  awaiting_crafter_review?: boolean;
}

export interface Conversation {
  phone_number: string;
  client_name_wa: string;
  active_order_id: string;
  /** Consecutive intake turns where the AI could not make progress. */
  confusion_strikes: number;
  updated_at: string;
}

/** Inbound event accepted by /api/webhook/whatsapp (simulator or WA Cloud API adapter). */
export interface InboundWhatsAppEvent {
  phone_number: string;
  client_name_wa?: string;
  sender?: 'CLIENT' | 'CRAFTER';
  /** Crafter replies from the dashboard target a specific order instead of the phone's active one. */
  order_id?: string;
  text?: string;
  media?: {
    type: MessageMediaType;
    /** data: URL or https/gs URL */
    url: string;
    mime_type: string;
  };
}

export type WebhookAction =
  | 'BUFFERED_FOR_AI'
  | 'ESCALATED_TO_CRAFTER'
  | 'LOGGED_FOR_CRAFTER'
  | 'CRAFTER_REPLY_SENT';

// ---------------------------------------------------------------------------
// Master data
// ---------------------------------------------------------------------------

export interface InventoryItem {
  stock_id: string;
  name: string;
  /** Leather, wood or metal type, e.g. "veg-tan", "teak", "iron". */
  material_type: string;
  color: string;
  thickness_mm: number;
  available_sqft: number;
  price_idr_per_sqft: number;
  supplier: string;
  origin: 'LOCAL' | 'IMPORT';
}

/**
 * The host crafter's profile. Loaded before every intake turn: it brands the greeting and defines the domain boundary
 * (anything outside `allowed_categories` is politely declined). Offering ids are defined in `src/lib/spec/offerings.ts`.
 */
export interface CrafterProfile {
  crafter_id: string;
  workshop_name: string;
  /** Offering ids, e.g. ["wallets", "bags", "belts", "watch_straps"]. */
  allowed_categories: string[];
  /** What the workshop works in, e.g. "genuine leather / leathergoods". */
  primary_material: string;
  contact_whatsapp: string;
  /** The human who takes over handed-off chats, e.g. "Fendy". */
  crafter_name: string;
  /** How clients address them, e.g. "Mas", "Mbak", "Kak" ('' for none). */
  crafter_honorific: string;
}

/** What a client message is, before any spec work. */
export type MessageIntent = 'CRAFT_REQUEST' | 'OFF_TOPIC' | 'PROMPT_INJECTION';

export interface CategoryPreset {
  category: CraftCategory;
  label: string;
  base_labor_hours: number;
  labor_rate_idr_per_hour: number;
  hardware_cost_idr_per_item: number;
  wastage_pct: number;
  margin_pct: number;
  /** Price assumed for primary material that must be special-sourced. */
  sourcing_price_idr_per_sqft: number;
  /** On-site measurement fee charged when dimension_mode is PENDING_SITE_VISIT. */
  site_visit_fee_idr?: number;
  /** House material used when the client only says "kulit" / "kayu" (stock_id of an inventory item). */
  default_stock_id?: string;
  /** Lowest acceptable margin over cost for AI-negotiated prices (default 0.15). */
  floor_margin_pct?: number;
  /** Largest discount the AI may offer on its own, as a share of the quote (default 0.05). */
  max_auto_discount_pct?: number;
  /** Add-on catalog price overrides by add-on id (see spec/addons.ts). */
  addon_prices_idr?: Record<string, number>;
  /** Workshop defaults applied when the client leaves a field open ("terserah"), keyed by attribute name of this category. */
  defaults: Partial<Record<string, string | number | boolean>>;
}

// ---------------------------------------------------------------------------
// Agent I/O
// ---------------------------------------------------------------------------

export interface IntakeResult {
  specifications: Specifications;
  /** True when the client signalled they have nothing more to add ("itu saja kak"). */
  client_finished: boolean;
  /** Topic keys the client deferred to the workshop in this burst. */
  deferred_topics: string[];
  vision_notes?: string;
  /** Questions in the latest client burst that the assistant must answer before moving on. */
  questions: ClientQuestion[];
  /** Set when the request is outside the workshop's standard crafting scope (escalated to the crafter). */
  non_standard_reason?: string;
  /** Brief fields learned this turn (merged into OrderPayload.client_brief). */
  brief: Partial<ClientBrief>;
  /** Topic keys ("<CATEGORY>:<topic>") the client has addressed in any wording, anywhere in the chat. */
  answered_topics: string[];
  /** Guardrail: is the latest burst a crafting request at all? */
  message_intent: MessageIntent;
  /** What the client asked for, in their words, when Gemini judged it outside the workshop (e.g. "meja makan kayu"). */
  out_of_scope_item?: string;
}

/** TERMINOLOGY / DESIGN / OTHER block the spec card until answered; PRICE_TIMELINE is answered by the crafter's quote. */
export type QuestionKind = 'TERMINOLOGY' | 'DESIGN' | 'PRICE_TIMELINE' | 'OTHER';

export interface ClientQuestion {
  text: string;
  kind: QuestionKind;
}

export interface OrchestratorResult {
  order: OrderPayload;
  /** SUPERSEDED: a newer client message arrived mid-run, the reply was dropped. NOTHING_NEW: already answered. */
  stage: 'GATHERING' | 'ANSWERED' | 'QUOTED' | 'NEGOTIATED' | 'ESCALATED' | 'REFUSED' | 'SKIPPED_TAKEOVER' | 'SUPERSEDED' | 'NOTHING_NEW';
  reply?: string;
}
