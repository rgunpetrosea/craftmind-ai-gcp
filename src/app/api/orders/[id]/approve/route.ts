import type { NextRequest } from 'next/server';
import { getStore } from '@/lib/gcp/firestore';
import { schemaOf } from '@/lib/spec/catalog';
import { modelLine, specLines } from '@/lib/spec/describe';
import type { CraftCategory } from '@/lib/types';
import { formatIDR } from '@/lib/utils/format';

/** Base production time per category, before any special-sourcing delay. */
const LEAD_DAYS: Record<CraftCategory, number> = { SMALL_GOODS: 7, BAG: 14, FOOTWEAR: 30, FURNITURE: 45, CUSTOM_GENERIC: 14 };
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
  const leadDays = LEAD_DAYS[s.category] + src.additional_lead_days;
  const text = [
    `*PENAWARAN RESMI — ${order.order_id}*`,
    `Halo kak ${order.client_info.client_name_wa}, berikut penawaran dari workshop kami:`,
    '',
    `• Produk: ${modelLine(s)}`,
    ...specLines(s),
    `• ${schemaOf(s.category).material_label} terpakai: ±${order.pattern_and_bom.estimated_material_sqft} sqft`,
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
