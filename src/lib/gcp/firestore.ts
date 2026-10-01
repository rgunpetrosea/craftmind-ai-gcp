import { getApps, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import categoryPresets from '@/lib/data/category-presets.json';
import inventorySeed from '@/lib/data/inventory.json';
import { buildDemoSeed } from '@/lib/data/seed';
import { normalizeOrder } from '@/lib/orders';
import type { CategoryPreset, ChatMessage, Conversation, CraftCategory, InventoryItem, OrderPayload } from '@/lib/types';

/**
 * Persistence for the WA session buffer, inventory and draft orders.
 *
 * USE_FIRESTORE=true → Firestore via firebase-admin (Application Default
 * Credentials; automatic on Cloud Run). Otherwise an in-memory store seeded
 * with demo data, so the app runs locally with zero GCP setup.
 *
 * Firestore layout:
 *   orders/{order_id}                  OrderPayload
 *   orders/{order_id}/messages/{id}    ChatMessage
 *   conversations/{phone_number}       Conversation (phone → active order)
 *   inventory/{stock_id}               InventoryItem
 *   presets/{category}                 CategoryPreset
 */
export interface DataStore {
  getOrder(orderId: string): Promise<OrderPayload | null>;
  listOrders(): Promise<OrderPayload[]>;
  saveOrder(order: OrderPayload): Promise<void>;

  getConversation(phone: string): Promise<Conversation | null>;
  saveConversation(conversation: Conversation): Promise<void>;

  appendMessage(message: ChatMessage): Promise<void>;
  listMessages(orderId: string): Promise<ChatMessage[]>;
  updateMessage(orderId: string, messageId: string, patch: Partial<ChatMessage>): Promise<void>;

  listInventory(): Promise<InventoryItem[]>;
  saveInventoryItem(item: InventoryItem): Promise<void>;

  listPresets(): Promise<CategoryPreset[]>;
  savePreset(preset: CategoryPreset): Promise<void>;
}

const PRESETS = categoryPresets as CategoryPreset[];
const INVENTORY = inventorySeed as InventoryItem[];

const byCreatedDesc = (a: OrderPayload, b: OrderPayload) => b.created_at.localeCompare(a.created_at);
const byCreatedAsc = (a: ChatMessage, b: ChatMessage) => a.created_at.localeCompare(b.created_at);
const clone = <T,>(v: T): T => structuredClone(v);

// ---------------------------------------------------------------------------
// In-memory implementation (dev / demo)
// ---------------------------------------------------------------------------

class MemoryStore implements DataStore {
  private orders = new Map<string, OrderPayload>();
  private messages = new Map<string, ChatMessage[]>();
  private conversations = new Map<string, Conversation>();
  private inventory = new Map<string, InventoryItem>(INVENTORY.map((i) => [i.stock_id, clone(i)]));
  private presets = new Map<CraftCategory, CategoryPreset>(PRESETS.map((p) => [p.category, clone(p)]));

  constructor() {
    const seed = buildDemoSeed(PRESETS, INVENTORY);
    for (const { order, conversation, messages } of seed) {
      this.orders.set(order.order_id, order);
      this.conversations.set(conversation.phone_number, conversation);
      this.messages.set(order.order_id, messages);
    }
  }

  async getOrder(id: string) {
    const o = this.orders.get(id);
    return o ? normalizeOrder(clone(o)) : null;
  }
  async listOrders() {
    return [...this.orders.values()].map((o) => normalizeOrder(clone(o))).sort(byCreatedDesc);
  }
  async saveOrder(order: OrderPayload) {
    this.orders.set(order.order_id, normalizeOrder(clone(order)));
  }
  async getConversation(phone: string) {
    const c = this.conversations.get(phone);
    return c ? clone(c) : null;
  }
  async saveConversation(c: Conversation) {
    this.conversations.set(c.phone_number, clone(c));
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
  async listInventory() {
    return [...this.inventory.values()].map(clone);
  }
  async saveInventoryItem(item: InventoryItem) {
    this.inventory.set(item.stock_id, clone(item));
  }
  async listPresets() {
    return [...this.presets.values()].map(clone);
  }
  async savePreset(p: CategoryPreset) {
    this.presets.set(p.category, clone(p));
  }
}

// ---------------------------------------------------------------------------
// Firestore implementation
// ---------------------------------------------------------------------------

export function getAdminApp(): App {
  return getApps()[0] ?? initializeApp({ projectId: process.env.GCP_PROJECT_ID });
}

class FirestoreStore implements DataStore {
  private db: Firestore;
  private seeded: Promise<void> | null = null;

  constructor() {
    this.db = getFirestore(getAdminApp());
    this.db.settings({ ignoreUndefinedProperties: true });
  }

  /** Load master data from the JSON datasets the first time an empty project is used. */
  private ensureMasterData(): Promise<void> {
    this.seeded ??= (async () => {
      const [inv, presets] = await Promise.all([
        this.db.collection('inventory').limit(1).get(),
        this.db.collection('presets').limit(1).get(),
      ]);
      const batch = this.db.batch();
      if (inv.empty) INVENTORY.forEach((i) => batch.set(this.db.collection('inventory').doc(i.stock_id), i));
      if (presets.empty) PRESETS.forEach((p) => batch.set(this.db.collection('presets').doc(p.category), p));
      await batch.commit();
    })();
    return this.seeded;
  }

  async getOrder(id: string) {
    const snap = await this.db.collection('orders').doc(id).get();
    return snap.exists ? normalizeOrder(snap.data() as OrderPayload) : null;
  }
  async listOrders() {
    const snap = await this.db.collection('orders').orderBy('created_at', 'desc').limit(100).get();
    return snap.docs.map((d) => normalizeOrder(d.data() as OrderPayload));
  }
  async saveOrder(order: OrderPayload) {
    await this.db.collection('orders').doc(order.order_id).set(normalizeOrder(order));
  }
  async getConversation(phone: string) {
    const snap = await this.db.collection('conversations').doc(phone).get();
    return snap.exists ? (snap.data() as Conversation) : null;
  }
  async saveConversation(c: Conversation) {
    await this.db.collection('conversations').doc(c.phone_number).set(c);
  }
  private messagesRef(orderId: string) {
    return this.db.collection('orders').doc(orderId).collection('messages');
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
  async listInventory() {
    await this.ensureMasterData();
    const snap = await this.db.collection('inventory').get();
    return snap.docs.map((d) => d.data() as InventoryItem);
  }
  async saveInventoryItem(item: InventoryItem) {
    await this.db.collection('inventory').doc(item.stock_id).set(item);
  }
  async listPresets() {
    await this.ensureMasterData();
    const snap = await this.db.collection('presets').get();
    return snap.docs.map((d) => d.data() as CategoryPreset);
  }
  async savePreset(p: CategoryPreset) {
    await this.db.collection('presets').doc(p.category).set(p);
  }
}

// ---------------------------------------------------------------------------

const globalForStore = globalThis as unknown as { __craftmindStore?: DataStore };

/** Singleton that survives Next.js dev hot reloads. */
export function getStore(): DataStore {
  globalForStore.__craftmindStore ??= process.env.USE_FIRESTORE === 'true' ? new FirestoreStore() : new MemoryStore();
  return globalForStore.__craftmindStore;
}

export function isFirestoreEnabled(): boolean {
  return process.env.USE_FIRESTORE === 'true';
}

export async function getPreset(category: CraftCategory): Promise<CategoryPreset> {
  const presets = await getStore().listPresets();
  return presets.find((p) => p.category === category) ?? PRESETS.find((p) => p.category === category)!;
}
