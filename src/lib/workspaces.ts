import type { CategoryPreset, CraftCategory, CraftFamily, CrafterProfile, InventoryItem } from '@/lib/types';

/**
 * Multi-crafter workspaces on one backend. Every order, chat session, specification and critic review carries a
 * `crafter_id` (the workspace) and a `craft_family` (LEATHER | FURNITURE), and every workspace has its OWN inventory and
 * category presets, so several workshops share one deployment with strictly separate data. Inbound WhatsApp events are
 * routed by `crafter_id`, or by the business number they were sent to (`wa_phone_number_id`), else to the default
 * workspace. Client-safe module (no server imports).
 */

export const LEATHER_WORKSPACE_ID = 'crafter-leather-01';
export const WOOD_WORKSPACE_ID = 'crafter-wood-02';
export const DEFAULT_CRAFTER_ID = process.env.CRAFTER_ID ?? LEATHER_WORKSPACE_ID;

/** Workspaces the simulator can talk to (demo switcher). */
export const DEMO_WORKSPACES: Array<{ id: string; label: string; family: CraftFamily }> = [
  { id: LEATHER_WORKSPACE_ID, label: 'Leather Studio', family: 'LEATHER' },
  { id: WOOD_WORKSPACE_ID, label: 'Wood Studio', family: 'FURNITURE' },
];

/** Offerings that belong to the furniture trade; everything else this product covers is leather craft. */
const FURNITURE_OFFERINGS = new Set(['furniture', 'home_decor']);

/** The trades a workspace covers: explicit `craft_families`, else derived from its offerings. */
export function familiesOf(profile?: Pick<CrafterProfile, 'craft_families' | 'allowed_categories'>): CraftFamily[] {
  if (profile?.craft_families?.length) return profile.craft_families;
  const offerings = profile?.allowed_categories ?? [];
  const families: CraftFamily[] = [];
  if (!offerings.length || offerings.some((o) => !FURNITURE_OFFERINGS.has(o))) families.push('LEATHER');
  if (offerings.some((o) => FURNITURE_OFFERINGS.has(o))) families.push('FURNITURE');
  return families;
}

/** Family of an order: furniture is FURNITURE, leather goods LEATHER; an unclassified order takes the workspace's main trade. */
export function craftFamilyOf(category: CraftCategory, fallback: CraftFamily = 'LEATHER'): CraftFamily {
  if (category === 'FURNITURE') return 'FURNITURE';
  if (category === 'CUSTOM_GENERIC') return fallback;
  return 'LEATHER';
}

/**
 * Chat-session document id: the phone number for the default workspace (backwards compatible with existing sessions),
 * `<crafter_id>__<phone>` for any other, so one client can talk to two workshops without the sessions colliding.
 */
export function sessionKey(phone: string, crafterId: string = DEFAULT_CRAFTER_ID): string {
  return crafterId === DEFAULT_CRAFTER_ID ? phone : `${crafterId}__${phone}`;
}

// ---------------------------------------------------------------------------
// Seed isolation: which stock and presets belong to which trade
// ---------------------------------------------------------------------------

const WOOD_METAL_STOCK = new Set(['teak', 'mahogany', 'walnut', 'suar', 'iron', 'plywood', 'blockboard']);

/** Trade of a stock item: wood, board and metal belong to FURNITURE workspaces, leather / hardware / lining to LEATHER. */
export const stockFamily = (item: Pick<InventoryItem, 'material_type'>): CraftFamily => (WOOD_METAL_STOCK.has(item.material_type) ? 'FURNITURE' : 'LEATHER');

/** Categories a family's presets cover (CUSTOM_GENERIC is shared by both). */
export const presetFamily = (category: CraftCategory): CraftFamily | 'BOTH' =>
  category === 'FURNITURE' ? 'FURNITURE' : category === 'CUSTOM_GENERIC' ? 'BOTH' : 'LEATHER';

/** A workspace's seed stock and presets, from the shared JSON datasets, strictly by its families. */
export function seedForWorkspace(profile: CrafterProfile, inventory: InventoryItem[], presets: CategoryPreset[]) {
  const families = familiesOf(profile);
  return {
    inventory: inventory.filter((i) => families.includes(stockFamily(i))),
    presets: presets.filter((p) => {
      const f = presetFamily(p.category);
      return f === 'BOTH' || families.includes(f);
    }),
  };
}

/** Profile without server-only fields (the login). */
export function publicProfile(profile: CrafterProfile): CrafterProfile {
  const { login: _login, ...rest } = profile;
  void _login;
  return rest;
}
