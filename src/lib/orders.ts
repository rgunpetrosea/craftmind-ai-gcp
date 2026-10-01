import { emptySpecifications, normalizeSpecifications } from '@/lib/spec/catalog';
import type { CraftCategory, OrderPayload } from '@/lib/types';
import { newId, nowIso } from '@/lib/utils/format';

export const DEFAULT_CRAFTER_ID = process.env.CRAFTER_ID ?? 'crafter-demo-01';

/**
 * New draft. The product is unknown until the intake agent classifies it, so the spec starts as the CUSTOM_GENERIC
 * placeholder with construction_type UNSPECIFIED ("unclassified").
 */
export function createDraftOrder(phone: string, clientName: string, category: CraftCategory = 'CUSTOM_GENERIC'): OrderPayload {
  return {
    order_id: newId('ORD'),
    created_at: nowIso(),
    crafter_id: DEFAULT_CRAFTER_ID,
    client_info: { phone_number: phone, client_name_wa: clientName },
    session_state: 'IDLE',
    automation_mode: 'AI_COPILOT',
    craft_category: category,
    specifications: emptySpecifications(category),
    material_sourcing: { status: 'IN_STOCK', sourcing_fee_idr: 0, additional_lead_days: 0 },
    pattern_and_bom: {
      components_breakdown: [],
      estimated_material_sqft: 0,
      hardware_list: [],
      estimated_labor_hours: 0,
      suggested_quotation_idr: 0,
    },
    media_assets: {},
  };
}

/**
 * Bring a stored order to the current schema: the spec is normalized to its category (legacy flat specs are migrated),
 * `craft_category` always mirrors `specifications.category`, and the old `estimated_leather_sqft` is renamed.
 */
export function normalizeOrder(order: OrderPayload): OrderPayload {
  const specifications = normalizeSpecifications(order.specifications, order.craft_category as string);
  const bom = order.pattern_and_bom as OrderPayload['pattern_and_bom'] & { estimated_leather_sqft?: number };
  const { estimated_leather_sqft, ...rest } = bom;
  return {
    ...order,
    craft_category: specifications.category,
    specifications,
    pattern_and_bom: { ...rest, estimated_material_sqft: rest.estimated_material_sqft ?? estimated_leather_sqft ?? 0 },
    intake: order.intake ? { ...order.intake, deferred_topics: order.intake.deferred_topics ?? [] } : undefined,
  };
}

/** Orders that are still negotiable; APPROVED orders start a fresh draft on the next inbound message. */
export function isOpenOrder(order: OrderPayload): boolean {
  return order.session_state !== 'APPROVED';
}
