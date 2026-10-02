import type { NextRequest } from 'next/server';
import { getStore } from '@/lib/gcp/firestore';
import { currentAngles } from '@/lib/mockups';
import { angleDef } from '@/lib/spec/angles';
import { schemaOf } from '@/lib/spec/catalog';
import { modelLine, specLines } from '@/lib/spec/describe';
import type { CraftCategory, MockupAngle } from '@/lib/types';
import { formatIDR } from '@/lib/utils/format';
import { sendToClient } from '@/lib/whatsapp';

/** Base production time per category, before any special-sourcing delay. */
const LEAD_DAYS: Record<CraftCategory, number> = { SMALL_GOODS: 7, BAG: 14, FOOTWEAR: 30, FURNITURE: 45, CUSTOM_GENERIC: 14 };

const mimeOf = (url: string) => (url.startsWith('data:') ? url.slice(5, url.indexOf(';')) : 'image/png');

/**
 * Crafter approval → formal quotation sent to the client over WhatsApp, followed by the selected mockup angles.
 * Body: { quotation_idr?, note?, angles? }
 *   angles  which rendered angles go to the client (default: every rendered angle); [] sends the quote without images.
 * The quote text carries a link to /gallery/<order_id>, a client-facing page with the approved angles.
 */
export async function POST(request: NextRequest, ctx: RouteContext<'/api/orders/[id]/approve'>) {
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as { quotation_idr?: number; note?: string; angles?: MockupAngle[] };

  const store = getStore();
  const order = await store.getOrder(id);
  if (!order) return Response.json({ error: 'Order not found' }, { status: 404 });
  if (order.session_state === 'APPROVED') return Response.json({ error: 'Order already approved' }, { status: 409 });
  if (!order.pattern_and_bom.components_breakdown.length) {
    return Response.json({ error: 'Order has no BOM yet; complete the specification first' }, { status: 409 });
  }

  const rendered = currentAngles(order);
  const wanted = body.angles ?? rendered.map((r) => r.angle);
  const gallery = rendered.filter((r) => wanted.includes(r.angle));
  const galleryUrl = gallery.length ? `${process.env.PUBLIC_BASE_URL ?? request.nextUrl.origin}/gallery/${order.order_id}` : null;

  if (typeof body.quotation_idr === 'number' && body.quotation_idr > 0) order.pattern_and_bom.suggested_quotation_idr = Math.round(body.quotation_idr);
  order.session_state = 'APPROVED';
  order.media_assets.approved_angles = gallery.map((r) => r.angle);
  await store.saveOrder(order);

  const s = order.specifications;
  const src = order.material_sourcing;
  const leadDays = LEAD_DAYS[s.category] + src.additional_lead_days;
  const text = [
    `*PENAWARAN RESMI — ${order.order_id}*`,
    `Halo kak ${order.client_info.client_name_wa}, berikut penawaran dari workshop kami:`,
    '',
    `• Produk: ${modelLine(s)}`,
    ...specLines(s),
    `• ${schemaOf(s.category).material_label} terpakai: ±${order.pattern_and_bom.estimated_material_sqft} sqft`,
    src.status === 'SPECIAL_SOURCING_NEEDED' ? `• Material perlu dipesan khusus (+${src.additional_lead_days} hari)` : '• Material tersedia di workshop',
    s.dimension_mode === 'PENDING_SITE_VISIT' ? '• Harga sementara: final setelah survei ukur ke lokasi (biaya survei sudah termasuk)' : null,
    s.dimension_mode === 'REFERENCE_BASED' ? `• Ukuran mengacu pada ${s.reference_object}; mohon konfirmasi sebelum produksi` : null,
    '',
    `*Harga: ${formatIDR(order.pattern_and_bom.suggested_quotation_idr)}*`,
    `Estimasi pengerjaan: ±${leadDays} hari setelah DP 50%.`,
    galleryUrl ? `\n📸 Mockup desain (${gallery.length} tampilan) kami kirim di bawah ini, atau lihat galerinya: ${galleryUrl}` : null,
    body.note?.trim() ? `\nCatatan crafter: ${body.note.trim()}` : null,
  ]
    .filter((line) => line !== null)
    .join('\n');

  await sendToClient(order, 'CRAFTER', text);
  for (const [i, r] of gallery.entries()) {
    const caption = `📸 ${i + 1}/${gallery.length} · ${angleDef(s.category, r.angle, s.construction_type).label_id}${r.engine === 'offline-svg' ? ' (sketsa konsep)' : ''}`;
    await sendToClient(order, 'CRAFTER', caption, { type: 'image', url: r.url, mime_type: mimeOf(r.url) });
  }

  return Response.json({ order, quotation_message: text, gallery_url: galleryUrl, sent_angles: gallery.map((r) => r.angle) });
}
