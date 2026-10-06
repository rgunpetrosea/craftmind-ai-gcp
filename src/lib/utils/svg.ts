import { constructionDef, describeFields } from '@/lib/spec/catalog';
import { primaryMaterial } from '@/lib/spec/describe';
import { angleDef, type AngleView } from '@/lib/spec/angles';
import { isFullHeightBuiltIn } from '@/lib/spec/categories/furniture';
import type { MockupAngle, Specifications } from '@/lib/types';
import { svgToDataUrl } from '@/lib/utils/format';

const LEATHER_COLORS: Array<[RegExp, string, string]> = [
  // [keyword, base, shade]; first match wins, so specific colors come before generic ones
  [/tosca|teal|turquoise/i, '#1f8a8a', '#146464'],
  [/black|hitam/i, '#1f1d1b', '#0d0c0b'],
  [/navy|biru/i, '#1e2a44', '#131b2e'],
  [/etoupe|taupe|abu/i, '#8a7f72', '#6b6158'],
  [/cognac/i, '#9a4f1f', '#763a15'],
  [/dark brown|coklat tua/i, '#4a2c1c', '#341e12'],
  [/natural|natur|jati|teak|oak/i, '#d9b88f', '#bf9a6f'],
  [/walnut|mahoni|mahogany|suar|trembesi/i, '#7a4a2a', '#5c361e'],
  [/besi|iron|steel|stainless/i, '#3a3a3a', '#222222'],
  [/tan/i, '#c08657', '#a06a40'],
  [/brown|coklat/i, '#7a4a2a', '#5c361e'],
  [/red|merah|burgundy/i, '#6e1f24', '#511519'],
  [/green|hijau|olive|zaitun/i, '#4b5a33', '#364124'],
  [/tosca|teal|turquoise/i, '#1f8a8a', '#146464'],
];

function leatherPalette(leather: string): { base: string; shade: string } {
  const hit = LEATHER_COLORS.find(([re]) => re.test(leather));
  return hit ? { base: hit[1], shade: hit[2] } : { base: '#8b522e', shade: '#6e3f26' };
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);
}

