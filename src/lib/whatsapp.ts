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
  await deliverViaCloudApi(order.client_info.phone_number, text, media?.type === 'image' ? media.url : undefined).catch((err) =>
    console.error('[whatsapp] Cloud API delivery failed:', err),
  );
  return message;
}

/** Text, or an image with caption when it has a public https URL (inline data URLs can only be shown in the simulator). */
async function deliverViaCloudApi(to: string, body: string, imageUrl?: string): Promise<void> {
  const token = process.env.WA_ACCESS_TOKEN;
  const phoneNumberId = process.env.WA_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) return;
  const version = process.env.WA_GRAPH_VERSION ?? 'v21.0';
  const res = await fetch(`https://graph.facebook.com/${version}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(
      imageUrl?.startsWith('https://')
        ? { messaging_product: 'whatsapp', to: to.replace(/^\+/, ''), type: 'image', image: { link: imageUrl, caption: body } }
        : { messaging_product: 'whatsapp', to: to.replace(/^\+/, ''), type: 'text', text: { body } },
    ),
  });
  if (!res.ok) throw new Error(`WA Cloud API ${res.status}: ${await res.text()}`);
}

/**
 * Tell the crafter a conversation now needs them. The dashboard already surfaces it under "Needs you" with the
 * escalation note; when CRAFTER_WA_NUMBER is set (and the Cloud API is configured) the crafter also gets a WhatsApp ping.
 */
export async function notifyCrafter(order: OrderPayload, reason: string): Promise<void> {
  const text = `🔔 CraftMind: ${order.client_info.client_name_wa} (${order.client_info.phone_number}) perlu ditangani langsung.\nAlasan: ${reason}\nOrder: ${order.order_id}`;
  console.info(`[notify-crafter] ${order.order_id}: ${reason}`);
  const crafter = process.env.CRAFTER_WA_NUMBER;
  if (crafter) await deliverViaCloudApi(crafter, text).catch((err) => console.error('[notify-crafter] WhatsApp delivery failed:', err));
}
