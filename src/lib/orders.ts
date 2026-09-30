import type { CraftCategory, OrderPayload, Specifications } from '@/lib/types';
import { newId, nowIso } from '@/lib/utils/format';

export const DEFAULT_CRAFTER_ID = process.env.CRAFTER_ID ?? 'crafter-demo-01';

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
  };
}

export function createDraftOrder(phone: string, clientName: string, category: CraftCategory = 'bespoke_bag'): OrderPayload {
  return {
    order_id: newId('ORD'),
    created_at: nowIso(),
    crafter_id: DEFAULT_CRAFTER_ID,
    client_info: { phone_number: phone, client_name_wa: clientName },
    session_state: 'IDLE',
    automation_mode: 'AI_COPILOT',
    craft_category: category,
    specifications: emptySpecifications(),
    material_sourcing: { status: 'IN_STOCK', sourcing_fee_idr: 0, additional_lead_days: 0 },
    pattern_and_bom: {
      components_breakdown: [],
      estimated_leather_sqft: 0,
      hardware_list: [],
      estimated_labor_hours: 0,
      suggested_quotation_idr: 0,
    },
    media_assets: {},
  };
}

/** Orders that are still negotiable; APPROVED orders start a fresh draft on the next inbound message. */
export function isOpenOrder(order: OrderPayload): boolean {
  return order.session_state !== 'APPROVED';
}
