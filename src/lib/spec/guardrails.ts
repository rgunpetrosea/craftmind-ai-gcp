import { detectProduct } from '@/lib/spec/catalog';
import { allowedList, specialty } from '@/lib/spec/offerings';
import type { CrafterProfile, MessageIntent } from '@/lib/types';

/**
 * Domain boundary for the intake assistant: brand greeting, polite refusal of non-crafting / malicious messages, and the
 * specialization message for products the workshop doesn't make. Templates are deterministic (never left to the model),
 * so the boundary holds even when Gemini is offline or a client tries to talk it out of its rules.
 */

/** Attempts to override the assistant's instructions or extract them. */
const PROMPT_INJECTION =
  /\b(ignore|disregard|forget|override)\b[^.?!\n]{0,30}\b(instructions?|prompts?|rules?|guidelines?)\b|\babaikan\b[^.?!\n]{0,25}\b(instruksi|perintah|aturan|prompt)\b|\blupakan\b[^.?!\n]{0,25}\b(instruksi|aturan|prompt)\b|\bsystem ?prompt\b|\bprompt (sistem|kamu|mu|rahasia)\b|\binstruksi (sistem|rahasia|kamu|awal)\b|\bdeveloper mode\b|\bjailbreak\b|\bDAN mode\b|\b(reveal|show|print|tunjukkan|bocorkan|kasih tau)\b[^.?!\n]{0,20}\b(instructions?|prompt|instruksi|aturan)\b|\b(act as|pretend to be|berpura-pura (jadi|menjadi)|roleplay sebagai)\b/i;

/** Clearly non-crafting requests (only counted when the message carries no crafting intent at all). */
const OFF_TOPIC =
  /\b(coding|ngoding|kodingan|kode program|python|javascript|html|sql|excel|rumus|pr (matematika|fisika|kimia)|soal (matematika|ujian)|terjemahkan|translate|puisi|pantun|cerpen|resep|cuaca|politik|pemilu|presiden|berita|ramalan|zodiak|saham|crypto|bitcoin|pacar|curhat|galau|lelucon|jokes?|tebak-tebakan)\b/i;

/**
 * Product / material words that make a message about crafting. Generic verbs ("bikin", "buatin") are deliberately not
 * here: "tolong buatin kode python" is not a crafting request.
 */
const CRAFT_SIGNAL = /\b(jahit|kulit|leather|kayu|dompet|tas|sepatu|ikat pinggang|strap|furnitur|meja|kursi|lemari|mockup|emboss|resleting|sleting)\b/i;

export function detectIntent(text: string): MessageIntent {
  if (!text.trim()) return 'CRAFT_REQUEST';
  if (PROMPT_INJECTION.test(text)) return 'PROMPT_INJECTION';
  if (OFF_TOPIC.test(text) && !CRAFT_SIGNAL.test(text) && !detectProduct(text).category) return 'OFF_TOPIC';
  return 'CRAFT_REQUEST';
}

/** First-turn brand anchor (bubble 1). */
export function greetingBubble(profile: CrafterProfile): string {
  return `Halo kak, selamat datang di ${profile.workshop_name}! Kami spesialis bespoke ${profile.primary_material} seperti ${allowedList(profile)}.`;
}

/** First-turn bubble 2 when the client hasn't said what they want yet. */
export const PRODUCT_QUESTION = 'Kira-kira lagi ada rencana mau bikin barang kustom apa nih kak?';

/** Non-crafting or malicious message: one short message, redirect to custom crafting. */
export function refusalMessage(profile: CrafterProfile): string {
  return `Waduh maaf kak, aku cuma bisa bantu buat konsultasi dan pemesanan produk kustom di ${profile.workshop_name} aja nih. Ada ide barang yang mau dibikin?`;
}

/** A product this workshop doesn't make: say what it does make. */
export function mismatchMessage(profile: CrafterProfile, requestedItem: string): string {
  const { craft, goods } = specialty(profile);
  return `Wah kalau untuk ${requestedItem} kita belum bisa kak. Di ${profile.workshop_name} kita khusus bikin ${craft} kustom (${allowedList(profile)}). Siapa tahu ada rencana bikin ${goods}, boleh banget!`;
}

