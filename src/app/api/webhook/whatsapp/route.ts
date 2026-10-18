import type { NextRequest } from 'next/server';
import { unprocessedClientMessages } from '@/lib/agents/intake-agent';
import { isOrchestratorRunning, runOrchestrator, runSilentParse } from '@/lib/agents/orchestrator';
import { getStore } from '@/lib/gcp/firestore';
import { persistInboundMedia } from '@/lib/gcp/gcs';
import { orderHidden } from '@/lib/auth';
import { isConceptRendering } from '@/lib/agents/tools';
import { isRenderingAngles } from '@/lib/mockups';
import { createDraftOrder, isOpenOrder } from '@/lib/orders';
import type { ChatMessage, Conversation, InboundWhatsAppEvent, OrderPayload, WebhookAction } from '@/lib/types';
import { renderTemplate } from '@/lib/spec/guardrails';
import { getDebouncer } from '@/lib/utils/debounce';
import { newId, nowIso } from '@/lib/utils/format';
import { withSessionLock } from '@/lib/utils/session-lock';
import { DEFAULT_CRAFTER_ID, familiesOf, sessionKey } from '@/lib/workspaces';
import {
  detectEscalationKeyword,
  expirePartialPause,
  HANDOFF_MESSAGES,
  isAiBlocked,
  setAutomationMode,
} from '@/lib/utils/takeover';
import { notifyCrafter, sendToClient } from '@/lib/whatsapp';

/**
 * Inbound WhatsApp events (simulator today, WA Cloud API adapter later).
 *
 *   sender=CRAFTER → deliver the crafter's manual reply; auto PARTIAL_PAUSE the AI.
 *   sender=CLIENT  → escalation keyword? → FULL_MANUAL (CLIENT_REQUEST)
 *                    AI blocked?         → log for crafter review, no AI
 *                    otherwise           → adaptive-debounce, then orchestrator
 *
 * Events for one phone number are handled one at a time (session lock); messages buffered within the debounce window
 * are answered by a single orchestrator run with one combined input.
 */

/**
 * Multi-crafter routing: the event's `crafter_id`, else the workspace that owns the WhatsApp business number it was sent
 * to (`to_phone_number_id`), else the default workspace.
 */
async function resolveCrafterId(event: Pick<InboundWhatsAppEvent, 'crafter_id' | 'to_phone_number_id'>): Promise<string> {
  if (event.crafter_id?.trim()) return event.crafter_id.trim();
  if (event.to_phone_number_id) {
    const workspace = await getStore().findWorkspaceByPhoneNumberId(event.to_phone_number_id);
    if (workspace) return workspace.crafter_id;
  }
  return DEFAULT_CRAFTER_ID;
}

/** A new draft in the crafter's workspace (its main trade until the product is classified). */
async function newDraft(phone: string, clientName: string, crafterId: string): Promise<OrderPayload> {
  const profile = await getStore().getCrafterProfile(crafterId);
  return createDraftOrder(phone, clientName, 'CUSTOM_GENERIC', { crafterId, family: familiesOf(profile)[0] });
}

async function resolveSession(phone: string, clientName: string, crafterId: string): Promise<{ order: OrderPayload; conversation: Conversation }> {
  const store = getStore();
  const conversation = await store.getConversation(phone, crafterId);
  const existing = conversation ? await store.getOrder(conversation.active_order_id) : null;
  if (conversation && existing && isOpenOrder(existing)) return { order: existing, conversation };

  const order = await newDraft(phone, conversation?.client_name_wa ?? clientName, crafterId);
  const fresh: Conversation = {
    phone_number: phone,
    client_name_wa: order.client_info.client_name_wa,
    active_order_id: order.order_id,
    confusion_strikes: 0,
    updated_at: nowIso(),
    crafter_id: crafterId,
  };
  await Promise.all([store.saveOrder(order), store.saveConversation(fresh)]);
  return { order, conversation: fresh };
}

