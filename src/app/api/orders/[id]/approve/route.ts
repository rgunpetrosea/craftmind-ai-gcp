import type { NextRequest } from 'next/server';
import { orderHidden } from '@/lib/auth';
import { getStore } from '@/lib/gcp/firestore';
import { currentAngles } from '@/lib/mockups';
import { angleDef } from '@/lib/spec/angles';
import { schemaOf } from '@/lib/spec/catalog';
import { blankReview } from '@/lib/design-review';
import { designLines, modelLine, specLines } from '@/lib/spec/describe';
import type { CraftCategory, MockupAngle } from '@/lib/types';
import { formatIDR, nowIso } from '@/lib/utils/format';
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
  if (!order || orderHidden(request, order)) return Response.json({ error: 'Order not found' }, { status: 404 });
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
  // approving the quotation signs off the design concept too (held renders included in `angles` are released with it)
  order.design_review = { ...(order.design_review ?? blankReview()), crafter_status: 'APPROVED', held_angles: undefined, updated_at: nowIso() };
  await store.saveOrder(order);

  const s = order.specifications;
  const src = order.material_sourcing;
  const leadDays = LEAD_DAYS[s.category] + src.additional_lead_days;
  const text = [
    `*OFFICIAL QUOTATION — ${order.order_id}*`,
    `Hi ${order.client_info.client_name_wa}, here is our workshop's quotation:`,
    '',
    `• Product: ${modelLine(s)}`,
    ...designLines(s),
    ...specLines(s),
    `• ${schemaOf(s.category).material_label} used: ±${order.pattern_and_bom.estimated_material_sqft} sqft`,
    src.status === 'SPECIAL_SOURCING_NEEDED' ? `• Material needs special sourcing (+${src.additional_lead_days} days)` : '• Material in stock at the workshop',
    s.dimension_mode === 'PENDING_SITE_VISIT' ? '• Provisional price: final after the on-site measurement visit (visit fee included)' : null,
    s.dimension_mode === 'REFERENCE_BASED' ? `• Size based on ${s.reference_object}; please confirm before production` : null,
    '',
    `*Price: ${formatIDR(order.pattern_and_bom.suggested_quotation_idr)}*`,
    `Estimated lead time: ±${leadDays} days after a 50% deposit.`,
    galleryUrl ? `\n📸 Design mockups (${gallery.length} views) are below, or view the gallery: ${galleryUrl}` : null,
    body.note?.trim() ? `\nCrafter's note: ${body.note.trim()}` : null,
  ]
    .filter((line) => line !== null)
    .join('\n');

  await sendToClient(order, 'CRAFTER', text);
  for (const [i, r] of gallery.entries()) {
    const caption = `📸 ${i + 1}/${gallery.length} · ${angleDef(s.category, r.angle, s.construction_type).label}${r.engine === 'offline-svg' ? ' (concept sketch)' : ''}`;
    await sendToClient(order, 'CRAFTER', caption, { type: 'image', url: r.url, mime_type: mimeOf(r.url) });
  }

  return Response.json({ order, quotation_message: text, gallery_url: galleryUrl, sent_angles: gallery.map((r) => r.angle) });
}