// ---------------------------------------------------------------------------
// Token & cost protection (per intake session; env-configurable)
// ---------------------------------------------------------------------------

/** The AI's Nth reply at which it hands the chat to the crafter instead of answering (hard cap). */
export const SESSION_TURN_CAP = Number(process.env.SESSION_TURN_CAP ?? 10);
/** The AI's Nth reply at which, if the intake is still incomplete, it offers to bring the crafter in. */
export const SESSION_TURN_WARNING = Number(process.env.SESSION_TURN_WARNING ?? 8);
/** AI mockup render rounds per intake session (spec lock + revisions). Crafter re-renders are capped separately. */
export const MAX_AI_MOCKUP_RENDERS = Number(process.env.MAX_AI_MOCKUP_RENDERS ?? 2);
/** Consecutive client messages without new product details before the loop detector hands over. */
export const LOOP_STRIKE_LIMIT = Number(process.env.LOOP_STRIKE_LIMIT ?? process.env.CONFUSION_STRIKE_LIMIT ?? 3);
/** Silent background parses per session while a human has taken over (each is a Gemini call). */
export const SILENT_PARSE_CAP = Number(process.env.SILENT_PARSE_CAP ?? 20);
/** Dashboard-triggered renders per order (crafter clicks), a safety net against runaway image spend. */
export const MAX_CRAFTER_RENDERS_PER_ORDER = Number(process.env.MAX_CRAFTER_RENDERS_PER_ORDER ?? 20);

/** "Mas Fendy" */
export function crafterLabel(profile: CrafterProfile): string {
  return [profile.crafter_honorific, profile.crafter_name || 'crafter kami'].filter(Boolean).join(' ');
}

export function turnWarningMessage(profile: CrafterProfile): string {
  return `Biar makin cepat dan pas, aku bantu hubungkan langsung ke ${crafterLabel(profile)} untuk selesaikan detailnya ya kak.`;
}

export function sessionCapMessage(profile: CrafterProfile): string {
  return `Rangkuman obrolan kita sudah tak teruskan ke ${crafterLabel(profile)} ya kak. Beliau akan langsung melanjutkan chat ini sebentar lagi!`;
}

export function mockupCapMessage(profile: CrafterProfile): string {
  return `Untuk revisi visual lanjutan, ${crafterLabel(profile)} yang bakal bantu buatkan sketsa detailnya secara langsung ya kak, supaya lebih akurat secara teknis produksi.`;
}

export function loopHandoverMessage(profile: CrafterProfile): string {
  return `Sepertinya ada beberapa detail teknis yang perlu didiskusikan langsung nih. Tak hubungkan ke ${crafterLabel(profile)} ya kak biar dihitung spesifikasi pasnya!`;
}

/**
 * Client asks to see (another) picture / revision of the design, or a specific view of it ("mau lihat posisi
 * terbukanya", "gambar bagian dalamnya dong"); `angleForRequest()` then picks that view's slot.
 */
export const VISUAL_REQUEST =
  /\b(gambar|gambaran|mockup|render|visual|desain|foto)\w*\b[^.?!\n]{0,30}\b(lagi|revisi|ganti|ubah|baru|lain|dong|lihat|liat|terbuka\w*|tertutup|bagian dalam\w*|dalamnya|interior|slot|samping|detail|jahitan\w*)\b|\b(revisi|ganti|ubah)\b[^.?!\n]{0,15}\b(gambar|mockup|desain|visual)\w*|\b(kirim|kirimin|lihat|liat|tunjuk\w*|tampilkan)\w*\b[^.?!\n]{0,15}\b(gambar|gambaran|mockup|desain|visual|posisi terbuka|terbuka\w*|bagian dalam\w*|dalamnya|interior|slot ?kartu\w*|detail jahitan|tampak)\w*|\b(posisi|kondisi) terbuka\w*\b[^.?!\n]{0,20}\b(gimana|kayak apa|seperti apa|dong)\b/i;

/** The profile as the model sees it (system context). */
export function profileContext(profile: CrafterProfile): string {
  return JSON.stringify({
    workshop_name: profile.workshop_name,
    primary_material: profile.primary_material,
    allowed_categories: allowedList(profile),
    contact_whatsapp: profile.contact_whatsapp,
  });
}