function respond(action: WebhookAction, order: OrderPayload, extra: Record<string, unknown> = {}) {
  return Response.json({
    action,
    order_id: order.order_id,
    automation_mode: order.automation_mode,
    paused_until: order.paused_until ?? null,
    escalation_reason: order.escalation_reason ?? null,
    ...extra,
  });
}

/**
 * While a human handles the chat the AI stays quiet but keeps listening: client and crafter messages are batched (same
 * adaptive debounce, separate key) into a silent parse that updates the spec and client brief for the dashboard.
 */
function parseSilently(orderId: string, text?: string) {
  getDebouncer().schedule(`silent:${orderId}`, { text }, () => runSilentParse(orderId));
}

export async function POST(request: NextRequest) {
  let event: InboundWhatsAppEvent;
  try {
    event = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const phone = event.phone_number?.trim();
  if (!phone || (!event.text?.trim() && !event.media?.url)) {
    return Response.json({ error: 'phone_number and text or media are required' }, { status: 400 });
  }
  const store = getStore();
  const targeted = event.sender === 'CRAFTER' && event.order_id ? await store.getOrder(event.order_id) : null;
  if (event.order_id && event.sender === 'CRAFTER' && (!targeted || orderHidden(request, targeted))) return Response.json({ error: 'Order not found' }, { status: 404 });
  // a crafter reply belongs to its order's workspace; a client message is routed to one
  const crafterId = targeted?.crafter_id ?? (await resolveCrafterId(event));
  return withSessionLock(sessionKey(phone, crafterId), () => handleEvent(event, phone, crafterId));
}

async function handleEvent(event: InboundWhatsAppEvent, phone: string, crafterId: string): Promise<Response> {
  const store = getStore();
  const debouncer = getDebouncer();
  const targeted = event.sender === 'CRAFTER' && event.order_id ? await store.getOrder(event.order_id) : null;
  const order = targeted ?? (await resolveSession(phone, event.client_name_wa?.trim() || 'Kak', crafterId)).order;
  let orderDirty = expirePartialPause(order);

  // --- Crafter manual reply -------------------------------------------------
  if (event.sender === 'CRAFTER') {
    if (order.automation_mode === 'AI_COPILOT') {
      setAutomationMode(order, 'PARTIAL_PAUSE', 'CRAFTER_OVERRIDE');
      orderDirty = true;
    }
    debouncer.cancel(order.order_id);
    if (orderDirty) await store.saveOrder(order);
    await sendToClient(order, 'CRAFTER', event.text?.trim() ?? '', event.media && { ...event.media });
    const reviewed = (await store.listMessages(order.order_id)).filter((m) => m.awaiting_crafter_review);
    await Promise.all(reviewed.map((m) => store.updateMessage(order.order_id, m.id, { awaiting_crafter_review: false })));
    parseSilently(order.order_id, event.text);
    return respond('CRAFTER_REPLY_SENT', order);
  }

  // --- Client message -------------------------------------------------------
  const inbound: ChatMessage = {
    id: newId('MSG'),
    order_id: order.order_id,
    sender: 'CLIENT',
    text: event.text?.trim() || undefined,
    created_at: nowIso(),
  };
  if (event.media?.url) {
    inbound.media_type = event.media.type;
    inbound.media_mime_type = event.media.mime_type;
    inbound.media_url = await persistInboundMedia(order.order_id, event.media.url, event.media.mime_type);
    if (event.media.type === 'image') {
      order.media_assets.original_sketch_url = inbound.media_url;
      orderDirty = true;
    }
  }
  if (order.session_state === 'IDLE') {
    order.session_state = 'REQUIREMENT_GATHERING';
    orderDirty = true;
  }

  const keyword = detectEscalationKeyword(inbound.text);
  if (keyword && order.automation_mode !== 'FULL_MANUAL') {
    setAutomationMode(order, 'FULL_MANUAL', 'CLIENT_REQUEST', undefined, undefined, `Klien minta bicara dengan crafter ("${keyword}")`);
    debouncer.cancel(order.order_id);
    await store.saveOrder(order);
    await store.appendMessage({ ...inbound, awaiting_crafter_review: true });
    await sendToClient(order, 'SYSTEM', renderTemplate(HANDOFF_MESSAGES.CLIENT_REQUEST, await store.getCrafterProfile(order.crafter_id)));
    await notifyCrafter(order, order.escalation_note ?? 'Klien minta bicara dengan crafter');
    parseSilently(order.order_id, event.text);
    return respond('ESCALATED_TO_CRAFTER', order, { keyword });
  }

  if (orderDirty) await store.saveOrder(order);

  if (isAiBlocked(order)) {
    await store.appendMessage({ ...inbound, awaiting_crafter_review: true });
    parseSilently(order.order_id, event.text);
    return respond('LOGGED_FOR_CRAFTER', order);
  }

  await store.appendMessage(inbound);
  // re-arms the session's buffer window; the flush answers every message buffered since the last reply in one go
  const { flushAt, delayMs } = debouncer.schedule(order.order_id, inbound, () => runOrchestrator(order.order_id));
  const buffered = unprocessedClientMessages(await store.listMessages(order.order_id), order.intake?.processed_message_id);
  return respond('BUFFERED_FOR_AI', order, {
    flush_at: flushAt,
    debounce_ms: delayMs,
    buffered_messages: buffered.length,
    combined_input: buffered.map((m) => m.text ?? `[${m.media_type ?? 'media'}]`).join(' '),
  });
}

/** Session poll for the simulator: ?phone=+62… (&crafter_id=… outside the default workspace) or ?order_id=ORD-… */
export async function GET(request: NextRequest) {
  const store = getStore();
  const params = request.nextUrl.searchParams;
  const phone = params.get('phone');
  const conversation = phone ? await store.getConversation(phone, params.get('crafter_id') ?? undefined) : null;
  const orderId = params.get('order_id') ?? conversation?.active_order_id;
  if (!orderId) return Response.json({ conversation: null, order: null, messages: [], ai_pending: false });

  const order = await store.getOrder(orderId);
  if (!order) return Response.json({ error: 'Order not found' }, { status: 404 });
  if (expirePartialPause(order)) await store.saveOrder(order);

  return Response.json({
    conversation,
    order,
    messages: await store.listMessages(orderId),
    ai_pending: Boolean(getDebouncer().pendingUntil(orderId)) || isOrchestratorRunning(orderId),
    // the concept render + design-critic job runs in the background: the chat stays open meanwhile
    concept_pending: isConceptRendering(orderId) || isRenderingAngles(orderId),
  });
}

/** Start a fresh draft for this phone number (simulator "new chat"); ?crafter_id=… for another workspace. */
export async function DELETE(request: NextRequest) {
  const phone = request.nextUrl.searchParams.get('phone');
  if (!phone) return Response.json({ error: 'phone is required' }, { status: 400 });
  const crafterId = request.nextUrl.searchParams.get('crafter_id') || DEFAULT_CRAFTER_ID;
  return withSessionLock(sessionKey(phone, crafterId), () => startFreshDraft(phone, crafterId));
}

async function startFreshDraft(phone: string, crafterId: string): Promise<Response> {
  const store = getStore();
  const conversation = await store.getConversation(phone, crafterId);
  if (conversation) getDebouncer().cancel(conversation.active_order_id);
  const order = await newDraft(phone, conversation?.client_name_wa ?? 'Kak', crafterId);
  await store.saveOrder(order);
  await store.saveConversation({
    phone_number: phone,
    client_name_wa: order.client_info.client_name_wa,
    active_order_id: order.order_id,
    confusion_strikes: 0,
    updated_at: nowIso(),
    crafter_id: crafterId,
  });
  return Response.json({ order });
}
