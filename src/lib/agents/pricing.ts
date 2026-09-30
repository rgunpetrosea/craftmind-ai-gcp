import { matchInventory } from '@/lib/agents/inventory-agent';
import type { CategoryPreset, InventoryItem, MaterialSourcing, PatternAndBom, Specifications } from '@/lib/types';

export interface QuotationBreakdown {
  leather_idr: number;
  hardware_idr: number;
  labor_idr: number;
  sourcing_idr: number;
  subtotal_idr: number;
  margin_idr: number;
  total_idr: number;
}

/** Hardware lines may carry a quantity suffix such as "Brass rivets x4". */
function hardwareUnits(list: string[]): number {
  return list.reduce((sum, item) => sum + Number(/x\s*(\d+)\s*$/i.exec(item)?.[1] ?? 1), 0);
}

export function computeQuotation(
  bom: Omit<PatternAndBom, 'suggested_quotation_idr'>,
  sourcing: MaterialSourcing,
  leatherPricePerSqft: number,
  preset: CategoryPreset,
): QuotationBreakdown {
  const leather_idr = Math.round(bom.estimated_leather_sqft * leatherPricePerSqft);
  const hardware_idr = hardwareUnits(bom.hardware_list) * preset.hardware_cost_idr_per_item;
  const labor_idr = Math.round(bom.estimated_labor_hours * preset.labor_rate_idr_per_hour);
  const sourcing_idr = sourcing.sourcing_fee_idr;
  const subtotal_idr = leather_idr + hardware_idr + labor_idr + sourcing_idr;
  const margin_idr = Math.round(subtotal_idr * preset.margin_pct);
  // Round up to the nearest Rp 10.000 for a clean client-facing number.
  const total_idr = Math.ceil((subtotal_idr + margin_idr) / 10_000) * 10_000;
  return { leather_idr, hardware_idr, labor_idr, sourcing_idr, subtotal_idr, margin_idr, total_idr };
}

/** Pattern draft → stock match → priced BOM, as stored on the order. */
export function assembleQuote(
  draft: Omit<PatternAndBom, 'suggested_quotation_idr'>,
  spec: Specifications,
  inventory: InventoryItem[],
  preset: CategoryPreset,
): { material_sourcing: MaterialSourcing; pattern_and_bom: PatternAndBom; breakdown: QuotationBreakdown } {
  const match = matchInventory(spec.exterior_leather, draft.estimated_leather_sqft, inventory, preset);
  const breakdown = computeQuotation(draft, match.sourcing, match.price_idr_per_sqft, preset);
  return {
    material_sourcing: match.sourcing,
    pattern_and_bom: { ...draft, suggested_quotation_idr: breakdown.total_idr },
    breakdown,
  };
}
