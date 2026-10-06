import type { QuotationBreakdown } from '@/lib/agents/pricing';
import { renderTemplate } from '@/lib/spec/guardrails';
import type { CategoryPreset, CrafterProfile, CustomField } from '@/lib/types';
import { formatIDR } from '@/lib/utils/format';

/**
 * Discount requests. The AI may present the current quote and a modest offer itself, within the workshop's margin;
 * only a price far below the floor, without new add-ons, goes to the crafter.
 *
 *   floor     = cost (subtotal, add-ons included) x (1 + floor_margin_pct)          default 15% over cost
 *   AI cap    = min(quote - floor, quote x max_auto_discount_pct)                    default 5% of the quote
 *   requested below the floor by more than 20% AND no new add-ons → ESCALATE (FULL_MANUAL, PRICE_NEGOTIATION)
 *   requested below the floor otherwise                            → HOLD (polite, at most the AI cap)
 *   new add-ons and the cheapest one fits the cap                  → FREEBIE (that add-on free)
 *   otherwise                                                      → DISCOUNT (what was asked, at most the cap)
 */

export const DISCOUNT_REQUEST =
  /\b(diskon|discount|potongan|potong harga|kurang(in|i)? (harga|dikit|sedikit)|bisa kurang|harga (teman|temen|nett?|pas)|nego\w*|murahin|lebih murah|turunin harga|promo)\b/i;

const FLOOR_MARGIN = Number(process.env.FLOOR_MARGIN_PCT ?? 0.15);
const MAX_AUTO_DISCOUNT = Number(process.env.MAX_AUTO_DISCOUNT_PCT ?? 0.05);
/** How far below the floor a request may go before the crafter takes over (when no add-ons come with it). */
export const ESCALATE_BELOW_FLOOR = 0.2;

const roundDown = (v: number, step = 50_000) => Math.max(0, Math.floor(v / step) * step);

