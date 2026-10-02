import { emptySpecifications, normalizeSpecifications } from '@/lib/spec/catalog';
import { angleDef, LEGACY_ANGLE } from '@/lib/spec/angles';
import type { CraftCategory, MockupAngle, MockupRender, OrderPayload } from '@/lib/types';
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
    media_assets: normalizeMedia(order, specifications),
  };
}

/** Bring mockup data to the slot model: legacy angle ids are mapped to ANGLE_1..3 and the single legacy mockup becomes ANGLE_1. */
function normalizeMedia(order: OrderPayload, spec: OrderPayload['specifications']): OrderPayload['media_assets'] {
  const m = order.media_assets;
  const slot = (a: string) => (LEGACY_ANGLE[a] ?? a) as MockupAngle;
  const renders: MockupRender[] | undefined = m.mockup_angles
    ? m.mockup_angles.map((r) => {
        const angle = slot(r.angle);
        return { ...r, angle, view: r.view ?? angleDef(spec.category, angle, spec.construction_type).view };
      })
    : m.ai_generated_mockup_url
      ? [
          {
            angle: 'ANGLE_1',
            view: angleDef(spec.category, 'ANGLE_1', spec.construction_type).view,
            url: m.ai_generated_mockup_url,
            engine: m.mockup_engine ?? 'offline-svg',
            created_at: order.created_at,
          },
        ]
      : undefined;
  return { ...m, mockup_angles: renders, approved_angles: m.approved_angles?.map(slot) };
}

/** Orders that are still negotiable; APPROVED orders start a fresh draft on the next inbound message. */
export function isOpenOrder(order: OrderPayload): boolean {
  return order.session_state !== 'APPROVED';
}
