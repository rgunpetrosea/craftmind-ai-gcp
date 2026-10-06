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
  ['plywood', /plywood|multiplek\w*|triplek/i],
  ['blockboard', /block ?board/i],
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

const LEATHER_TYPES = new Set(['veg-tan', 'chrome-tan', 'epsom', 'pull-up', 'crazy horse', 'nappa', 'saffiano']);
const WOOD_METAL_TYPES = new Set(['teak', 'mahogany', 'walnut', 'suar', 'iron', 'plywood', 'blockboard']);

/** True when the material text names no specific type we stock ("Kulit", "Cokelat tua", "Dark Brown leather", "kayu"). */
export function isGenericMaterial(material: string): boolean {
  return material.trim() !== '' && !firstMatch(TYPE_SYNONYMS, material) && !/croc|buaya|python|ostrich|lizard|stingray|sintetis|synthetic|suede|novonappa/i.test(material);
}

/**
 * Map a generic material to the closest stocked item so pattern, BOM and price can be computed straight away:
 * same material family as the category (leather vs wood/metal), colour match first (also from the separate colour
 * field), then the category's house default (`preset.default_stock_id`), then the best-stocked item. The crafter can
 * still change it on the dashboard.
 */
export function resolveGenericMaterial(
  material: string,
  colorHint: string,
  inventory: InventoryItem[],
  preset: CategoryPreset,
  kind: 'leather' | 'wood_metal',
): InventoryItem | undefined {
  const family = kind === 'leather' ? LEATHER_TYPES : WOOD_METAL_TYPES;
  const items = inventory.filter((i) => family.has(i.material_type));
  const wantedColor = firstMatch(COLOR_SYNONYMS, `${material} ${colorHint}`);
  const wantedThickness = thicknessOf(material);
  const best = (list: InventoryItem[]) =>
    [...list].sort(
      (a, b) =>
        Number(b.available_sqft > 0) - Number(a.available_sqft > 0) ||
        (wantedThickness !== undefined ? Math.abs(a.thickness_mm - wantedThickness) - Math.abs(b.thickness_mm - wantedThickness) : 0) ||
        b.available_sqft - a.available_sqft,
    )[0];

  if (wantedColor) {
    // a colour the client asked for is never swapped: no item in that colour → leave it generic (special sourcing)
    const sameColor = items.filter((i) => i.color === wantedColor);
    return sameColor.length ? best(sameColor) : undefined;
  }
  const houseDefault = items.find((i) => i.stock_id === preset.default_stock_id && i.available_sqft > 0);
  return houseDefault ?? best(items.filter((i) => i.available_sqft > 0));
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
