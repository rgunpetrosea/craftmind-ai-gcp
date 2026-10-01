import {
  generateImageWithGemini,
  generateImageWithImagen,
  isGeminiConfigured,
  isImagenAvailable,
  mediaUrlToPart,
} from '@/lib/gcp/gemini';
import { storeMedia } from '@/lib/gcp/gcs';
import { getConstruction } from '@/lib/spec/catalog';
import { describeCustomization } from '@/lib/spec/describe';
import type { CraftCategory, MockupEngine, Specifications } from '@/lib/types';
import { renderConceptSvg } from '@/lib/utils/svg';

/**
 * Agent 2 — Studio Mockup Generator.
 *   Gemini multimodal image model: conditioned on the client sketch and, for crafter feedback, on the previous render.
 *   Imagen (Vertex AI only): text-to-image.
 *   Otherwise a deterministic SVG concept so the demo never shows a blank (it cannot apply free-text feedback).
 */

const CATEGORY_NOUN: Record<CraftCategory, string> = {
  bespoke_bag: 'leather bag',
  bespoke_wallet: 'leather wallet',
  bespoke_shoes: 'pair of leather shoes',
};

const SHAPE_HINT: Partial<Record<Specifications['construction_type'], string>> = {
  FLAT_CARD_HOLDER: 'a SINGLE FLAT card sleeve, not folded, card slots visible on the front face, cards peeking out of the top edge',
  PATTERNED_CARD_HOLDER: 'a single flat card holder with a decorative engraved/patterned outer face, not folded',
  BIFOLD_WALLET: 'a bifold wallet shown slightly open to reveal card slots and the cash compartment',
  TRIFOLD_WALLET: 'a trifold wallet shown partly unfolded',
  ACCORDION_WALLET: 'an accordion wallet with a pleated expanding gusset',
  ZIP_AROUND_LONG_WALLET: 'a long zip-around wallet, zipper running around three sides',
};

export function buildMockupPrompt(category: CraftCategory, spec: Specifications, hardware: string[] = []): string {
  const d = spec.dimensions_cm;
  const def = getConstruction(spec.construction_type);
  const p = spec.pocket_layout;
  const slots = p.front_slots + p.back_slots;
  const thread = [spec.finish.thread_material, spec.finish.thread_color, spec.finish.stitch_pattern].filter(Boolean).join(' ');
  return [
    `Studio product photograph of ${SHAPE_HINT[spec.construction_type] ?? `a handcrafted ${def.label.toLowerCase()} (${CATEGORY_NOUN[category]})`}`,
    spec.exterior_leather && `made from ${spec.exterior_leather} leather${spec.finish.surface_finish ? `, ${spec.finish.surface_finish} surface` : ''}`,
    d.length && `approx. ${d.length} x ${d.width || '?'} x ${d.height} cm`,
    slots > 0 && `${slots} visible card slots`,
    p.central_pockets > 0 && 'a central pocket for folded cash',
    p.coin_zip_pocket && 'a zippered coin pocket',
    spec.structure_temper && `${spec.structure_temper.toLowerCase()} body`,
    (spec.stitching_method || thread) && `visible ${[spec.stitching_method, thread].filter(Boolean).join(', ').toLowerCase()} stitching`,
    spec.edge_finish && spec.edge_finish.toLowerCase(),
    spec.customization.type !== 'UNSPECIFIED' && spec.customization.type !== 'NONE' && `customization: ${describeCustomization(spec)}`,
    spec.finish.zipper && `zipper: ${spec.finish.zipper}`,
    hardware.length && `hardware: ${hardware.slice(0, 3).join(', ')}`,
    'soft-box lighting, warm neutral seamless backdrop, three-quarter angle, 85mm lens, photorealistic, no text, no logo watermark',
  ]
    .filter(Boolean)
    .join(', ');
}

export async function runVisualAgent(input: {
  orderId: string;
  category: CraftCategory;
  spec: Specifications;
  hardware?: string[];
  sketchUrl?: string;
  /** Crafter's free-text feedback, e.g. "flat card sleeve, show open card slots from the front". */
  adjustment?: string;
  /** Current mockup, used as a reference so feedback edits it instead of starting over. */
  previousMockupUrl?: string;
}): Promise<{ url: string; engine: MockupEngine; prompt: string; mime_type: string }> {
  const base = buildMockupPrompt(input.category, input.spec, input.hardware);
  const adjustment = input.adjustment?.trim();
  const prompt = adjustment ? `${base}. CRAFTER FEEDBACK (highest priority, overrides anything above): ${adjustment}` : base;

  if (isGeminiConfigured()) {
    const references = (
      await Promise.all([
        input.sketchUrl ? mediaUrlToPart(input.sketchUrl).catch(() => null) : null,
        adjustment && input.previousMockupUrl ? mediaUrlToPart(input.previousMockupUrl).catch(() => null) : null,
      ])
    ).filter((part): part is NonNullable<typeof part> => Boolean(part));

    const geminiPrompt = adjustment
      ? `Edit the previous studio render (second image if two are attached) according to the crafter's feedback while keeping the product recognisable. ${prompt}`
      : references.length
        ? `Turn this rough client sketch into a finished product render. ${prompt}`
        : prompt;

    type Attempt = [MockupEngine, () => ReturnType<typeof generateImageWithImagen>];
    const gemini: Attempt = ['gemini-image', () => generateImageWithGemini(geminiPrompt, references)];
    const imagen: Attempt = ['imagen', () => generateImageWithImagen(prompt)];
    const attempts = isImagenAvailable() ? (references.length ? [gemini, imagen] : [imagen, gemini]) : [gemini];

    for (const [engine, run] of attempts) {
      try {
        const image = await run();
        const ext = image.mimeType.split('/')[1] ?? 'png';
        const url = await storeMedia(`orders/${input.orderId}/mockup-${Date.now()}.${ext}`, image.base64, image.mimeType);
        return { url, engine, prompt, mime_type: image.mimeType };
      } catch (err) {
        console.warn(`[visual-agent] ${engine} failed:`, err);
      }
    }
  }

  return { url: renderConceptSvg(input.category, input.spec), engine: 'offline-svg', prompt, mime_type: 'image/svg+xml' };
}