function productShape(spec: Specifications, base: string, shade: string, stitch: string): string {
  const a = spec.attributes as unknown as Record<string, unknown>;
  const mark =
    a.embossing_type === 'EMBOSS_INITIALS' && a.embossing_text
      ? `<text x="470" y="430" text-anchor="end" font-family="Georgia, serif" font-size="18" fill="${stitch}" opacity=".85">${escapeXml(String(a.embossing_text))}</text>`
      : '';
  const c = spec.construction_type;

  if (spec.category === 'SMALL_GOODS') {
    if (c === 'FLAT_CARD_HOLDER' || c === 'PATTERNED_CARD_HOLDER') {
      const slots = Math.max(1, Math.min(4, Number(a.front_slots) || 2));
      const slotRects = Array.from({ length: slots }, (_, i) => {
        const y = 330 - i * 34;
        return `<rect x="215" y="${y}" width="250" height="30" rx="4" fill="${shade}" opacity=".55"/><line x1="215" y1="${y}" x2="465" y2="${y}" stroke="${stitch}" stroke-width="1.5" stroke-dasharray="5 4"/>`;
      }).join('');
      return `<rect x="215" y="196" width="250" height="40" rx="3" fill="#e9dcc3"/><rect x="205" y="224" width="270" height="250" rx="16" fill="${base}"/>${slotRects}<rect x="215" y="234" width="250" height="230" rx="10" fill="none" stroke="${stitch}" stroke-width="2" stroke-dasharray="6 5" opacity=".8"/>${mark}`;
    }
    if (c === 'LONG_BIFOLD_WALLET') {
      // tall breast-pocket bifold: upright, about twice as tall as wide
      return `<rect x="250" y="150" width="180" height="350" rx="14" fill="${base}"/><rect x="263" y="163" width="154" height="324" rx="9" fill="none" stroke="${stitch}" stroke-width="2" stroke-dasharray="6 5" opacity=".8"/><line x1="252" y1="152" x2="252" y2="498" stroke="${shade}" stroke-width="6"/>${mark}`;
    }
    if (c === 'ZIP_AROUND_LONG_WALLET') {
      return `<rect x="120" y="250" width="440" height="200" rx="18" fill="${base}"/><rect x="134" y="264" width="412" height="172" rx="12" fill="none" stroke="${stitch}" stroke-width="2" stroke-dasharray="6 5" opacity=".8"/><path d="M130 256 H550" stroke="#c9a24a" stroke-width="6" stroke-dasharray="3 3"/><rect x="520" y="248" width="26" height="16" rx="3" fill="#c9a24a"/>${mark}`;
    }
    return `<rect x="150" y="230" width="380" height="220" rx="14" fill="${base}"/><rect x="164" y="244" width="352" height="192" rx="9" fill="none" stroke="${stitch}" stroke-width="2" stroke-dasharray="6 5" opacity=".8"/><line x1="340" y1="232" x2="340" y2="448" stroke="${shade}" stroke-width="5"/><rect x="190" y="268" width="130" height="30" rx="4" fill="${shade}" opacity=".55"/><rect x="190" y="308" width="130" height="30" rx="4" fill="${shade}" opacity=".45"/>${mark}`;
  }
  if (spec.category === 'FOOTWEAR') {
    return `<path d="M140 420 C150 330 250 300 330 310 C390 318 420 350 470 370 C540 395 560 410 560 440 L560 455 L140 455 Z" fill="${base}"/><path d="M140 455 L560 455 L560 475 L140 475 Z" fill="${shade}"/><path d="M150 420 C170 350 250 325 330 330 C390 336 420 365 470 385 C530 408 548 420 550 440" fill="none" stroke="${stitch}" stroke-width="2" stroke-dasharray="6 5" opacity=".8"/><path d="M300 320 L330 380 M320 318 L350 378 M340 318 L372 380" stroke="${shade}" stroke-width="4"/>`;
  }
  if (spec.category === 'FURNITURE') {
    if (c === 'CHAIR' || c === 'STOOL') {
      const back = c === 'CHAIR' ? `<rect x="250" y="170" width="16" height="200" fill="${shade}"/><rect x="414" y="170" width="16" height="200" fill="${shade}"/><rect x="250" y="180" width="180" height="60" rx="6" fill="${base}"/>` : '';
      return `${back}<rect x="230" y="330" width="220" height="26" rx="4" fill="${base}"/><rect x="245" y="356" width="14" height="120" fill="${shade}"/><rect x="421" y="356" width="14" height="120" fill="${shade}"/>`;
    }
    if (c === 'KITCHEN_SET') {
      // base run with countertop, wall cabinets, tall fridge unit; full height: wall cabinets and tall unit meet the
      // ceiling line (never the standard 80 cm cabinets with a gap above)
      const full = isFullHeightBuiltIn(spec);
      const top = full ? 112 : 170;
      const doors = [0, 1, 2, 3].map((i) => `<rect x="${150 + i * 70}" y="350" width="64" height="100" rx="3" fill="${shade}" opacity=".5"/>`).join('');
      const uppers = [0, 1, 2, 3].map((i) => `<rect x="${150 + i * 70}" y="${top}" width="64" height="${260 - top}" rx="3" fill="${base}"/>`).join('');
      const ceiling = full ? '<line x1="120" y1="110" x2="570" y2="110" stroke="#6b6b6b" stroke-width="3"/>' : '';
      const tallTop = full ? 112 : 150;
      return `${ceiling}<rect x="140" y="330" width="290" height="14" fill="#9a9a9a"/><rect x="140" y="344" width="290" height="112" fill="${base}"/>${doors}${uppers}<rect x="440" y="${tallTop}" width="110" height="${456 - tallTop}" rx="4" fill="${base}"/><rect x="452" y="${tallTop + 14}" width="86" height="${442 - tallTop - 14}" rx="4" fill="#c8ccd0"/><line x1="495" y1="${tallTop + 14}" x2="495" y2="${442 - 2}" stroke="#9aa0a6" stroke-width="3"/>`;
    }
    if (c === 'SHELF' || c === 'CABINET' || c === 'WARDROBE' || c === 'TV_CONSOLE') {
      const inner = c === 'SHELF' ? [260, 320, 380].map((y) => `<rect x="220" y="${y}" width="240" height="10" fill="${shade}"/>`).join('') : `<line x1="340" y1="215" x2="340" y2="460" stroke="${shade}" stroke-width="4"/><circle cx="325" cy="340" r="5" fill="#c9a24a"/><circle cx="355" cy="340" r="5" fill="#c9a24a"/>`;
      return `<rect x="210" y="200" width="260" height="270" rx="4" fill="${base}"/>${inner}`;
    }
    return `<rect x="130" y="300" width="420" height="28" rx="4" fill="${base}"/><rect x="150" y="328" width="380" height="16" fill="${shade}"/><rect x="160" y="328" width="18" height="150" fill="${shade}"/><rect x="502" y="328" width="18" height="150" fill="${shade}"/>`;
  }
  if (spec.category === 'CUSTOM_GENERIC') {
    return `<rect x="210" y="230" width="260" height="230" rx="22" fill="${base}"/><rect x="226" y="246" width="228" height="198" rx="16" fill="none" stroke="${stitch}" stroke-width="2" stroke-dasharray="6 5" opacity=".7"/>`;
  }
  // BAG
  if (c === 'SLOUCHY_TOTE' || c === 'STRUCTURED_TOTE') {
    return `<path d="M240 240 C240 130 440 130 440 240" fill="none" stroke="${shade}" stroke-width="14" stroke-linecap="round"/><path d="M170 240 H510 L490 460 H190 Z" fill="${base}"/><path d="M190 262 H490" stroke="${stitch}" stroke-width="2" stroke-dasharray="6 5" opacity=".8"/>${mark}`;
  }
  return `<path d="M270 210 C270 140 410 140 410 210" fill="none" stroke="${shade}" stroke-width="16" stroke-linecap="round"/><rect x="170" y="210" width="340" height="250" rx="18" fill="${base}"/><path d="M170 228 Q170 210 188 210 L492 210 Q510 210 510 228 L510 320 Q340 350 170 320 Z" fill="${shade}"/><rect x="182" y="222" width="316" height="226" rx="12" fill="none" stroke="${stitch}" stroke-width="2" stroke-dasharray="6 5" opacity=".8"/><rect x="325" y="318" width="30" height="22" rx="4" fill="#c9a24a"/>${mark}`;
}

