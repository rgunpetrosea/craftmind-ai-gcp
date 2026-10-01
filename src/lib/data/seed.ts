import { templatePattern } from '@/lib/agents/pattern-agent';
import { assembleQuote } from '@/lib/agents/pricing';
import { createDraftOrder } from '@/lib/orders';
import { emptySpecifications } from '@/lib/spec/catalog';
import type { CategoryPreset, ChatMessage, Conversation, InventoryItem, OrderPayload, Specifications } from '@/lib/types';
import { renderConceptSvg, renderDemoSketchSvg } from '@/lib/utils/svg';

/** Demo orders for the in-memory store so the dashboard is populated on first load. */

interface SeedEntry {
  order: OrderPayload;
  conversation: Conversation;
  messages: ChatMessage[];
}

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

function msg(order: OrderPayload, n: number, sender: ChatMessage['sender'], text: string, at: number, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { id: `${order.order_id}-M${n}`, order_id: order.order_id, sender, text, created_at: minutesAgo(at), ...extra };
}

export function buildDemoSeed(presets: CategoryPreset[], inventory: InventoryItem[]): SeedEntry[] {
  const preset = (c: OrderPayload['craft_category']) => presets.find((p) => p.category === c)!;

  // 1. Sling bag with sketch → fully quoted, waiting for the crafter.
  const bag = createDraftOrder('+6281234567001', 'Rina Wijaya', 'bespoke_bag');
  bag.order_id = 'ORD-DEMO-BAG01';
  bag.created_at = minutesAgo(95);
  const bagSpec: Specifications = {
    ...emptySpecifications(),
    construction_type: 'SLING_BAG',
    pocket_layout: { ...emptySpecifications().pocket_layout, interior_zip_pockets: 1 },
    finish: { ...emptySpecifications().finish, edge_treatment: 'BURNISHED', thread_color: 'natural', thread_material: 'waxed linen', stitch_pattern: 'saddle stitch', strap: 'Detachable full-leather strap', hardware_notes: 'Gold turn-lock clasp' },
    customization: { type: 'EMBOSS_INITIALS', detail: 'RW', placement: 'bottom-right corner' },
    silhouette: 'Sling bag with flap & turn-lock',
    target_capacity: 'Muat iPad mini, dompet & HP',
    dimensions_cm: { length: 30, width: 10, height: 22 },
    exterior_leather: 'Veg-Tan Brown 1.6mm',
    lining_material: 'Suede lining (pigskin)',
    structure_temper: 'Semi-structured',
    stitching_method: 'Hand saddle stitch, 3.38mm pitch',
    edge_finish: 'Burnished edge',
  };
  const bagQuote = assembleQuote(templatePattern(bagSpec, preset('bespoke_bag')), bagSpec, inventory, preset('bespoke_bag'));
  Object.assign(bag, {
    session_state: 'PENDING_CRAFTER_APPROVAL',
    specifications: bagSpec,
    material_sourcing: bagQuote.material_sourcing,
    pattern_and_bom: bagQuote.pattern_and_bom,
    media_assets: {
      original_sketch_url: renderDemoSketchSvg(),
      ai_generated_mockup_url: renderConceptSvg('bespoke_bag', bagSpec),
    },
  } satisfies Partial<OrderPayload>);

  const bagMessages = [
    msg(bag, 1, 'CLIENT', 'Halo kak, mau pesan sling bag custom dong', 94),
    msg(bag, 2, 'CLIENT', 'Ini sketsanya', 93, { media_type: 'image', media_url: bag.media_assets.original_sketch_url, media_mime_type: 'image/svg+xml' }),
    msg(bag, 3, 'AI', 'Terima kasih kak Rina! 🙏 Boleh info jenis & warna kulit yang diinginkan?', 92),
    msg(bag, 4, 'CLIENT', 'Veg-tan coklat 1.6mm, ukuran 30x10x22, jahit tangan ya. Muat iPad mini, dompet & HP', 90),
    msg(bag, 5, 'AI', 'Siap kak! Spesifikasi sudah lengkap dan sedang ditinjau crafter kami. Penawaran resmi akan kami kirim segera ✨', 89),
  ];

  // 2. Wallet → client asked for a human, AI is fully paused.
  const wallet = createDraftOrder('+6281234567002', 'Budi Santoso', 'bespoke_wallet');
  wallet.order_id = 'ORD-DEMO-WAL01';
  wallet.created_at = minutesAgo(40);
  Object.assign(wallet, {
    session_state: 'REQUIREMENT_GATHERING',
    automation_mode: 'FULL_MANUAL',
    escalation_reason: 'CLIENT_REQUEST',
    specifications: {
      ...wallet.specifications,
      construction_type: 'BIFOLD_WALLET',
      silhouette: 'Bifold wallet',
      exterior_leather: 'Epsom Etoupe',
      ...preset('bespoke_wallet').defaults,
    },
  } satisfies Partial<OrderPayload>);
  const walletMessages = [
    msg(wallet, 1, 'CLIENT', 'Mau dompet bifold Epsom etoupe', 39),
    msg(wallet, 2, 'AI', 'Terima kasih kak Budi! Boleh info ukuran perkiraan (P x L x T dalam cm)?', 38),
    msg(wallet, 3, 'CLIENT', 'Bisa bicara dengan admin langsung? Mau tanya grafir inisial', 36),
    msg(wallet, 4, 'SYSTEM', 'Baik kak, percakapan ini kami teruskan ke crafter kami. Mohon ditunggu sebentar ya 🙏', 36),
    msg(wallet, 5, 'CLIENT', 'Inisial "BS" di pojok kanan bawah bisa?', 35, { awaiting_crafter_review: true }),
  ];

  // 3. Derby shoes → approved last week.
  const shoes = createDraftOrder('+6281234567003', 'Andi Pratama', 'bespoke_shoes');
  shoes.order_id = 'ORD-DEMO-SHO01';
  shoes.created_at = minutesAgo(60 * 24 * 6);
  const shoeSpec: Specifications = {
    ...emptySpecifications(),
    construction_type: 'DERBY_SHOES',
    silhouette: 'Derby',
    target_capacity: 'EU 42, wide fit',
    dimensions_cm: { length: 28, width: 10.5, height: 12 },
    exterior_leather: 'Crazy Horse Cognac 1.8mm',
    ...preset('bespoke_shoes').defaults,
  };
  const shoeQuote = assembleQuote(templatePattern(shoeSpec, preset('bespoke_shoes')), shoeSpec, inventory, preset('bespoke_shoes'));
  Object.assign(shoes, {
    session_state: 'APPROVED',
    specifications: shoeSpec,
    material_sourcing: shoeQuote.material_sourcing,
    pattern_and_bom: shoeQuote.pattern_and_bom,
    media_assets: { ai_generated_mockup_url: renderConceptSvg('bespoke_shoes', shoeSpec) },
  } satisfies Partial<OrderPayload>);
  const shoeMessages = [
    msg(shoes, 1, 'CLIENT', 'Mau derby crazy horse cognac ukuran 42 ya', 60 * 24 * 6),
    msg(shoes, 2, 'AI', 'Siap kak Andi! Spesifikasi sudah lengkap dan sedang ditinjau crafter kami.', 60 * 24 * 6 - 1),
  ];

  const conv = (o: OrderPayload): Conversation => ({
    phone_number: o.client_info.phone_number,
    client_name_wa: o.client_info.client_name_wa,
    active_order_id: o.order_id,
    confusion_strikes: 0,
    updated_at: o.created_at,
  });

  return [
    { order: bag, conversation: conv(bag), messages: bagMessages },
    { order: wallet, conversation: conv(wallet), messages: walletMessages },
    { order: shoes, conversation: conv(shoes), messages: shoeMessages },
  ];
}
