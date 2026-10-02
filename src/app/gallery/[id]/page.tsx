/* eslint-disable @next/next/no-img-element -- renders are data URLs or GCS objects */
import { notFound } from 'next/navigation';
import { getStore } from '@/lib/gcp/firestore';
import { currentAngles } from '@/lib/mockups';
import { angleDef } from '@/lib/spec/angles';
import { modelLine, specLines } from '@/lib/spec/describe';
import { formatIDR } from '@/lib/utils/format';

// Reads live order data (in-memory or Firestore) on every request.
export const dynamic = 'force-dynamic';

/**
 * Client-facing mockup gallery linked from the WhatsApp quotation. Shows only the angles the crafter approved for
 * sending; nothing is visible before approval.
 */
export default async function GalleryPage(props: PageProps<'/gallery/[id]'>) {
  const { id } = await props.params;
  const order = await getStore().getOrder(id);
  const approved = order?.media_assets.approved_angles ?? [];
  if (!order || order.session_state !== 'APPROVED' || !approved.length) notFound();

  const renders = currentAngles(order).filter((r) => approved.includes(r.angle));
  const s = order.specifications;

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-leather-500">Mockup desain · {order.order_id}</p>
      <h1 className="mt-1 text-3xl font-bold text-stone-900">{modelLine(s)}</h1>
      <p className="mt-1 text-sm text-stone-500">
        Untuk kak {order.client_info.client_name_wa} · Penawaran {formatIDR(order.pattern_and_bom.suggested_quotation_idr)}
      </p>

      <div className="mt-8 grid gap-6 md:grid-cols-2">
        {renders.map((r, i) => (
          <figure key={r.angle} className={i === 0 ? 'md:col-span-2' : ''}>
            <div className="overflow-hidden rounded-2xl bg-stone-100 ring-1 ring-stone-200">
              <img src={r.url} alt={angleDef(s.category, r.angle, s.construction_type).label_id} className="h-full w-full object-contain" />
            </div>
            <figcaption className="mt-2 text-sm text-stone-600">
              {i + 1}. {angleDef(s.category, r.angle, s.construction_type).label_id}
              {r.engine === 'offline-svg' && <span className="text-stone-400"> (sketsa konsep)</span>}
            </figcaption>
          </figure>
        ))}
      </div>

      <section className="mt-10 rounded-2xl bg-white p-6 ring-1 ring-stone-200">
        <h2 className="text-sm font-semibold text-stone-800">Spesifikasi</h2>
        <ul className="mt-3 grid gap-1 text-sm text-stone-700 sm:grid-cols-2">
          {specLines(s).map((line) => (
            <li key={line}>{line.replace(/^• /, '')}</li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-stone-500">Mockup adalah visualisasi desain; hasil akhir buatan tangan dapat sedikit berbeda.</p>
      </section>
    </div>
  );
}
