import type { MessageMediaType } from '@/lib/types';

/**
 * Adaptive debounce + hybrid trigger for WhatsApp bursts.
 *
 * Clients rarely send one complete message: "halo kak" → sketch → "ukurannya
 * 30x22" → "veg-tan ya". Each inbound message re-arms a per-session timer and
 * the AI runs once on the whole burst. The delay adapts to what was just sent,
 * a closing phrase or question flushes early (hybrid trigger), and a hard cap
 * guarantees a reply even if the client never stops typing.
 *
 * Timers live in-process: fine for `next dev` and a single Cloud Run instance
 * with CPU always allocated. For multi-instance production, replace `schedule`
 * with a Cloud Tasks task named `<session>-<window>` and `scheduleTime = flushAt`.
 */

export interface DebounceConfig {
  baseMs: number;
  minMs: number;
  /** Absolute cap measured from the first message in the burst. */
  maxWaitMs: number;
}

export const DEFAULT_DEBOUNCE: DebounceConfig = {
  baseMs: Number(process.env.DEBOUNCE_BASE_MS ?? 4000),
  minMs: 600,
  maxWaitMs: Number(process.env.DEBOUNCE_MAX_WAIT_MS ?? 15000),
};

// Closing phrase at the end of the message, optionally followed by a particle ("itu saja kak", "berapa ya").
const CLOSING_PHRASE = /(itu saja|itu aja|sudah|udah|segitu|thanks|thank you|makasih|terima ?kasih|done|gimana|berapa)(\s+(kak|ya|dong|min|gan|sis))*\W*$/i;

export interface DebounceSignal {
  text?: string;
  media_type?: MessageMediaType;
}

/** Asking for the price, the quote or the visual: answer immediately wherever it appears in the message. */
const PRIORITY_INTENT = /\b(berapa|harga\w*|biaya\w*|ongkos|price|quote|penawaran\w*|mockup|gambaran|render|visual\w*)\b/i;

/** Hybrid trigger: the client signalled they're waiting for an answer. */
export function isFlushTrigger(signal: DebounceSignal): boolean {
  const text = signal.text?.trim() ?? '';
  return text.endsWith('?') || CLOSING_PHRASE.test(text) || PRIORITY_INTENT.test(text);
}

export function adaptiveDelay(signal: DebounceSignal, cfg: DebounceConfig = DEFAULT_DEBOUNCE): number {
  if (isFlushTrigger(signal)) return cfg.minMs;
  let delay = cfg.baseMs;
  if (signal.media_type === 'image') delay += 3000; // a caption usually follows a sketch
  if (signal.media_type === 'audio') delay += 1500;
  const len = signal.text?.trim().length ?? 0;
  if (len > 0 && len < 15) delay += 2000; // short fragment → still typing
  if (len > 120) delay -= 1500; // long, complete thought
  return Math.max(cfg.minMs, delay);
}

interface PendingBurst {
  timer: ReturnType<typeof setTimeout>;
  firstAt: number;
  flushAt: number;
  flush: () => Promise<unknown>;
}

class AdaptiveDebouncer {
  private pending = new Map<string, PendingBurst>();

  constructor(private cfg: DebounceConfig = DEFAULT_DEBOUNCE) {}

  schedule(key: string, signal: DebounceSignal, flush: () => Promise<unknown>): { flushAt: string; delayMs: number } {
    const now = Date.now();
    const existing = this.pending.get(key);
    if (existing) clearTimeout(existing.timer);

    const firstAt = existing?.firstAt ?? now;
    const flushAt = Math.min(now + adaptiveDelay(signal, this.cfg), firstAt + this.cfg.maxWaitMs);
    const delayMs = Math.max(0, flushAt - now);

    const timer = setTimeout(() => {
      this.pending.delete(key);
      flush().catch((err) => console.error(`[debounce] flush for ${key} failed:`, err));
    }, delayMs);

    this.pending.set(key, { timer, firstAt, flushAt, flush });
    return { flushAt: new Date(flushAt).toISOString(), delayMs };
  }

  cancel(key: string): boolean {
    const existing = this.pending.get(key);
    if (!existing) return false;
    clearTimeout(existing.timer);
    this.pending.delete(key);
    return true;
  }

  pendingUntil(key: string): string | null {
    const p = this.pending.get(key);
    return p ? new Date(p.flushAt).toISOString() : null;
  }
}

const globalForDebounce = globalThis as unknown as { __craftmindDebouncer?: AdaptiveDebouncer };

export function getDebouncer(): AdaptiveDebouncer {
  globalForDebounce.__craftmindDebouncer ??= new AdaptiveDebouncer();
  return globalForDebounce.__craftmindDebouncer;
}
