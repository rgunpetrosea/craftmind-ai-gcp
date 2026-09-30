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

export interface Specifications {
  silhouette: string;
  target_capacity: string;
  dimensions_cm: Dimensions;
  exterior_leather: string;
  lining_material: string;
  structure_temper: string;
  stitching_method: string;
  edge_finish: string;
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

export interface MediaAssets {
  original_sketch_url?: string;
  ai_generated_mockup_url?: string;
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
  missing_fields: string[];
  /** 0..1 self-reported confidence that the client's intent is understood. */
  confidence: number;
  reply_to_client: string;
}

export interface OrchestratorResult {
  order: OrderPayload;
  stage: 'GATHERING' | 'QUOTED' | 'ESCALATED' | 'SKIPPED_TAKEOVER';
  reply?: string;
}
