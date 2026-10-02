import type { CraftCategory, Dimensions } from '@/lib/types';

/**
 * Reference-based sizing. When a client names a reference instead of centimetres ("mirip Birkin 30", "muat iPad Air 11
 * inch"), the size is inferred from this table. It is (1) given to Gemini as calibration in the intake prompt and (2) the
 * deterministic source of truth whenever the text matches an entry, so inferred sizes stay consistent and auditable.
 *
 * kind MODEL   = the product should be about the size of this model (dims are the model's outer size, L x W(depth) x H).
 * kind CONTENT = the product must hold this object (dims are the object's size; room is added by `sizeForContent`).
 */

export interface ReferenceDef {
  label: string;
  match: RegExp;
  kind: 'MODEL' | 'CONTENT';
  /** L x W(depth) x H in cm. */
  dims: Dimensions;
  categories: CraftCategory[];
}

const BAG: CraftCategory[] = ['BAG'];
const BAG_OR_SMALL: CraftCategory[] = ['BAG', 'SMALL_GOODS'];

export const REFERENCES: ReferenceDef[] = [
  // Iconic bag models (outer size)
  { label: 'Hermès Birkin 25', match: /birkin\s*25/i, kind: 'MODEL', dims: { length: 25, width: 13, height: 20 }, categories: BAG },
  { label: 'Hermès Birkin 30', match: /birkin\s*30/i, kind: 'MODEL', dims: { length: 30, width: 16, height: 22 }, categories: BAG },
  { label: 'Hermès Birkin 35', match: /birkin\s*35/i, kind: 'MODEL', dims: { length: 35, width: 18, height: 25 }, categories: BAG },
  { label: 'Hermès Birkin 40', match: /birkin\s*40/i, kind: 'MODEL', dims: { length: 40, width: 21, height: 30 }, categories: BAG },
  { label: 'Hermès Birkin 30', match: /birkin/i, kind: 'MODEL', dims: { length: 30, width: 16, height: 22 }, categories: BAG },
  { label: 'Hermès Kelly 25', match: /kelly\s*25/i, kind: 'MODEL', dims: { length: 25, width: 9, height: 18 }, categories: BAG },
  { label: 'Hermès Kelly 28', match: /kelly\s*28/i, kind: 'MODEL', dims: { length: 28, width: 11, height: 22 }, categories: BAG },
  { label: 'Hermès Kelly 32', match: /kelly\s*32/i, kind: 'MODEL', dims: { length: 32, width: 12, height: 23 }, categories: BAG },
  { label: 'Hermès Kelly 28', match: /kelly/i, kind: 'MODEL', dims: { length: 28, width: 11, height: 22 }, categories: BAG },
  { label: 'Chanel Classic Flap Medium', match: /chanel.{0,20}(classic|flap)|classic flap/i, kind: 'MODEL', dims: { length: 25.5, width: 6.5, height: 15.5 }, categories: BAG },
  { label: 'Louis Vuitton Speedy 30', match: /speedy/i, kind: 'MODEL', dims: { length: 30, width: 17, height: 21 }, categories: BAG },
  { label: 'Goyard Saint Louis PM', match: /goyard|saint louis/i, kind: 'MODEL', dims: { length: 34, width: 14, height: 28 }, categories: BAG },

  // Devices and objects the product must hold (object size)
  { label: 'iPad mini', match: /ipad\s*mini/i, kind: 'CONTENT', dims: { length: 19.5, width: 0.63, height: 13.5 }, categories: BAG },
  { label: 'iPad Air 13 inch', match: /ipad\s*air\s*13/i, kind: 'CONTENT', dims: { length: 28.1, width: 0.61, height: 21.5 }, categories: BAG },
  { label: 'iPad Air 11 inch', match: /ipad\s*air(\s*11)?/i, kind: 'CONTENT', dims: { length: 24.8, width: 0.61, height: 17.9 }, categories: BAG },
  { label: 'iPad Pro 13 inch', match: /ipad\s*pro\s*13/i, kind: 'CONTENT', dims: { length: 28.2, width: 0.51, height: 21.5 }, categories: BAG },
  { label: 'iPad Pro 11 inch', match: /ipad\s*pro/i, kind: 'CONTENT', dims: { length: 24.9, width: 0.53, height: 17.8 }, categories: BAG },
  { label: 'iPad 10.9 inch', match: /ipad/i, kind: 'CONTENT', dims: { length: 24.8, width: 0.7, height: 17.9 }, categories: BAG },
  { label: 'Nintendo Switch', match: /nintendo|switch oled/i, kind: 'CONTENT', dims: { length: 24.2, width: 1.4, height: 10.2 }, categories: BAG },
  { label: 'Dokumen A4', match: /\ba4\b/i, kind: 'CONTENT', dims: { length: 29.7, width: 1, height: 21 }, categories: BAG },
  { label: 'Passport', match: /passport|paspor/i, kind: 'CONTENT', dims: { length: 8.8, width: 0.5, height: 12.5 }, categories: BAG_OR_SMALL },
  { label: 'Smartphone 6.7 inch', match: /iphone\s*\d+\s*pro\s*max|hp\s*besar|6[.,]7\s*inch/i, kind: 'CONTENT', dims: { length: 7.8, width: 0.8, height: 16.1 }, categories: BAG },
];

