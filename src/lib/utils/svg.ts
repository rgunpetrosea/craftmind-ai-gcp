import type { CraftCategory, Specifications } from '@/lib/types';
import { svgToDataUrl } from '@/lib/utils/format';

const LEATHER_COLORS: Array<[RegExp, string, string]> = [
  // [keyword, base, shade]
  [/black|hitam/i, '#1f1d1b', '#0d0c0b'],
  [/navy|biru/i, '#1e2a44', '#131b2e'],
  [/etoupe|taupe|abu/i, '#8a7f72', '#6b6158'],
  [/cognac/i, '#9a4f1f', '#763a15'],
  [/dark brown|coklat tua/i, '#4a2c1c', '#341e12'],
  [/natural|natur/i, '#d9b88f', '#bf9a6f'],
  [/tan/i, '#c08657', '#a06a40'],
  [/brown|coklat/i, '#7a4a2a', '#5c361e'],
  [/red|merah|burgundy/i, '#6e1f24', '#511519'],
  [/green|hijau|olive/i, '#4b5a33', '#364124'],
];

function leatherPalette(leather: string): { base: string; shade: string } {
  const hit = LEATHER_COLORS.find(([re]) => re.test(leather));
  return hit ? { base: hit[1], shade: hit[2] } : { base: '#8b522e', shade: '#6e3f26' };
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);
}

function productShape(category: CraftCategory, base: string, shade: string, stitch: string): string {
  if (category === 'bespoke_wallet') {
    return `
      <rect x="170" y="230" width="340" height="220" rx="14" fill="${base}"/>
      <rect x="182" y="242" width="316" height="196" rx="10" fill="none" stroke="${stitch}" stroke-width="2" stroke-dasharray="6 5" opacity=".8"/>
      <line x1="340" y1="232" x2="340" y2="448" stroke="${shade}" stroke-width="4"/>
      <rect x="200" y="260" width="120" height="30" rx="4" fill="${shade}" opacity=".55"/>
      <rect x="200" y="300" width="120" height="30" rx="4" fill="${shade}" opacity=".45"/>`;
  }
  if (category === 'bespoke_shoes') {
    return `
      <path d="M140 420 C150 330 250 300 330 310 C390 318 420 350 470 370 C540 395 560 410 560 440 L560 455 L140 455 Z" fill="${base}"/>
      <path d="M140 455 L560 455 L560 475 L140 475 Z" fill="${shade}"/>
      <path d="M150 420 C170 350 250 325 330 330 C390 336 420 365 470 385 C530 408 548 420 550 440" fill="none" stroke="${stitch}" stroke-width="2" stroke-dasharray="6 5" opacity=".8"/>
      <path d="M300 320 L330 380 M320 318 L350 378 M340 318 L372 380" stroke="${shade}" stroke-width="4"/>`;
  }
  return `
    <path d="M270 210 C270 140 410 140 410 210" fill="none" stroke="${shade}" stroke-width="16" stroke-linecap="round"/>
    <rect x="170" y="210" width="340" height="250" rx="18" fill="${base}"/>
    <path d="M170 228 Q170 210 188 210 L492 210 Q510 210 510 228 L510 320 Q340 350 170 320 Z" fill="${shade}"/>
    <rect x="182" y="222" width="316" height="226" rx="12" fill="none" stroke="${stitch}" stroke-width="2" stroke-dasharray="6 5" opacity=".8"/>
    <rect x="325" y="318" width="30" height="22" rx="4" fill="#c9a24a"/>`;
}

/**
 * Deterministic "studio" concept render used when Imagen / Gemini image
 * generation is unavailable (no API key, quota, offline demo).
 */
export function renderConceptSvg(category: CraftCategory, spec: Specifications): string {
  const { base, shade } = leatherPalette(spec.exterior_leather);
  const d = spec.dimensions_cm;
  const dims = d.length ? `${d.length} × ${d.width} × ${d.height} cm` : 'dimensions pending';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 680 600" width="680" height="600">
  <defs>
    <radialGradient id="bg" cx="50%" cy="40%" r="75%"><stop offset="0" stop-color="#fbf8f4"/><stop offset="1" stop-color="#e7ded3"/></radialGradient>
  </defs>
  <rect width="680" height="600" fill="url(#bg)"/>
  <ellipse cx="340" cy="485" rx="230" ry="18" fill="#000" opacity=".12"/>
  ${productShape(category, base, shade, '#f1e3cf')}
  <text x="340" y="535" text-anchor="middle" font-family="Georgia, serif" font-size="20" fill="#3d241a">${escapeXml(spec.silhouette || 'Bespoke concept')}</text>
  <text x="340" y="562" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="13" fill="#6e3f26">${escapeXml(spec.exterior_leather || 'Leather TBD')} · ${escapeXml(dims)}</text>
  <text x="20" y="30" font-family="Helvetica, Arial, sans-serif" font-size="11" fill="#a8683a" letter-spacing="2">CRAFTMIND AI · CONCEPT RENDER (OFFLINE)</text>
</svg>`;
  return svgToDataUrl(svg);
}

/** Pencil-style rough sketch used for the seeded demo order. */
export function renderDemoSketchSvg(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 680 600" width="680" height="600">
  <rect width="680" height="600" fill="#fdfcf7"/>
  <g fill="none" stroke="#444" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M262 214 C258 150 420 138 414 212"/>
    <path d="M168 214 L512 208 L516 458 L172 462 Z"/>
    <path d="M170 218 C230 330 460 330 514 214"/>
    <rect x="324" y="316" width="30" height="20"/>
    <path d="M140 470 L540 470" stroke-dasharray="4 8"/>
  </g>
  <g font-family="'Comic Sans MS', 'Marker Felt', cursive" font-size="18" fill="#333">
    <text x="300" y="500">± 30 cm</text>
    <text x="528" y="340">22 cm</text>
    <text x="210" y="150">handle pendek</text>
    <text x="360" y="120">veg-tan coklat?</text>
    <text x="200" y="560">flap + kunci putar emas</text>
  </g>
</svg>`;
  return svgToDataUrl(svg);
}
