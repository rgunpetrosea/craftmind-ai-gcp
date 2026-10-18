import type { NextRequest } from 'next/server';
import { orderHidden } from '@/lib/auth';
import { runOrchestrator } from '@/lib/agents/orchestrator';
import { getStore } from '@/lib/gcp/firestore';

/** Run the multi-agent pipeline for an order immediately (bypasses the debounce). */
export async function POST(request: NextRequest) {
  const { order_id, force } = (await request.json().catch(() => ({}))) as { order_id?: string; force?: boolean };
  if (!order_id) return Response.json({ error: 'order_id is required' }, { status: 400 });
  const order = await getStore().getOrder(order_id);
  if (!order || orderHidden(request, order)) return Response.json({ error: 'Order not found' }, { status: 404 });

  const result = await runOrchestrator(order_id, { force: Boolean(force) });
  return Response.json(result);
}
