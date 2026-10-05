/**
 * WhatsApp micro-interactions: the assistant never sends one long paragraph. Replies are split into 2-3 bubbles
 * (separated by a blank line in the model output), each at most 2 sentences. Bullet lists (spec cards) stay together.
 */

export const MAX_BUBBLES = 3;
export const MAX_SENTENCES_PER_BUBBLE = 2;

/** Sentence split that keeps "Rp 1.500.000", "1.6mm" and "dll." intact. */
function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?…])\s+(?=[A-Z0-9"'(*_À-ɏ]|[\p{Extended_Pictographic}])/u)
    .filter(Boolean);
}

export function shapeBubbles(text: string): string[] {
  const blocks = text
    .replace(/\r/g, '')
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);

  const bubbles: string[] = [];
  for (const block of blocks) {
    // lists (spec card, options) are one visual unit
    if (/^\s*([•\-*]|\d+\.)\s/m.test(block)) {
      bubbles.push(block);
      continue;
    }
    const parts = sentences(block);
    for (let i = 0; i < parts.length; i += MAX_SENTENCES_PER_BUBBLE) bubbles.push(parts.slice(i, i + MAX_SENTENCES_PER_BUBBLE).join(' '));
  }
  if (bubbles.length <= MAX_BUBBLES) return bubbles;
  // Over budget: keep the opener and the closing bubbles (the closing ones carry the question to the client).
  return [bubbles[0], ...bubbles.slice(-(MAX_BUBBLES - 1))];
}
