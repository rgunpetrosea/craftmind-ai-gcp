import type { BomComponent } from '@/lib/types';

export const CM2_PER_SQFT = 929.0304;

/** Pieces cut from something other than the order's primary material (leather hide / wood board). */
export const SECONDARY_PART = /other material|lining|pelapis|outsole|stiffener|interfacing|foam|padding|upholstery|fabric|plywood|elastic|welt|heel stack|glass|kaca/i;

/** "30 x 22", "30x22 cm", "Ø 12" → area in cm² (× qty). Returns 0 when unparseable. */
export function componentAreaCm2(c: BomComponent): number {
  const nums = (c.dimensions_cm.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => Number(n.replace(',', '.')));
  if (nums.length >= 2) return nums[0] * nums[1] * c.qty;
  if (nums.length === 1) return Math.PI * (nums[0] / 2) ** 2 * c.qty;
  return 0;
}

export function netPrimaryAreaCm2(components: BomComponent[]): number {
  return components.filter((c) => !SECONDARY_PART.test(c.part_name)).reduce((sum, c) => sum + componentAreaCm2(c), 0);
}