/**
 * Deterministic concept render used when Gemini image generation is unavailable (no key, quota, offline demo).
 * Shape follows the category and form factor; free-text feedback cannot be applied.
 */
export function renderConceptSvg(spec: Specifications, angle: MockupAngle = 'ANGLE_1'): string {
  const view = angleDef(spec.category, angle, spec.construction_type);
  const a = spec.attributes as unknown as Record<string, unknown>;
  const material = primaryMaterial(spec);
  const { base, shade } = leatherPalette(`${material} ${a.color ?? a.color_stain ?? ''}`);
  const subtitle = describeFields(spec)
    .filter((f) => f.key === 'dimensions_cm' || f.key === 'eu_size')
    .map((f) => f.text)
    .join(' · ');
  const title = spec.model_name || constructionDef(spec.construction_type)?.label || 'Bespoke concept';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 680 600" width="680" height="600">
  <defs>
    <radialGradient id="bg" cx="50%" cy="40%" r="75%"><stop offset="0" stop-color="#fbf8f4"/><stop offset="1" stop-color="#e7ded3"/></radialGradient>
  </defs>
  <rect width="680" height="600" fill="url(#bg)"/>
  <ellipse cx="340" cy="485" rx="230" ry="18" fill="#000" opacity=".12"/>
  ${angleView(view, productShape(spec, base, shade, '#f1e3cf'), shade)}
  <text x="340" y="535" text-anchor="middle" font-family="Georgia, serif" font-size="20" fill="#3d241a">${escapeXml(title)}</text>
  <text x="340" y="562" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="13" fill="#6e3f26">${escapeXml(material || 'Material TBD')}${subtitle ? ` · ${escapeXml(subtitle)}` : ''}</text>
  <text x="20" y="30" font-family="Helvetica, Arial, sans-serif" font-size="11" fill="#a8683a" letter-spacing="2">CRAFTMIND AI · CONCEPT RENDER (OFFLINE) · ${escapeXml(view.label.toUpperCase())}</text>
</svg>`;
  return svgToDataUrl(svg);
}

/** Offline stand-ins per view scope: whole product, opened interior, macro crop (side views are compressed). */
function angleView(view: AngleView, product: string, shade: string): string {
  if (view.scope === 'DETAIL') {
    // zoom into the lower-right corner of the product (edge + stitch line)
    return `<svg x="40" y="40" width="600" height="440" viewBox="300 300 240 176" preserveAspectRatio="xMidYMid slice">${product}</svg>`;
  }
  if (view.scope === 'INTERIOR') {
    const pockets = [0, 1, 2].map((i) => `<rect x="${250 + i * 64}" y="290" width="56" height="70" rx="4" fill="${shade}" opacity=".35"/>`).join('');
    return `${product}<rect x="232" y="262" width="216" height="150" rx="10" fill="#efe3cc" opacity=".95"/>${pockets}<rect x="240" y="270" width="200" height="134" rx="8" fill="none" stroke="${shade}" stroke-width="1.5" stroke-dasharray="5 4" opacity=".7"/>`;
  }
  if (/SIDE|LATERAL/.test(view.view)) return `<g transform="translate(340 0) scale(0.45 1) translate(-340 0)">${product}</g>`;
  if (/TOP_DOWN/.test(view.view)) return `<g transform="translate(0 300) scale(1 0.6) translate(0 -300)">${product}</g>`;
  return product;
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