function rupiah(value: string, unit?: string): number {
  const n = Number(value.replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
  if (/^(jt|juta)/i.test(unit ?? '')) return Math.round(n * 1_000_000);
  if (/^(rb|ribu|k)/i.test(unit ?? '')) return Math.round(n * 1_000);
  return Math.round(n);
}

/** "diskon 10%", "jadi 15 juta", "potong 2 jt", "bisa 12.500.000?" → requested price; undefined when no number given. */
export function requestedPrice(text: string, total: number): number | undefined {
  const pct = /(\d+(?:[.,]\d+)?)\s*(%|persen)/i.exec(text);
  if (pct) return Math.round(total * (1 - Number(pct[1].replace(',', '.')) / 100));
  const amount = '(?:rp\\.?\\s*)?(\\d+(?:[.,]\\d+)*)\\s*(jt|juta|rb|ribu|k)?\\b';
  const cut = new RegExp(`(?:potong|kurang(?:in|i)?|diskon)\\s*${amount}`, 'i').exec(text);
  if (cut?.[2] || (cut && rupiah(cut[1]) >= 10_000)) return total - rupiah(cut[1], cut[2]);
  const target = new RegExp(`(?:jadi|di|ke|harga|budget(?:nya)?|cuma|hanya)\\s*${amount}`, 'i').exec(text);
  if (target && (target[2] || rupiah(target[1]) >= 10_000)) return rupiah(target[1], target[2]);
  return undefined;
}

export type NegotiationKind = 'DISCOUNT' | 'FREEBIE' | 'HOLD' | 'ESCALATE';

export interface NegotiationDecision {
  kind: NegotiationKind;
  /** Quote before any AI discount, add-ons included. */
  total_idr: number;
  floor_idr: number;
  requested_idr?: number;
  /** Amount taken off by the AI offer (0 when holding the price). */
  discount_idr: number;
  freebie?: string;
  /** How far the request is below the floor (0..1). */
  below_floor?: number;
}

export function decideNegotiation(input: {
  breakdown: QuotationBreakdown;
  preset: CategoryPreset;
  requested?: number;
  /** Add-ons the client asked for in this message. */
  newAddOns: CustomField[];
}): NegotiationDecision {
  const T = input.breakdown.total_idr;
  const floor = Math.ceil((input.breakdown.subtotal_idr * (1 + (input.preset.floor_margin_pct ?? FLOOR_MARGIN))) / 10_000) * 10_000;
  const cap = roundDown(Math.min(Math.max(0, T - floor), T * (input.preset.max_auto_discount_pct ?? MAX_AUTO_DISCOUNT)));
  const base = { total_idr: T, floor_idr: floor, requested_idr: input.requested };
  const P = input.requested;

  if (P !== undefined && P < floor) {
    const below = (floor - P) / floor;
    if (below > ESCALATE_BELOW_FLOOR && !input.newAddOns.length) return { ...base, kind: 'ESCALATE', discount_idr: 0, below_floor: below };
    return { ...base, kind: 'HOLD', discount_idr: cap, below_floor: below };
  }
  const cheapest = [...input.newAddOns].filter((f) => f.surcharge_idr > 0).sort((a, b) => a.surcharge_idr - b.surcharge_idr)[0];
  if (cheapest && cheapest.surcharge_idr <= cap) return { ...base, kind: 'FREEBIE', discount_idr: cheapest.surcharge_idr, freebie: cheapest.label };
  const amount = roundDown(Math.min(P !== undefined ? T - P : cap, cap));
  return amount > 0 ? { ...base, kind: 'DISCOUNT', discount_idr: amount } : { ...base, kind: 'HOLD', discount_idr: 0 };
}

/** The AI's offer as a custom field (replaced on the next negotiation turn, editable by the crafter). */
export function offerField(d: NegotiationDecision): CustomField | undefined {
  if (d.discount_idr <= 0 || d.kind === 'ESCALATE') return undefined;
  return {
    id: 'cf-ai-discount',
    label: d.kind === 'FREEBIE' ? `Gratis: ${d.freebie}` : 'Diskon',
    value: 'penawaran AI saat nego, menunggu konfirmasi crafter',
    surcharge_idr: -d.discount_idr,
    source: 'AI',
    kind: 'DISCOUNT',
  };
}

const NEGOTIATION_HANDOVER =
  'Untuk harga segitu perlu dibahas langsung dengan {{active_crafter_name}} ya kak. Chatnya sudah aku teruskan, beliau akan segera membalas.';

export function negotiationHandoverMessage(profile: CrafterProfile): string {
  return renderTemplate(NEGOTIATION_HANDOVER, profile);
}

/** Client reply: add-ons acknowledged, the updated quote, then the offer or a polite hold (max 3 bubbles). */
export function negotiationReply(d: NegotiationDecision, finalTotal: number, newAddOns: CustomField[], profile: CrafterProfile): string {
  const bubbles: string[] = [];
  if (newAddOns.length) {
    const names = newAddOns.map((f) => f.label.split(' (')[0].split(' / ')[0]).join(', ');
    bubbles.push(`Noted kak, ${names} sudah aku tambahkan ke spesifikasinya. Karena ada tambahan ini, biaya bahan dan pengerjaannya ikut naik ya.`);
  }
  const quote = `Estimasi harganya sekarang ${formatIDR(d.total_idr)}.`;
  switch (d.kind) {
    case 'FREEBIE':
      bubbles.push(`${quote} Sebagai bonus, ${d.freebie?.split(' (')[0]} kami kasih gratis, jadi ${formatIDR(finalTotal)}.`);
      break;
    case 'DISCOUNT':
      bubbles.push(`${quote} Untuk kakak, kami bisa bantu potongan ${formatIDR(d.discount_idr)}, jadi ${formatIDR(finalTotal)}.`);
      break;
    default:
      bubbles.push(
        d.discount_idr > 0
          ? `${quote} Harga yang kakak minta sudah di bawah biaya bahan dan pengerjaan, jadi mohon maaf belum bisa; paling maksimal kami bantu potongan ${formatIDR(d.discount_idr)}, jadi ${formatIDR(finalTotal)}.`
          : `${quote} Harga ini sudah mepet dengan biaya bahan dan pengerjaan, jadi mohon maaf belum bisa turun lagi kak.`,
      );
  }
  bubbles.push(renderTemplate('Harga final tetap dikonfirmasi {{active_crafter_name}} di penawaran resmi ya kak.', profile));
  return bubbles.join('\n\n');
}
