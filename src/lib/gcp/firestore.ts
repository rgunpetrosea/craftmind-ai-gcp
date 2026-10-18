import { getApps, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import categoryPresets from '@/lib/data/category-presets.json';
import inventorySeed from '@/lib/data/inventory.json';
import workspaceSeed from '@/lib/data/workspaces.json';
import { buildDemoSeed } from '@/lib/data/seed';
import { normalizeOrder } from '@/lib/orders';
import type {
  CategoryPreset,
  ChatMessage,
  Conversation,
  CraftCategory,
  CraftFamily,
  CrafterProfile,
  CriticReviewRecord,
  InventoryItem,
  OrderPayload,
} from '@/lib/types';
import { DEFAULT_CRAFTER_ID, seedForWorkspace, sessionKey } from '@/lib/workspaces';

/**
 * Persistence for the WA session buffer, draft orders, design reviews, crafter workspaces and their master data.
 *
 * USE_FIRESTORE=true → Cloud Firestore via firebase-admin (Application Default Credentials; automatic on Cloud Run).
 * Otherwise an in-memory store seeded with demo data, so the app runs locally with zero GCP setup.
 *
 * Firestore layout (every order-scoped document carries `crafter_id` + `craft_family`):
 *   orders/{order_id}                                OrderPayload (spec, BOM, quote, media URLs, takeover state)
 *   orders/{order_id}/messages/{id}                  ChatMessage (the WhatsApp transcript)
 *   chat_sessions/{session_key}                      Conversation (key: phone, or "<crafter_id>__<phone>")
 *   specifications/{order_id}                        Spec projection (spec card, design intent, brief)
 *   critic_reviews/{review_id}                       CriticReviewRecord (every design-critic pass)
 *   crafter_workspaces/{crafter_id}                  CrafterProfile (+ mock login), one per workshop
 *   crafter_workspaces/{crafter_id}/inventory/{id}   InventoryItem: the workshop's OWN stock (leather vs wood/metal)
 *   crafter_workspaces/{crafter_id}/presets/{cat}    CategoryPreset: the workshop's OWN presets
 * Workspace data is strictly isolated: inventory and presets are only ever read through a workspace id. A workspace is
 * seeded from the JSON datasets by its craft families (seedForWorkspace) the first time it is used.
 */
export interface DataStore {
  getOrder(orderId: string): Promise<OrderPayload | null>;
  /** Newest first; optionally one crafter workspace and / or one craft family. */
  listOrders(filter?: OrderFilter): Promise<OrderPayload[]>;
  saveOrder(order: OrderPayload): Promise<void>;

  getConversation(phone: string, crafterId?: string): Promise<Conversation | null>;
  saveConversation(conversation: Conversation): Promise<void>;

  appendMessage(message: ChatMessage): Promise<void>;
  listMessages(orderId: string): Promise<ChatMessage[]>;
  updateMessage(orderId: string, messageId: string, patch: Partial<ChatMessage>): Promise<void>;

  appendCriticReview(review: CriticReviewRecord): Promise<void>;
  listCriticReviews(orderId: string): Promise<CriticReviewRecord[]>;

  /** The workspace's own stock. */
  listInventory(crafterId: string): Promise<InventoryItem[]>;
  saveInventoryItem(item: InventoryItem, crafterId: string): Promise<void>;

  /** The workspace's own category presets. */
  listPresets(crafterId: string): Promise<CategoryPreset[]>;
  savePreset(preset: CategoryPreset, crafterId: string): Promise<void>;

  getCrafterProfile(crafterId?: string): Promise<CrafterProfile>;
  saveCrafterProfile(profile: CrafterProfile): Promise<void>;
  listWorkspaces(): Promise<CrafterProfile[]>;
  /** The workspace whose WhatsApp business number id this is (inbound routing). */
  findWorkspaceByPhoneNumberId(phoneNumberId: string): Promise<CrafterProfile | null>;
  /** Mock login lookup. */
  findWorkspaceByUsername(username: string): Promise<CrafterProfile | null>;
}

export interface OrderFilter {
  crafterId?: string;
  family?: CraftFamily;
}

/** Firestore collection names (one place, so a deployment can be inspected against this list). */
export const COLLECTIONS = {
  orders: 'orders',
  messages: 'messages',
  chatSessions: 'chat_sessions',
  specifications: 'specifications',
  criticReviews: 'critic_reviews',
  workspaces: 'crafter_workspaces',
  inventory: 'inventory',
  presets: 'presets',
  legacyConversations: 'conversations',
  legacyCrafters: 'crafters',
} as const;

const PRESETS = categoryPresets as CategoryPreset[];
const INVENTORY = inventorySeed as InventoryItem[];
const WORKSPACES = workspaceSeed as CrafterProfile[];
const DEFAULT_PROFILE = WORKSPACES.find((w) => w.crafter_id === DEFAULT_CRAFTER_ID) ?? WORKSPACES[0];

const byCreatedDesc = (a: OrderPayload, b: OrderPayload) => b.created_at.localeCompare(a.created_at);
const byCreatedAsc = (a: { created_at: string }, b: { created_at: string }) => a.created_at.localeCompare(b.created_at);
const clone = <T,>(v: T): T => structuredClone(v);
const matches = (o: OrderPayload, f?: OrderFilter) => (!f?.crafterId || o.crafter_id === f.crafterId) && (!f?.family || o.craft_family === f.family);
const ORDER_LIST_LIMIT = 100;

/** A workspace profile: its seed profile (or the default's) under its own id, overlaid with what is stored. */
const asProfile = (crafterId: string, data?: Partial<CrafterProfile>): CrafterProfile => ({
  ...clone(WORKSPACES.find((w) => w.crafter_id === crafterId) ?? DEFAULT_PROFILE),
  ...data,
  crafter_id: crafterId,
});

/** The order's spec as its own document: spec card, design intent and brief, scoped to the workspace. */
function specificationDoc(order: OrderPayload) {
  return {
    order_id: order.order_id,
    crafter_id: order.crafter_id,
    craft_family: order.craft_family,
    craft_category: order.craft_category,
    session_state: order.session_state,
    specifications: order.specifications,
    client_brief: order.client_brief ?? null,
    design_direction: order.specifications.design_direction,
    crafter_design_status: order.design_review?.crafter_status ?? 'NOT_REVIEWED',
    updated_at: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// In-memory implementation (dev / demo)
// ---------------------------------------------------------------------------

class MemoryStore implements DataStore {
  private orders = new Map<string, OrderPayload>();
  private messages = new Map<string, ChatMessage[]>();
  private conversations = new Map<string, Conversation>();
  private reviews = new Map<string, CriticReviewRecord[]>();
  private workspaces = new Map<string, CrafterProfile>(WORKSPACES.map((w) => [w.crafter_id, clone(w)]));
  private inventory = new Map<string, Map<string, InventoryItem>>();
  private presets = new Map<string, Map<CraftCategory, CategoryPreset>>();

  constructor() {
    const seed = buildDemoSeed(PRESETS, INVENTORY);
    for (const { order, conversation, messages } of seed) {
      this.orders.set(order.order_id, order);
      this.conversations.set(sessionKey(conversation.phone_number, conversation.crafter_id), conversation);
      this.messages.set(order.order_id, messages);
    }
  }

  /** The workspace's stock / presets, seeded from the datasets by its families on first use. */
  private shelf(crafterId: string) {
    if (!this.inventory.has(crafterId)) {
      const seed = seedForWorkspace(asProfile(crafterId, this.workspaces.get(crafterId)), INVENTORY, PRESETS);
      this.inventory.set(crafterId, new Map(seed.inventory.map((i) => [i.stock_id, clone(i)])));
      this.presets.set(crafterId, new Map(seed.presets.map((p) => [p.category, clone(p)])));
    }
    return { inventory: this.inventory.get(crafterId)!, presets: this.presets.get(crafterId)! };
  }

  async getOrder(id: string) {
    const o = this.orders.get(id);
    return o ? normalizeOrder(clone(o)) : null;
  }
  async listOrders(filter?: OrderFilter) {
    return [...this.orders.values()].map((o) => normalizeOrder(clone(o))).filter((o) => matches(o, filter)).sort(byCreatedDesc);
  }
  async saveOrder(order: OrderPayload) {
    this.orders.set(order.order_id, normalizeOrder(clone(order)));
  }
  async getConversation(phone: string, crafterId?: string) {
    const c = this.conversations.get(sessionKey(phone, crafterId));
    return c ? clone(c) : null;
  }
  async saveConversation(c: Conversation) {
    this.conversations.set(sessionKey(c.phone_number, c.crafter_id), clone(c));
  }
  async appendMessage(m: ChatMessage) {
    const list = this.messages.get(m.order_id) ?? [];
    list.push(clone(m));
    this.messages.set(m.order_id, list);
  }
  async listMessages(orderId: string) {
    return (this.messages.get(orderId) ?? []).map(clone).sort(byCreatedAsc);
  }
  async updateMessage(orderId: string, messageId: string, patch: Partial<ChatMessage>) {
    const m = this.messages.get(orderId)?.find((x) => x.id === messageId);
    if (m) Object.assign(m, patch);
  }
  async appendCriticReview(review: CriticReviewRecord) {
    this.reviews.set(review.order_id, [...(this.reviews.get(review.order_id) ?? []), clone(review)]);
  }
  async listCriticReviews(orderId: string) {
    return (this.reviews.get(orderId) ?? []).map(clone).sort(byCreatedAsc);
  }
  async listInventory(crafterId: string) {
    return [...this.shelf(crafterId).inventory.values()].map(clone);
  }
  async saveInventoryItem(item: InventoryItem, crafterId: string) {
    this.shelf(crafterId).inventory.set(item.stock_id, clone(item));
  }
  async listPresets(crafterId: string) {
    return [...this.shelf(crafterId).presets.values()].map(clone);
  }
  async savePreset(p: CategoryPreset, crafterId: string) {
    this.shelf(crafterId).presets.set(p.category, clone(p));
  }
  async getCrafterProfile(crafterId = DEFAULT_PROFILE.crafter_id) {
    const w = this.workspaces.get(crafterId);
    return w ? clone(w) : asProfile(crafterId);
  }
  async saveCrafterProfile(profile: CrafterProfile) {
    const current = this.workspaces.get(profile.crafter_id);
    // the login is never edited through the profile form
    this.workspaces.set(profile.crafter_id, clone({ ...profile, ...(current?.login && { login: current.login }) }));
  }
  async listWorkspaces() {
    return [...this.workspaces.values()].map(clone);
  }
  async findWorkspaceByPhoneNumberId(id: string) {
    const w = [...this.workspaces.values()].find((p) => p.wa_phone_number_id === id);
    return w ? clone(w) : null;
  }
  async findWorkspaceByUsername(username: string) {
    const w = [...this.workspaces.values()].find((p) => p.login?.username === username);
    return w ? clone(w) : null;
  }
}

// ---------------------------------------------------------------------------
// Firestore implementation
// ---------------------------------------------------------------------------

export function getAdminApp(): App {
  return getApps()[0] ?? initializeApp({ projectId: process.env.GCP_PROJECT_ID, storageBucket: process.env.GCS_BUCKET });
}

/** Firestore rejects documents above 1 MiB; warn well before that (inline images are the usual cause). */
const DOC_WARN_BYTES = 900_000;

class FirestoreStore implements DataStore {
  private db: Firestore;
  private seededWorkspaces: Promise<void> | null = null;
  private seededShelves = new Map<string, Promise<void>>();

  constructor() {
    this.db = getFirestore(getAdminApp());
    this.db.settings({ ignoreUndefinedProperties: true });
    if (!process.env.GCS_BUCKET) {
      console.warn('[firestore] USE_FIRESTORE=true without GCS_BUCKET: mockups and sketches are stored inline and can exceed the 1 MiB document limit. Set GCS_BUCKET.');
    }
  }

  private col(name: (typeof COLLECTIONS)[keyof typeof COLLECTIONS]) {
    return this.db.collection(name);
  }
  private workspaceDoc(crafterId: string) {
    return this.col(COLLECTIONS.workspaces).doc(crafterId);
  }

  /** The demo workspaces (profiles + mock logins) exist on first use; existing documents are never overwritten. */
  private ensureWorkspaces(): Promise<void> {
    this.seededWorkspaces ??= (async () => {
      const snaps = await Promise.all(WORKSPACES.map((w) => this.workspaceDoc(w.crafter_id).get()));
      const batch = this.db.batch();
      snaps.forEach((snap, i) => {
        if (!snap.exists) batch.set(this.workspaceDoc(WORKSPACES[i].crafter_id), WORKSPACES[i]);
        else if (!snap.data()?.login && WORKSPACES[i].login) batch.set(this.workspaceDoc(WORKSPACES[i].crafter_id), { login: WORKSPACES[i].login }, { merge: true });
      });
      await batch.commit();
    })();
    return this.seededWorkspaces;
  }

  /** A workspace's own stock and presets, seeded from the datasets by its craft families the first time. */
  private ensureShelf(crafterId: string): Promise<void> {
    if (!this.seededShelves.has(crafterId)) {
      this.seededShelves.set(
        crafterId,
        (async () => {
          await this.ensureWorkspaces();
          const ref = this.workspaceDoc(crafterId);
          const [inv, presets, profile] = await Promise.all([
            ref.collection(COLLECTIONS.inventory).limit(1).get(),
            ref.collection(COLLECTIONS.presets).limit(1).get(),
            this.getCrafterProfile(crafterId),
          ]);
          const seed = seedForWorkspace(profile, INVENTORY, PRESETS);
          const batch = this.db.batch();
          if (inv.empty) seed.inventory.forEach((i) => batch.set(ref.collection(COLLECTIONS.inventory).doc(i.stock_id), i));
          if (presets.empty) seed.presets.forEach((p) => batch.set(ref.collection(COLLECTIONS.presets).doc(p.category), p));
          await batch.commit();
        })(),
      );
    }
    return this.seededShelves.get(crafterId)!;
  }

  async getOrder(id: string) {
    const snap = await this.col(COLLECTIONS.orders).doc(id).get();
    return snap.exists ? normalizeOrder(snap.data() as OrderPayload) : null;
  }
  async listOrders(filter?: OrderFilter) {
    // a single-field filter needs no composite index; ordering happens in memory (board sizes are small)
    const query = filter?.crafterId
      ? this.col(COLLECTIONS.orders).where('crafter_id', '==', filter.crafterId)
      : this.col(COLLECTIONS.orders).orderBy('created_at', 'desc').limit(ORDER_LIST_LIMIT);
    const snap = await query.get();
    return snap.docs
      .map((d) => normalizeOrder(d.data() as OrderPayload))
      .filter((o) => matches(o, filter))
      .sort(byCreatedDesc)
      .slice(0, ORDER_LIST_LIMIT);
  }
  async saveOrder(order: OrderPayload) {
    const doc = normalizeOrder(order);
    const size = JSON.stringify(doc).length;
    if (size > DOC_WARN_BYTES) console.warn(`[firestore] order ${doc.order_id} is ${Math.round(size / 1024)} KiB (limit 1024 KiB): set GCS_BUCKET so images are stored as URLs`);
    const batch = this.db.batch();
    batch.set(this.col(COLLECTIONS.orders).doc(doc.order_id), doc);
    batch.set(this.col(COLLECTIONS.specifications).doc(doc.order_id), specificationDoc(doc));
    await batch.commit();
  }
  async getConversation(phone: string, crafterId?: string) {
    const snap = await this.col(COLLECTIONS.chatSessions).doc(sessionKey(phone, crafterId)).get();
    if (snap.exists) return snap.data() as Conversation;
    // sessions written before chat_sessions existed (default workspace only)
    if (crafterId && crafterId !== DEFAULT_CRAFTER_ID) return null;
    const legacy = await this.col(COLLECTIONS.legacyConversations).doc(phone).get();
    return legacy.exists ? (legacy.data() as Conversation) : null;
  }
  async saveConversation(c: Conversation) {
    await this.col(COLLECTIONS.chatSessions).doc(sessionKey(c.phone_number, c.crafter_id)).set(c);
  }
  private messagesRef(orderId: string) {
    return this.col(COLLECTIONS.orders).doc(orderId).collection(COLLECTIONS.messages);
  }
  async appendMessage(m: ChatMessage) {
    await this.messagesRef(m.order_id).doc(m.id).set(m);
  }
  async listMessages(orderId: string) {
    const snap = await this.messagesRef(orderId).orderBy('created_at', 'asc').get();
    return snap.docs.map((d) => d.data() as ChatMessage);
  }
  async updateMessage(orderId: string, messageId: string, patch: Partial<ChatMessage>) {
    await this.messagesRef(orderId).doc(messageId).set(patch, { merge: true });
  }
  async appendCriticReview(review: CriticReviewRecord) {
    await this.col(COLLECTIONS.criticReviews).doc(review.review_id).set(review);
  }
  async listCriticReviews(orderId: string) {
    const snap = await this.col(COLLECTIONS.criticReviews).where('order_id', '==', orderId).get();
    return snap.docs.map((d) => d.data() as CriticReviewRecord).sort(byCreatedAsc);
  }
  async listInventory(crafterId: string) {
    await this.ensureShelf(crafterId);
    const snap = await this.workspaceDoc(crafterId).collection(COLLECTIONS.inventory).get();
    return snap.docs.map((d) => d.data() as InventoryItem);
  }
  async saveInventoryItem(item: InventoryItem, crafterId: string) {
    await this.ensureShelf(crafterId);
    await this.workspaceDoc(crafterId).collection(COLLECTIONS.inventory).doc(item.stock_id).set(item);
  }
  async listPresets(crafterId: string) {
    await this.ensureShelf(crafterId);
    const snap = await this.workspaceDoc(crafterId).collection(COLLECTIONS.presets).get();
    return snap.docs.map((d) => d.data() as CategoryPreset);
  }
  async savePreset(p: CategoryPreset, crafterId: string) {
    await this.ensureShelf(crafterId);
    await this.workspaceDoc(crafterId).collection(COLLECTIONS.presets).doc(p.category).set(p);
  }
  async getCrafterProfile(crafterId = DEFAULT_PROFILE.crafter_id) {
    await this.ensureWorkspaces();
    const snap = await this.workspaceDoc(crafterId).get();
    if (snap.exists) return asProfile(crafterId, snap.data() as Partial<CrafterProfile>);
    const legacy = await this.col(COLLECTIONS.legacyCrafters).doc(crafterId).get();
    return asProfile(crafterId, legacy.exists ? (legacy.data() as Partial<CrafterProfile>) : undefined);
  }
  async saveCrafterProfile(profile: CrafterProfile) {
    // merge: the login (and anything the form doesn't know) is kept
    const { login: _login, ...editable } = profile;
    void _login;
    await this.workspaceDoc(profile.crafter_id).set(editable, { merge: true });
  }
  async listWorkspaces() {
    await this.ensureWorkspaces();
    const snap = await this.col(COLLECTIONS.workspaces).get();
    return snap.docs.map((d) => asProfile(d.id, d.data() as Partial<CrafterProfile>));
  }
  async findWorkspaceByPhoneNumberId(id: string) {
    const snap = await this.col(COLLECTIONS.workspaces).where('wa_phone_number_id', '==', id).limit(1).get();
    return snap.empty ? null : asProfile(snap.docs[0].id, snap.docs[0].data() as Partial<CrafterProfile>);
  }
  async findWorkspaceByUsername(username: string) {
    await this.ensureWorkspaces();
    const snap = await this.col(COLLECTIONS.workspaces).where('login.username', '==', username).limit(1).get();
    return snap.empty ? null : asProfile(snap.docs[0].id, snap.docs[0].data() as Partial<CrafterProfile>);
  }
}

// ---------------------------------------------------------------------------

/** Bump when the DataStore contract changes, so a dev server's hot reload builds a fresh store (old shape is dropped). */
const STORE_VERSION = 'v3-workspaces';
const globalForStore = globalThis as unknown as { __craftmindStores?: Record<string, DataStore> };

/** Normalizes every order on the way in and out, independent of the raw store's code version. */
function normalizing(raw: DataStore): DataStore {
  return {
    ...bindAll(raw),
    getOrder: async (id) => {
      const o = await raw.getOrder(id);
      return o ? normalizeOrder(o) : null;
    },
    listOrders: async (filter) => (await raw.listOrders(filter)).map(normalizeOrder).filter((o) => matches(o, filter)),
    saveOrder: (order) => raw.saveOrder(normalizeOrder(order)),
  };
}

function bindAll(raw: DataStore): DataStore {
  const methods: Array<keyof DataStore> = [
    'getOrder', 'listOrders', 'saveOrder', 'getConversation', 'saveConversation', 'appendMessage',
    'listMessages', 'updateMessage', 'appendCriticReview', 'listCriticReviews', 'listInventory', 'saveInventoryItem',
    'listPresets', 'savePreset', 'getCrafterProfile', 'saveCrafterProfile', 'listWorkspaces', 'findWorkspaceByPhoneNumberId',
    'findWorkspaceByUsername',
  ];
  return Object.fromEntries(methods.map((m) => [m, (raw[m] as (...a: unknown[]) => unknown).bind(raw)])) as unknown as DataStore;
}

/** Singleton that survives Next.js dev hot reloads (per store version); always accessed through the normalizing wrapper. */
export function getStore(): DataStore {
  const stores = (globalForStore.__craftmindStores ??= {});
  stores[STORE_VERSION] ??= process.env.USE_FIRESTORE === 'true' ? new FirestoreStore() : new MemoryStore();
  return normalizing(stores[STORE_VERSION]);
}

export function isFirestoreEnabled(): boolean {
  return process.env.USE_FIRESTORE === 'true';
}

/** The preset for a category from a workspace's list, else the dataset's (a category outside the workspace's trade). */
export function presetOrDefault(presets: CategoryPreset[], category: CraftCategory): CategoryPreset {
  return presets.find((p) => p.category === category) ?? PRESETS.find((p) => p.category === category)!;
}

/** A category preset of one workspace (falls back to the dataset's preset when the workspace has none for it). */
export async function getPreset(category: CraftCategory, crafterId: string = DEFAULT_CRAFTER_ID): Promise<CategoryPreset> {
  const presets = await getStore().listPresets(crafterId);
  return presets.find((p) => p.category === category) ?? PRESETS.find((p) => p.category === category)!;
}
