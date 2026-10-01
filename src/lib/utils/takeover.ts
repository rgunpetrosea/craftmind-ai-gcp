import type { AutomationMode, EscalationReason, OrderPayload } from '@/lib/types';

/**
 * Human-in-the-Loop takeover rules.
 *
 *  AI_COPILOT     AI replies to the client; crafter reviews quotes.
 *  PARTIAL_PAUSE  AI is silent until `paused_until`, then resumes automatically.
 *                 Entered when the crafter replies manually (CRAFTER_OVERRIDE)
 *                 or pauses from the dashboard.
 *  FULL_MANUAL    AI is silent until the crafter hands the chat back.
 *                 Entered on client keywords (CLIENT_REQUEST), repeated AI
 *                 confusion (CONFUSION_RULE) or the dashboard toggle.
 */

export const ESCALATION_KEYWORDS = ['admin', 'crafter', 'manusia', 'pemilik'] as const;

/** Crafter first names that mean "let me talk to the person" (comma-separated env, e.g. "fendy,budi"). */
const CRAFTER_NAMES = (process.env.CRAFTER_NAMES ?? 'fendy')
  .split(',')
  .map((n) => n.trim().toLowerCase())
  .filter(Boolean);

// Leading word boundary only, so Indonesian suffixes still match ("adminnya", "pemiliknya").
const KEYWORD_PATTERN = new RegExp(`\\b(${ESCALATION_KEYWORDS.join('|')})`, 'i');
// "ngomong sama ...", "bicara langsung", "mau telepon", "hubungi ..." : asking for a person, however they phrase it.
const HUMAN_INTENT_PATTERN = /\b(ngomong|bicara|berbicara|ngobrol|chat|telepon|telpon|hubungi|kontak)\s+(sama|dengan|langsung|ke|dgn|sm)\b/i;
const NAME_PATTERN = CRAFTER_NAMES.length ? new RegExp(`\\b(?:mas|pak|bu|mbak|kak)\\s+(${CRAFTER_NAMES.join('|')})\\b`, 'i') : null;

export const PARTIAL_PAUSE_MINUTES = Number(process.env.PARTIAL_PAUSE_MINUTES ?? 30);
export const CONFUSION_STRIKE_LIMIT = Number(process.env.CONFUSION_STRIKE_LIMIT ?? 3);

export const HANDOFF_MESSAGES: Record<EscalationReason, string> = {
  CLIENT_REQUEST: 'Baik kak, percakapan ini kami teruskan ke crafter kami. Mohon ditunggu sebentar ya 🙏',
  CONFUSION_RULE: 'Mohon maaf kak, supaya tidak salah paham, crafter kami akan langsung membantu kakak di sini ya 🙏',
  CRAFTER_OVERRIDE: '',
};

/** Returns the trigger that matched (keyword, phrase or crafter name), or null. */
export function detectEscalationKeyword(text: string | undefined): string | null {
  if (!text) return null;
  const keyword = KEYWORD_PATTERN.exec(text);
  if (keyword) return keyword[1].toLowerCase();
  const name = NAME_PATTERN?.exec(text);
  if (name) return name[0].toLowerCase();
  const phrase = HUMAN_INTENT_PATTERN.exec(text);
  return phrase ? phrase[0].toLowerCase() : null;
}

export function isPauseActive(order: OrderPayload, now = new Date()): boolean {
  return order.automation_mode === 'PARTIAL_PAUSE' && !!order.paused_until && new Date(order.paused_until) > now;
}

/** Revert an expired PARTIAL_PAUSE to AI_COPILOT. Returns true when the order changed. */
export function expirePartialPause(order: OrderPayload, now = new Date()): boolean {
  if (order.automation_mode !== 'PARTIAL_PAUSE' || isPauseActive(order, now)) return false;
  setAutomationMode(order, 'AI_COPILOT');
  return true;
}

/** True when the AI must not generate a response for this order. */
export function isAiBlocked(order: OrderPayload, now = new Date()): boolean {
  return order.automation_mode === 'FULL_MANUAL' || isPauseActive(order, now);
}

export function setAutomationMode(
  order: OrderPayload,
  mode: AutomationMode,
  reason?: EscalationReason,
  pauseMinutes = PARTIAL_PAUSE_MINUTES,
  now = new Date(),
): OrderPayload {
  order.automation_mode = mode;
  if (mode === 'AI_COPILOT') {
    delete order.paused_until;
    delete order.escalation_reason;
    return order;
  }
  order.escalation_reason = reason ?? 'CRAFTER_OVERRIDE';
  if (mode === 'PARTIAL_PAUSE') order.paused_until = new Date(now.getTime() + pauseMinutes * 60_000).toISOString();
  else delete order.paused_until;
  return order;
}
