import type { NextRequest } from 'next/server';
import { runOrchestrator } from '@/lib/agents/orchestrator';
import { getStore } from '@/lib/gcp/firestore';
import type { AutomationMode } from '@/lib/types';
import { getDebouncer } from '@/lib/utils/debounce';
import { setAutomationMode } from '@/lib/utils/takeover';

const MODES: AutomationMode[] = ['AI_COPILOT', 'PARTIAL_PAUSE', 'FULL_MANUAL'];

/**
 * Crafter takeover switch (dashboard button / simulator toggle).
 * Body: { mode, pause_minutes? }. Handing back to AI_COPILOT lets the AI answer
 * any client message that arrived during the takeover.
 */
export async function POST(request: NextRequest, ctx: RouteContext<'/api/orders/[id]/takeover'>) {
  const { id } = await ctx.params;
  const { mode, pause_minutes } = (await request.json().catch(() => ({}))) as { mode?: AutomationMode; pause_minutes?: number };
  if (!mode || !MODES.includes(mode)) return Response.json({ error: `mode must be one of ${MODES.join(', ')}` }, { status: 400 });

  const store = getStore();
  const order = await store.getOrder(id);
  if (!order) return Response.json({ error: 'Order not found' }, { status: 404 });

  setAutomationMode(order, mode, mode === 'AI_COPILOT' ? undefined : 'CRAFTER_OVERRIDE', pause_minutes);
  // handing back to the AI is a deliberate crafter decision: it gets a fresh turn budget for this session
  if (mode === 'AI_COPILOT' && order.intake) order.intake = { ...order.intake, session_turn_count: 0 };
  await store.saveOrder(order);

  const messages = await store.listMessages(id);
  if (mode === 'AI_COPILOT') {
    await Promise.all(
      messages.filter((m) => m.awaiting_crafter_review).map((m) => store.updateMessage(id, m.id, { awaiting_crafter_review: false })),
    );
    const conversation = await store.getConversation(order.client_info.phone_number);
    if (conversation?.confusion_strikes) await store.saveConversation({ ...conversation, confusion_strikes: 0 });
    // Catch up on an unanswered client message.
    if (messages.at(-1)?.sender === 'CLIENT' && order.session_state !== 'APPROVED') {
      void runOrchestrator(id).catch((err) => console.error('[takeover] resume run failed:', err));
    }
  } else {
    getDebouncer().cancel(id);
  }

  return Response.json({ order });
}
