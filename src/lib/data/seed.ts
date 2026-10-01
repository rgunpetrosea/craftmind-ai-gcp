import { templatePattern } from '@/lib/agents/pattern-agent';
import { assembleQuote } from '@/lib/agents/pricing';
import { createDraftOrder } from '@/lib/orders';
import { emptySpecifications, finalizeSpecifications } from '@/lib/spec/catalog';
import type {
  BagSpec,
  CategoryPreset,
  ChatMessage,
  Conversation,
  FootwearSpec,
  FurnitureSpec,
  InventoryItem,
  OrderPayload,
  SmallGoodsSpec,
  Specifications,
} from '@/lib/types';
import { renderConceptSvg, renderDemoSketchSvg } from '@/lib/utils/svg';

/** Demo orders (one per main category) so the in-memory dashboard is populated on first load. */

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
  const presetOf = (c: OrderPayload['craft_category']) => presets.find((p) => p.category === c)!;

  /** Lock the spec with workshop defaults and attach BOM, sourcing, quote and an offline concept render. */
  function quote(order: OrderPayload, raw: Specifications, withMockup = true) {
    const preset = presetOf(raw.category);
    const spec = finalizeSpecifications(raw, preset.defaults);
    const q = assembleQuote(templatePattern(spec, preset), spec, inventory, preset);
    Object.assign(order, {
      craft_category: spec.category,
      specifications: spec,
      material_sourcing: q.material_sourcing,
      pattern_and_bom: q.pattern_and_bom,
      media_assets: { ...order.media_assets, ...(withMockup && { ai_generated_mockup_url: renderConceptSvg(spec), mockup_engine: 'offline-svg' as const }) },
    } satisfies Partial<OrderPayload>);
  }

  // 1. Sling bag with sketch → fully quoted, waiting for the crafter.
  const bag = createDraftOrder('+6281234567001', 'Rina Wijaya');
  bag.order_id = 'ORD-DEMO-BAG01';
  bag.created_at = minutesAgo(95);
  bag.session_state = 'PENDING_CRAFTER_APPROVAL';
  bag.media_assets.original_sketch_url = renderDemoSketchSvg();
  const bagSpec: BagSpec = {
    ...(emptySpecifications('BAG') as BagSpec),
    construction_type: 'SLING_BAG',
    model_name: 'Sling bag flap kunci putar',
  };
  Object.assign(bagSpec.attributes, {
    dimensions_cm: { length: 30, width: 10, height: 22 },
    target_capacity: 'iPad mini, dompet & HP',
    exterior_leather: 'Veg-Tan Brown 1.6mm',
    main_closure: 'TURN_LOCK_FLAP',
    strap_type: 'DETACHABLE_LEATHER',
    hardware: 'Gold turn-lock',
    stitching_method: 'Hand saddle stitch',
    embossing_type: 'EMBOSS_INITIALS',
    embossing_text: 'RW',
    embossing_placement: 'pojok kanan bawah',
  } satisfies Partial<BagSpec['attributes']>);
  quote(bag, bagSpec);
  const bagMessages = [
    msg(bag, 1, 'CLIENT', 'Halo kak, mau pesan sling bag custom dong', 94),
    msg(bag, 2, 'CLIENT', 'Ini sketsanya', 93, { media_type: 'image', media_url: bag.media_assets.original_sketch_url, media_mime_type: 'image/svg+xml' }),
    msg(bag, 3, 'AI', 'Terima kasih kak Rina! 🙏 Boleh info jenis & warna kulit yang diinginkan?', 92),
    msg(bag, 4, 'CLIENT', 'Veg-tan coklat 1.6mm, ukuran 30x10x22, jahit tangan, tali lepas pasang ya. Inisial RW di pojok kanan bawah', 90),
    msg(bag, 5, 'AI', 'Siap kak! Spesifikasi sudah lengkap dan sedang ditinjau crafter kami. Penawaran resmi akan kami kirim segera ✨', 89),
  ];

  // 2. Wallet → client asked for a human, AI is fully paused.
  const wallet = createDraftOrder('+6281234567002', 'Budi Santoso');
  wallet.order_id = 'ORD-DEMO-WAL01';
  wallet.created_at = minutesAgo(40);
  const walletSpec: SmallGoodsSpec = { ...(emptySpecifications('SMALL_GOODS') as SmallGoodsSpec), construction_type: 'BIFOLD_WALLET', model_name: 'Dompet bifold' };
  walletSpec.attributes.exterior_leather = 'Epsom Etoupe';
  Object.assign(wallet, {
    craft_category: 'SMALL_GOODS',
    specifications: walletSpec,
    session_state: 'REQUIREMENT_GATHERING',
    automation_mode: 'FULL_MANUAL',
    escalation_reason: 'CLIENT_REQUEST',
  } satisfies Partial<OrderPayload>);
  const walletMessages = [
    msg(wallet, 1, 'CLIENT', 'Mau dompet bifold Epsom etoupe', 39),
    msg(wallet, 2, 'AI', 'Terima kasih kak Budi! Boleh info ukuran perkiraan dan jumlah slot kartunya?', 38),
    msg(wallet, 3, 'CLIENT', 'Bisa bicara dengan admin langsung? Mau tanya grafir inisial', 36),
    msg(wallet, 4, 'SYSTEM', 'Baik kak, percakapan ini kami teruskan ke crafter kami. Mohon ditunggu sebentar ya 🙏', 36),
    msg(wallet, 5, 'CLIENT', 'Inisial "BS" di pojok kanan bawah bisa?', 35, { awaiting_crafter_review: true }),
  ];

  // 3. Derby shoes → approved last week.
  const shoes = createDraftOrder('+6281234567003', 'Andi Pratama');
  shoes.order_id = 'ORD-DEMO-SHO01';
  shoes.created_at = minutesAgo(60 * 24 * 6);
  shoes.session_state = 'APPROVED';
  const shoeSpec: FootwearSpec = { ...(emptySpecifications('FOOTWEAR') as FootwearSpec), construction_type: 'DERBY_SHOES', model_name: 'Derby crazy horse' };
  Object.assign(shoeSpec.attributes, {
    eu_size: 42,
    width_fit: 'WIDE',
    upper_material: 'Crazy Horse Cognac 1.8mm',
    outsole_type: 'DAINITE',
    welt_method: 'GOODYEAR',
  } satisfies Partial<FootwearSpec['attributes']>);
  quote(shoes, shoeSpec);
  const shoeMessages = [
    msg(shoes, 1, 'CLIENT', 'Mau derby crazy horse cognac ukuran 42, kaki saya lebar, sol dainite ya', 60 * 24 * 6),
    msg(shoes, 2, 'AI', 'Siap kak Andi! Spesifikasi sudah lengkap dan sedang ditinjau crafter kami.', 60 * 24 * 6 - 1),
  ];

  // 4. Teak dining table → furniture schema (no leather fields at all), pending approval.
  const table = createDraftOrder('+6281234567004', 'Maya Kusuma');
  table.order_id = 'ORD-DEMO-FUR01';
  table.created_at = minutesAgo(180);
  table.session_state = 'PENDING_CRAFTER_APPROVAL';
  const tableSpec: FurnitureSpec = { ...(emptySpecifications('FURNITURE') as FurnitureSpec), construction_type: 'DINING_TABLE', model_name: 'Meja makan jati 6 kursi' };
  Object.assign(tableSpec.attributes, {
    dimensions_cm: { length: 180, width: 90, height: 75 },
    primary_material: 'Jati (teak) grade A',
    secondary_material: 'kaki besi hollow',
    finish_coating: 'NATURAL_OIL',
    joinery_type: 'MORTISE_TENON',
    seating_capacity: 6,
  } satisfies Partial<FurnitureSpec['attributes']>);
  tableSpec.custom_fields = [{ id: 'cf-seed-1', label: 'Sudut meja', value: 'Dibulatkan radius 5 cm (ada balita)', surcharge_idr: 0, source: 'AI' }];
  quote(table, tableSpec);
  const tableMessages = [
    msg(table, 1, 'CLIENT', 'Mas, bisa bikin meja makan jati grade A 180x90x75 untuk 6 kursi? Kakinya besi hollow', 180),
    msg(table, 2, 'AI', 'Bisa kak Maya! Untuk finishing mau natural oil atau PU varnish? Sambungannya kami sarankan purus (mortise-tenon) supaya kokoh.', 179),
    msg(table, 3, 'CLIENT', 'Natural oil aja, purus boleh. Sudutnya tolong dibulatkan ya ada balita', 175),
    msg(table, 4, 'AI', 'Siap kak! Spesifikasi sudah lengkap dan sedang ditinjau crafter kami ✨', 174),
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
    { order: table, conversation: conv(table), messages: tableMessages },
  ];
}
