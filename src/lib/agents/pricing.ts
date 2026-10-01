import { matchInventory } from '@/lib/agents/inventory-agent';
import { primaryMaterial } from '@/lib/spec/describe';
import type { CategoryPreset, EmbossingType, InventoryItem, MaterialSourcing, PatternAndBom, Specifications } from '@/lib/types';

export interface QuotationBreakdown {
  material_idr: number;
  hardware_idr: number;
  labor_idr: number;
  sourcing_idr: number;
  personalization_idr: number;
  /** Sum of crafter-assigned surcharges on custom fields. */
  custom_requests_idr: number;
  subtotal_idr: number;
  margin_idr: number;
  total_idr: number;
}

/** Tooling / setup fee for personalization (labor time is added separately by the pattern agent). */
const PERSONALIZATION_FEE_IDR: Record<EmbossingType, number> = {
  UNSPECIFIED: 0,
  NONE: 0,
  EMBOSS_INITIALS: 50_000,
  EMBOSS_LOGO: 100_000,
  LASER_ENGRAVING: 150_000,
};

function personalizationFee(spec?: Specifications): number {
  const type = (spec?.attributes as { embossing_type?: EmbossingType } | undefined)?.embossing_type;
  return type ? PERSONALIZATION_FEE_IDR[type] : 0;
}

/** Hardware lines may carry a quantity suffix such as "Brass rivets x4". */
function hardwareUnits(list: string[]): number {
  return list.reduce((sum, item) => sum + Number(/x\s*(\d+)\s*$/i.exec(item)?.[1] ?? 1), 0);
}

export function computeQuotation(
  bom: Omit<PatternAndBom, 'suggested_quotation_idr'>,
  sourcing: MaterialSourcing,
  materialPricePerSqft: number,
  preset: CategoryPreset,
  spec?: Specifications,
): QuotationBreakdown {
  const material_idr = Math.round(bom.estimated_material_sqft * materialPricePerSqft);
  const hardware_idr = hardwareUnits(bom.hardware_list) * preset.hardware_cost_idr_per_item;
  const labor_idr = Math.round(bom.estimated_labor_hours * preset.labor_rate_idr_per_hour);
  const sourcing_idr = sourcing.sourcing_fee_idr;
  const personalization_idr = personalizationFee(spec);
  const custom_requests_idr = (spec?.custom_fields ?? []).reduce((s, f) => s + (Number(f.surcharge_idr) || 0), 0);
  const subtotal_idr = material_idr + hardware_idr + labor_idr + sourcing_idr + personalization_idr + custom_requests_idr;
  const margin_idr = Math.round(subtotal_idr * preset.margin_pct);
  // Round up to the nearest Rp 10.000 for a clean client-facing number.
  const total_idr = Math.ceil((subtotal_idr + margin_idr) / 10_000) * 10_000;
  return { material_idr, hardware_idr, labor_idr, sourcing_idr, personalization_idr, custom_requests_idr, subtotal_idr, margin_idr, total_idr };
}

/** Pattern draft → stock match → priced BOM, as stored on the order. */
export function assembleQuote(
  draft: Omit<PatternAndBom, 'suggested_quotation_idr'>,
  spec: Specifications,
  inventory: InventoryItem[],
  preset: CategoryPreset,
): { material_sourcing: MaterialSourcing; pattern_and_bom: PatternAndBom; breakdown: QuotationBreakdown } {
  const match = matchInventory(primaryMaterial(spec), draft.estimated_material_sqft, inventory, preset);
  const breakdown = computeQuotation(draft, match.sourcing, match.price_idr_per_sqft, preset, spec);
  return {
    material_sourcing: match.sourcing,
    pattern_and_bom: { ...draft, suggested_quotation_idr: breakdown.total_idr },
    breakdown,
  };
}
