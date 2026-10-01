// ---------------------------------------------------------------------------
// Core order contract (mirrors CLAUDE.md "System Interfaces")
// ---------------------------------------------------------------------------

export type SessionState = 'IDLE' | 'REQUIREMENT_GATHERING' | 'PENDING_CRAFTER_APPROVAL' | 'APPROVED';
export type AutomationMode = 'AI_COPILOT' | 'PARTIAL_PAUSE' | 'FULL_MANUAL';
export type EscalationReason = 'CLIENT_REQUEST' | 'CONFUSION_RULE' | 'CRAFTER_OVERRIDE';
export type CraftCategory = 'bespoke_bag' | 'bespoke_wallet' | 'bespoke_shoes';
export type SourcingStatus = 'IN_STOCK' | 'SPECIAL_SOURCING_NEEDED';

export interface Dimensions {
  length: number;
  width: number;
  height: number;
}

/**
 * Precise form factor. Distinguishes e.g. a FLAT_CARD_HOLDER (single flat panel, no fold)
 * from BIFOLD / TRIFOLD / ACCORDION wallets. Definitions live in `lib/spec/catalog.ts`.
 */
export type ConstructionType =
  | 'UNSPECIFIED'
  // card holders & wallets
  | 'FLAT_CARD_HOLDER'
  | 'PATTERNED_CARD_HOLDER'
  | 'BIFOLD_WALLET'
  | 'TRIFOLD_WALLET'
  | 'ACCORDION_WALLET'
  | 'ZIP_AROUND_LONG_WALLET'
  // bags
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
  // shoes
  | 'DERBY_SHOES'
  | 'OXFORD_SHOES'
  | 'LOAFERS'
  | 'CHELSEA_BOOTS'
  // anything else the crafter must interpret manually
  | 'OTHER_CUSTOM';

/** Where the cards / cash / zips go. 0 / false = not requested. */
export interface PocketLayout {
  /** Card slots on the front face (flat card holders) or inside-left (wallets). */
  front_slots: number;
  /** Card slots on the back face (flat card holders) or inside-right (wallets). */
  back_slots: number;
  /** Central pocket between front and back slots (cash / folded notes). */
  central_pockets: number;
  /** Full-length cash compartments (bifold / long wallets). */
  cash_compartments: number;
  /** Transparent ID / photo window. */
  id_window: boolean;
  /** Zippered coin pocket. */
  coin_zip_pocket: boolean;
  /** Zippered pockets inside a bag. */
  interior_zip_pockets: number;
  /** Open slip pockets on the outside of a bag (front / back / side). */
  exterior_pockets: number;
}

export type EdgeTreatment = 'UNSPECIFIED' | 'BURNISHED' | 'EDGE_PAINT' | 'RAW' | 'TURNED_EDGE';

/** Leather edge, surface and stitching attributes. Empty string / UNSPECIFIED = not discussed yet. */
export interface FinishDetails {
  edge_treatment: EdgeTreatment;
  /** Surface character, e.g. "matte", "pull-up", "saffiano texture". */
  surface_finish: string;
  /** Color / dye finish, e.g. "biru tosca", "black". */
  color_finish: string;
  thread_color: string;
  /** e.g. "linen", "waxed polyester". */
  thread_material: string;
  /** e.g. "diamond stitch", "saddle stitch". */
  stitch_pattern: string;
  /** e.g. "YKK Excella Gold #5". */
  zipper: string;
  /** Strap choice for bags, e.g. "detachable full-leather strap". */
  strap: string;
  /** Closures / buckles / reinforcement, e.g. "solid brass buckles, salpa 1.2mm". */
  hardware_notes: string;
}

/** UNSPECIFIED = never discussed; NONE = client declined. */
export type CustomizationType = 'UNSPECIFIED' | 'NONE' | 'EMBOSS_INITIALS' | 'EMBOSS_LOGO' | 'LASER_ENGRAVING';

export interface Customization {
  type: CustomizationType;
  /** Text / artwork, e.g. "R.W" or "batik mega mendung". */
  detail: string;
  /** e.g. "bottom-right corner, outside". */
  placement: string;
}

export interface Specifications {
  silhouette: string;
  target_capacity: string;
  dimensions_cm: Dimensions;
  exterior_leather: string;
  lining_material: string;
  structure_temper: string;
  stitching_method: string;
  edge_finish: string;
  construction_type: ConstructionType;
  pocket_layout: PocketLayout;
  finish: FinishDetails;
  customization: Customization;
}

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
  estimated_leather_sqft: number;
  hardware_list: string[];
  estimated_labor_hours: number;
  suggested_quotation_idr: number;
}

export type MockupEngine = 'gemini-image' | 'imagen' | 'offline-svg';

export interface MediaAssets {
  original_sketch_url?: string;
  ai_generated_mockup_url?: string;
  /** Which renderer produced the current mockup (offline-svg ignores free-text feedback). */
  mockup_engine?: MockupEngine;
  /** Crafter feedback applied to the mockup, oldest first. */
  mockup_feedback?: string[];
}

/** Multi-turn requirement-gathering progress, owned by the orchestrator. */
export interface IntakeProgress {
  /** Checklist topics the AI has already asked about (each optional topic is asked at most once). */
  asked_topics: string[];
  /** Topics in the AI's most recent question bubble; used to interpret short answers like "full kulit mas". */
  last_asked: string[];
  /** What the vision model saw in the client's sketch / photo. */
  vision_notes?: string;
  /** Last client message already processed (prevents re-applying "+3 cm" style edits). */
  processed_message_id?: string;
  /** Number of AI gathering questions sent. */
  question_rounds: number;
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
  craft_category: CraftCategory;
  specifications: Specifications;
  material_sourcing: MaterialSourcing;
  pattern_and_bom: PatternAndBom;
  media_assets: MediaAssets;
  intake?: IntakeProgress;
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
  leather_type: string;
  color: string;
  thickness_mm: number;
  available_sqft: number;
  price_idr_per_sqft: number;
  supplier: string;
  origin: 'LOCAL' | 'IMPORT';
}

export interface CategoryPreset {
  category: CraftCategory;
  label: string;
  base_labor_hours: number;
  labor_rate_idr_per_hour: number;
  hardware_cost_idr_per_item: number;
  wastage_pct: number;
  margin_pct: number;
  /** Price assumed for leather that must be special-sourced. */
  sourcing_price_idr_per_sqft: number;
  defaults: Pick<Specifications, 'lining_material' | 'structure_temper' | 'stitching_method' | 'edge_finish'>;
}

// ---------------------------------------------------------------------------
// Agent I/O
// ---------------------------------------------------------------------------

export interface IntakeResult {
  craft_category: CraftCategory;
  specifications: Specifications;
  /** True when the client signalled they have nothing more to add ("itu saja kak"). */
  client_finished: boolean;
  vision_notes?: string;
}

export interface OrchestratorResult {
  order: OrderPayload;
  stage: 'GATHERING' | 'QUOTED' | 'ESCALATED' | 'SKIPPED_TAKEOVER';
  reply?: string;
}
