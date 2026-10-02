import type { CategoryPreset, InventoryItem, MaterialSourcing } from '@/lib/types';

/**
 * Agent 3 — Stock Matcher & Sourcing.
 * Matches the order's primary material (leather, wood or metal, whichever the category's schema names) against the
 * crafter's stock (EN + ID synonyms), then decides IN_STOCK vs special sourcing.
 */

const TYPE_SYNONYMS: Array<[string, RegExp]> = [
  ['veg-tan', /veg[\s-]?tan|vegetable|nabati|samak nabati/i],
  ['chrome-tan', /chrome[\s-]?tan|chrome/i],
  ['epsom', /epsom/i],
  ['pull-up', /pull[\s-]?up/i],
  ['crazy horse', /crazy[\s-]?horse/i],
  ['nappa', /nappa|napa/i],
  ['saffiano', /saffiano/i],
  ['teak', /jati|teak/i],
  ['mahogany', /mahoni|mahogany/i],
  ['walnut', /walnut/i],
  ['suar', /trembesi|suar|monkey ?pod/i],
  ['iron', /besi|iron|hollow/i],
];

const COLOR_SYNONYMS: Array<[string, RegExp]> = [
  ['olive green', /olive|zaitun/i],
  ['espresso brown', /espresso/i],
  ['teal', /tosca|teal|turquoise/i],
  ['red', /\bred\b|merah|burgundy/i],
  ['dark brown', /dark brown|coklat tua|cokelat tua/i],
  ['black', /black|hitam/i],
  ['navy', /navy|biru dongker|biru/i],
  ['etoupe', /etoupe|taupe/i],
  ['cognac', /cognac/i],
  ['natural', /natural|natur/i],
  ['tan', /\btan\b/i],
  ['brown', /brown|coklat|cokelat/i],
];

/** Special-sourcing fee and extra lead time. UNKNOWN = not stocked at all: assume a local supplier can provide it. */
export const SOURCING_RULES = {
  LOCAL: { fee_idr: 70_000, lead_days: 5 },
  IMPORT: { fee_idr: 450_000, lead_days: 14 },
  UNKNOWN: { fee_idr: 70_000, lead_days: 5 },
  /** CITES-documented exotic skins from specialist tanneries. */
  EXOTIC: { fee_idr: 1_500_000, lead_days: 30 },
} as const;

const EXOTIC = /croc|buaya|alligator|python|ular|ostrich|burung unta|lizard|biawak|stingray|ikan pari|shagreen/i;

export interface InventoryMatch {
  sourcing: MaterialSourcing;
  matched_item?: InventoryItem;
  price_idr_per_sqft: number;
}

function firstMatch(table: Array<[string, RegExp]>, text: string): string | undefined {
  return table.find(([, re]) => re.test(text))?.[0];
}

function thicknessOf(text: string): number | undefined {
  const m = /(\d+(?:[.,]\d+)?)\s*mm/i.exec(text);
  return m ? Number(m[1].replace(',', '.')) : undefined;
}

export function matchInventory(
  material: string,
  requiredSqft: number,
  inventory: InventoryItem[],
  preset: CategoryPreset,
): InventoryMatch {
  const wantedType = firstMatch(TYPE_SYNONYMS, material);
  // Strip the leather type first so "Veg-Tan Brown" isn't read as color "tan".
  const colorText = TYPE_SYNONYMS.reduce((t, [, re]) => t.replace(new RegExp(re.source, 'gi'), ' '), material);
  const wantedColor = firstMatch(COLOR_SYNONYMS, colorText);
  const wantedThickness = thicknessOf(material);

  const ranked = inventory
    .filter((item) => wantedType && item.material_type === wantedType)
    .map((item) => {
      let score = 3;
      if (wantedColor && item.color === wantedColor) score += 2;
      else if (wantedColor) score -= 2;
      if (wantedThickness !== undefined) score += Math.abs(item.thickness_mm - wantedThickness) <= 0.2 ? 1 : -1;
      return { item, score };
    })
    .filter(({ score }) => score >= 3)
    .sort((a, b) => b.score - a.score || b.item.available_sqft - a.item.available_sqft);

  const best = ranked[0]?.item;

  if (best && best.available_sqft >= requiredSqft) {
    return {
      sourcing: { status: 'IN_STOCK', allocated_stock_id: best.stock_id, sourcing_fee_idr: 0, additional_lead_days: 0 },
      matched_item: best,
      price_idr_per_sqft: best.price_idr_per_sqft,
    };
  }

  // Known material but not enough on the shelf → restock from the same supplier; exotics go through a specialist.
  const rule = EXOTIC.test(material) ? SOURCING_RULES.EXOTIC : best ? SOURCING_RULES[best.origin] : SOURCING_RULES.UNKNOWN;
  return {
    sourcing: {
      status: 'SPECIAL_SOURCING_NEEDED',
      allocated_stock_id: best?.stock_id,
      sourcing_fee_idr: rule.fee_idr,
      additional_lead_days: rule.lead_days,
    },
    matched_item: best,
    price_idr_per_sqft: best?.price_idr_per_sqft ?? preset.sourcing_price_idr_per_sqft,
  };
}
