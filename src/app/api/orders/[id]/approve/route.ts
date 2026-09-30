import type { NextRequest } from 'next/server';
import { getStore } from '@/lib/gcp/firestore';
import { formatIDR } from '@/lib/utils/format';
import { sendToClient } from '@/lib/whatsapp';

/**
 * Crafter approval → formal quotation sent to the client over WhatsApp.
 * Body: { quotation_idr?, note? } lets the crafter adjust the AI-suggested price.
 */
export async function POST(request: NextRequest, ctx: RouteContext<'/api/orders/[id]/approve'>) {
  const { id } = await ctx.params;
  const { quotation_idr, note } = (await request.json().catch(() => ({}))) as { quotation_idr?: number; note?: string };

  const store = getStore();
  const order = await store.getOrder(id);
  if (!order) return Response.json({ error: 'Order not found' }, { status: 404 });
  if (order.session_state === 'APPROVED') return Response.json({ error: 'Order already approved' }, { status: 409 });
  if (!order.pattern_and_bom.components_breakdown.length) {
    return Response.json({ error: 'Order has no BOM yet; complete the specification first' }, { status: 409 });
  }

  if (typeof quotation_idr === 'number' && quotation_idr > 0) order.pattern_and_bom.suggested_quotation_idr = Math.round(quotation_idr);
  order.session_state = 'APPROVED';
  await store.saveOrder(order);

  const s = order.specifications;
  const src = order.material_sourcing;
  const leadDays = 14 + src.additional_lead_days;
  const text = [
    `*PENAWARAN RESMI — ${order.order_id}*`,
    `Halo kak ${order.client_info.client_name_wa}, berikut penawaran dari workshop kami:`,
    '',
    `• Produk: ${s.silhouette}`,
    `• Ukuran: ${s.dimensions_cm.length} x ${s.dimensions_cm.width} x ${s.dimensions_cm.height} cm`,
    `• Kulit: ${s.exterior_leather} (${order.pattern_and_bom.estimated_leather_sqft} sqft)`,
    `• Lining: ${s.lining_material}`,
    `• Jahitan & finishing: ${s.stitching_method}, ${s.edge_finish}`,
    src.status === 'SPECIAL_SOURCING_NEEDED' ? `• Material perlu dipesan khusus (+${src.additional_lead_days} hari)` : '• Material tersedia di workshop',
    '',
    `*Harga: ${formatIDR(order.pattern_and_bom.suggested_quotation_idr)}*`,
    `Estimasi pengerjaan: ±${leadDays} hari setelah DP 50%.`,
    note?.trim() ? `\nCatatan crafter: ${note.trim()}` : null,
  ]
    .filter((line) => line !== null)
    .join('\n');

  const mockup = order.media_assets.ai_generated_mockup_url;
  const mime = mockup?.startsWith('data:') ? mockup.slice(5, mockup.indexOf(';')) : 'image/png';
  await sendToClient(order, 'CRAFTER', text, mockup ? { type: 'image', url: mockup, mime_type: mime } : undefined);

  return Response.json({ order, quotation_message: text });
}
