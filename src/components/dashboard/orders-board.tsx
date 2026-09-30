'use client';

import { Inbox, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { usePoll } from '@/lib/hooks/use-poll';
import type { SessionState } from '@/lib/types';
import { OrderCard, type OrderRow } from './order-card';
import { OrderDetail } from './order-detail';

const GROUPS: Array<{ title: string; match: (r: OrderRow) => boolean }> = [
  { title: 'Needs you', match: (r) => r.order.automation_mode === 'FULL_MANUAL' || r.awaiting_review_count > 0 },
  { title: 'Pending approval', match: (r) => r.order.session_state === 'PENDING_CRAFTER_APPROVAL' },
  { title: 'Gathering requirements', match: (r) => (['IDLE', 'REQUIREMENT_GATHERING'] as SessionState[]).includes(r.order.session_state) },
  { title: 'Approved', match: (r) => r.order.session_state === 'APPROVED' },
];

export function OrdersBoard() {
  const { data, refresh } = usePoll<{ orders: OrderRow[] }>('/api/orders', 3000);
  const [picked, setPicked] = useState<string | null>(null);
  const rows = data?.orders ?? [];
  const selected = picked ?? rows[0]?.order.order_id ?? null;

  // Each order appears once, in the first group it matches.
  const seen = new Set<string>();
  const grouped = GROUPS.map((g) => {
    const items = rows.filter((r) => !seen.has(r.order.order_id) && g.match(r));
    items.forEach((r) => seen.add(r.order.order_id));
    return { ...g, items };
  });

  return (
    <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
      <aside className="space-y-5">
        {!data && (
          <div className="flex justify-center py-10 text-stone-400">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        )}
        {data && rows.length === 0 && (
          <div className="flex flex-col items-center gap-2 rounded-xl bg-white p-8 text-center text-sm text-stone-500 ring-1 ring-stone-200">
            <Inbox className="h-6 w-6" /> No conversations yet. Send a message from the simulator.
          </div>
        )}
        {grouped
          .filter((g) => g.items.length)
          .map((g) => (
            <div key={g.title} className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">
                {g.title} <span className="text-stone-400">({g.items.length})</span>
              </p>
              {g.items.map((row) => (
                <OrderCard key={row.order.order_id} row={row} selected={row.order.order_id === selected} onSelect={() => setPicked(row.order.order_id)} />
              ))}
            </div>
          ))}
      </aside>
      <section className="min-w-0">{selected && <OrderDetail key={selected} orderId={selected} onChanged={refresh} />}</section>
    </div>
  );
}