/** Laptops by screen diagonal, e.g. "laptop 14 inch" / "MacBook 16". */
const LAPTOP = /(?:laptop|macbook(?:\s*(?:air|pro))?)[^.,]{0,12}?(\d{2}(?:[.,]\d)?)\s*(?:inch|inci|"|in\b)?|(\d{2}(?:[.,]\d)?)\s*(?:inch|inci)[^.,]{0,12}(?:laptop|macbook)/i;

export interface ReferenceMatch {
  label: string;
  kind: ReferenceDef['kind'];
  dims: Dimensions;
}

export function matchReference(text: string, category: CraftCategory): ReferenceMatch | undefined {
  const laptop = LAPTOP.exec(text);
  if (laptop && category === 'BAG') {
    const inch = Number((laptop[1] ?? laptop[2]).replace(',', '.'));
    const diag = inch * 2.54;
    // 16:10 panel + bezel: width ≈ 0.86 × diagonal, depth ≈ 0.6 × diagonal, ~1.8 cm thick
    return { label: `Laptop ${inch} inch`, kind: 'CONTENT', dims: { length: Math.round(diag * 0.86), width: 1.8, height: Math.round(diag * 0.6) } };
  }
  const hit = REFERENCES.find((r) => r.categories.includes(category) && r.match.test(text));
  return hit && { label: hit.label, kind: hit.kind, dims: hit.dims };
}

/** Outer product size that holds the object: room on each side, extra depth for accessories (charger, cables). */
export function sizeForContent(object: Dimensions, withAccessories: boolean, category: CraftCategory): Dimensions {
  const r1 = (n: number) => Math.round(n * 2) / 2;
  const room = category === 'SMALL_GOODS' ? 1.2 : 4; // a sleeve/cover hugs its content; a bag needs hand room
  // bags need usable depth even for flat contents (a 4 cm deep laptop tote is unusable); chargers/cables add more
  const minDepth = category === 'SMALL_GOODS' ? object.width + 0.5 : withAccessories ? 8 : 6;
  return { length: r1(object.length + room), width: r1(Math.max(object.width + 2, minDepth)), height: r1(object.height + room) };
}

export const ACCESSORY_HINT = /charger|kabel|cable|adaptor|adapter|mouse|power ?bank|aksesoris|accessor/i;

/** Calibration list for the Gemini intake prompt. */
export function referenceGuide(category: CraftCategory): string {
  const rows = REFERENCES.filter((r) => r.categories.includes(category));
  if (!rows.length && category !== 'BAG') return '';
  const fmt = (d: Dimensions) => `${d.length} x ${d.width} x ${d.height} cm`;
  const lines = [...new Map(rows.map((r) => [r.label, r])).values()].map((r) => `- ${r.label} (${r.kind === 'MODEL' ? 'model size' : 'object to hold'}): ${fmt(r.dims)}`);
  if (category === 'BAG') lines.push('- Laptop N inch (object to hold): width ≈ 0.86 × N × 2.54, height ≈ 0.6 × N × 2.54, ~1.8 cm thick');
  return lines.join('\n');
}

/** Furniture that must fit a room/space and was described without measurements → on-site measurement. */
export const SITE_VISIT_HINT = /kamar|ruang(an)?\b|rumah|dinding|tembok|built[\s-]?in|survei|survey|ukur (ke|di) (lokasi|rumah|tempat)|sesuai (ruang|tempat|space)|pojok|ceruk|bawah tangga/i;
