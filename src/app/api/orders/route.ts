import type { NextRequest } from 'next/server';
import { workspaceFromRequest } from '@/lib/auth';
import { getStore } from '@/lib/gcp/firestore';
import type { CraftFamily } from '@/lib/types';
import { expirePartialPause } from '@/lib/utils/takeover';

const FAMILIES: CraftFamily[] = ['LEATHER', 'FURNITURE'];

/**
 * Draft orders board of ONE workspace (the session's, else ?workspace_id=, else the default). Empty drafts are hidden.
 * ?family=LEATHER|FURNITURE narrows it to one trade.
 */
export async function GET(request: NextRequest) {
  const ws = workspaceFromRequest(request);
  if ('error' in ws) return ws.error;
  const store = getStore();
  const family = request.nextUrl.searchParams.get('family')?.toUpperCase() as CraftFamily | undefined;
  const orders = await store.listOrders({ crafterId: ws.workspaceId, family: family && FAMILIES.includes(family) ? family : undefined });
  const rows = await Promise.all(
    orders.map(async (order) => {
      if (expirePartialPause(order)) await store.saveOrder(order);
      const messages = await store.listMessages(order.order_id);
      const last = messages.at(-1);
      return {
        order,
        message_count: messages.length,
        awaiting_review_count: messages.filter((m) => m.awaiting_crafter_review).length,
        last_message: last ? { sender: last.sender, text: last.text ?? `[${last.media_type}]`, created_at: last.created_at } : null,
      };
    }),
  );
  return Response.json({ orders: rows.filter((r) => r.message_count > 0) });
}
