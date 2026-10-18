import { emptySpecifications, normalizeSpecifications } from '@/lib/spec/catalog';
import { angleDef, LEGACY_ANGLE } from '@/lib/spec/angles';
import type { CraftCategory, CraftFamily, MockupAngle, MockupRender, OrderPayload } from '@/lib/types';
import { newId, nowIso } from '@/lib/utils/format';
import { craftFamilyOf, DEFAULT_CRAFTER_ID } from '@/lib/workspaces';

export { DEFAULT_CRAFTER_ID };

/**
 * New draft in a crafter workspace. The product is unknown until the intake agent classifies it, so the spec starts as
 * the CUSTOM_GENERIC placeholder with construction_type UNSPECIFIED ("unclassified"); `family` is the workspace's main
 * trade until then.
 */
export function createDraftOrder(
  phone: string,
  clientName: string,
  category: CraftCategory = 'CUSTOM_GENERIC',
  workspace: { crafterId?: string; family?: CraftFamily } = {},
): OrderPayload {
  return {
    order_id: newId('ORD'),
    created_at: nowIso(),
    crafter_id: workspace.crafterId ?? DEFAULT_CRAFTER_ID,
    client_info: { phone_number: phone, client_name_wa: clientName },
    session_state: 'IDLE',
    automation_mode: 'AI_COPILOT',
    craft_category: category,
    craft_family: craftFamilyOf(category, workspace.family),
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
 * Firestore (`ignoreUndefinedProperties`) can drop a map whose fields were all undefined (a fresh draft's `media_assets`),
 * so every top-level map is defaulted before it is read.
 */
export function normalizeOrder(stored: OrderPayload): OrderPayload {
  const blank = createDraftOrder(stored.client_info?.phone_number ?? '', stored.client_info?.client_name_wa ?? '');
  // the sqft default is left out so a legacy `estimated_leather_sqft` still migrates below
  const { estimated_material_sqft: _sqft, ...blankBom } = blank.pattern_and_bom;
  void _sqft;
  const order: OrderPayload = {
    ...stored,
    client_info: { ...blank.client_info, ...stored.client_info },
    material_sourcing: { ...blank.material_sourcing, ...stored.material_sourcing },
    pattern_and_bom: { ...blankBom, ...stored.pattern_and_bom } as OrderPayload['pattern_and_bom'],
    media_assets: stored.media_assets ?? {},
  };
  const specifications = normalizeSpecifications(order.specifications, order.craft_category as string);
  const bom = order.pattern_and_bom as OrderPayload['pattern_and_bom'] & { estimated_leather_sqft?: number };
  const { estimated_leather_sqft, ...rest } = bom;
  return {
    ...order,
    crafter_id: order.crafter_id || DEFAULT_CRAFTER_ID,
    craft_category: specifications.category,
    // an unclassified order keeps the family it was created in (orders stored before workspaces default to LEATHER)
    craft_family: craftFamilyOf(specifications.category, order.craft_family ?? 'LEATHER'),
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
