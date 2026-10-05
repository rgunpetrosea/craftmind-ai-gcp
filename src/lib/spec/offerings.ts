import { constructionDef, constructionLabel, isClassified, schemaOf } from '@/lib/spec/catalog';
import type { ConstructionType, CraftCategory, CrafterProfile, Specifications } from '@/lib/types';

/**
 * What a workshop can offer, in the crafter's own terms ("wallets", "belts"...), mapped onto the internal craft
 * categories and form factors. A crafter profile's `allowed_categories` lists offering ids; everything else is outside
 * the workshop's domain and is declined politely. Client-safe (used by the configurator UI).
 */

export interface Offering {
  id: string;
  /** Indonesian name used in greetings and refusals. */
  label_id: string;
  category: CraftCategory;
  /** Limit to these form factors; omitted = the whole category. */
  constructions?: ConstructionType[];
}

export const OFFERINGS: Offering[] = [
  { id: 'wallets', label_id: 'dompet', category: 'SMALL_GOODS' },
  { id: 'card_holders', label_id: 'card holder', category: 'SMALL_GOODS', constructions: ['FLAT_CARD_HOLDER', 'PATTERNED_CARD_HOLDER'] },
  { id: 'bags', label_id: 'tas', category: 'BAG' },
  { id: 'belts', label_id: 'ikat pinggang', category: 'CUSTOM_GENERIC', constructions: ['BELT'] },
  { id: 'watch_straps', label_id: 'strap jam', category: 'CUSTOM_GENERIC', constructions: ['WATCH_STRAP'] },
  { id: 'shoes', label_id: 'sepatu', category: 'FOOTWEAR' },
  { id: 'furniture', label_id: 'furnitur', category: 'FURNITURE' },
  { id: 'apparel', label_id: 'jaket & apparel', category: 'CUSTOM_GENERIC', constructions: ['APPAREL'] },
  { id: 'jewelry', label_id: 'perhiasan', category: 'CUSTOM_GENERIC', constructions: ['JEWELRY'] },
  { id: 'home_decor', label_id: 'dekorasi rumah', category: 'CUSTOM_GENERIC', constructions: ['HOME_DECOR'] },
  { id: 'sports_gear', label_id: 'perlengkapan olahraga', category: 'CUSTOM_GENERIC', constructions: ['SPORTS_GEAR'] },
];

export const OFFERING_IDS = OFFERINGS.map((o) => o.id);

export function allowedOfferings(profile: CrafterProfile): Offering[] {
  return OFFERINGS.filter((o) => profile.allowed_categories.includes(o.id));
}

/** "dompet, tas, ikat pinggang dan strap jam" */
export function allowedList(profile: CrafterProfile): string {
  const labels = allowedOfferings(profile).map((o) => o.label_id);
  return labels.length <= 1 ? (labels[0] ?? 'produk kustom') : `${labels.slice(0, -1).join(', ')} dan ${labels.at(-1)}`;
}

/** Short craft noun from the primary material: "kerajinan kulit" / "barang kulit". */
export function specialty(profile: CrafterProfile): { craft: string; goods: string } {
  const m = profile.primary_material.toLowerCase();
  if (/leather|kulit/.test(m)) return { craft: 'kerajinan kulit', goods: 'barang kulit' };
  if (/wood|kayu|furni/.test(m)) return { craft: 'furnitur kayu', goods: 'furnitur kayu' };
  return { craft: `produk ${profile.primary_material}`, goods: `produk ${profile.primary_material}` };
}

/**
 * Is the classified request something this workshop makes? Unclassified requests are always in scope (still gathering).
 * A known category with no form factor yet is in scope when any allowed offering covers the category.
 */
export function isWithinScope(spec: Specifications, profile: CrafterProfile): boolean {
  if (!isClassified(spec) && spec.category === 'CUSTOM_GENERIC') return true;
  if (spec.construction_type === 'OTHER_CUSTOM') return true; // judged by Gemini (out_of_scope_item) instead
  return allowedOfferings(profile).some(
    (o) =>
      o.category === spec.category &&
      (!o.constructions || spec.construction_type === 'UNSPECIFIED' || o.constructions.includes(spec.construction_type)),
  );
}

/** How to name what the client asked for in a refusal ("furnitur kayu", "sepatu"). */
export function requestedItemLabel(spec: Specifications): string {
  const offering = OFFERINGS.find((o) => o.category === spec.category && (!o.constructions || o.constructions.includes(spec.construction_type)));
  if (offering) return offering.label_id;
  return (constructionDef(spec.construction_type) ? constructionLabel(spec.construction_type) : schemaOf(spec.category).label_id).toLowerCase();
}
