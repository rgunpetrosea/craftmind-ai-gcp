import { getStore } from '@/lib/gcp/firestore';
import { expirePartialPause } from '@/lib/utils/takeover';

/** Draft orders board. Empty drafts (no messages yet) are hidden. */
export async function GET() {
  const store = getStore();
  const orders = await store.listOrders();
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
