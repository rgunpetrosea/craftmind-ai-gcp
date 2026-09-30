import { getStore } from '@/lib/gcp/firestore';
import type { ChatMessage, MessageMediaType, OrderPayload } from '@/lib/types';
import { newId, nowIso } from '@/lib/utils/format';

/**
 * Outbound WhatsApp. Every message is written to the session log (which is
 * what the simulator renders). When WA_ACCESS_TOKEN + WA_PHONE_NUMBER_ID are
 * set, text is also delivered through the WhatsApp Cloud API.
 */
export async function sendToClient(
  order: OrderPayload,
  sender: Exclude<ChatMessage['sender'], 'CLIENT'>,
  text: string,
  media?: { type: MessageMediaType; url: string; mime_type: string },
): Promise<ChatMessage> {
  const message: ChatMessage = {
    id: newId('MSG'),
    order_id: order.order_id,
    sender,
    text,
    created_at: nowIso(),
    ...(media && { media_type: media.type, media_url: media.url, media_mime_type: media.mime_type }),
  };
  await getStore().appendMessage(message);
  await deliverViaCloudApi(order.client_info.phone_number, text).catch((err) =>
    console.error('[whatsapp] Cloud API delivery failed:', err),
  );
  return message;
}

async function deliverViaCloudApi(to: string, body: string): Promise<void> {
  const token = process.env.WA_ACCESS_TOKEN;
  const phoneNumberId = process.env.WA_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) return;
  const version = process.env.WA_GRAPH_VERSION ?? 'v21.0';
  const res = await fetch(`https://graph.facebook.com/${version}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: to.replace(/^\+/, ''), type: 'text', text: { body } }),
  });
  if (!res.ok) throw new Error(`WA Cloud API ${res.status}: ${await res.text()}`);
}
