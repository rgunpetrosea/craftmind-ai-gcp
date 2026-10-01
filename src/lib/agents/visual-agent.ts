import {
  generateImageWithGemini,
  generateImageWithImagen,
  isGeminiConfigured,
  isImagenAvailable,
  mediaUrlToPart,
} from '@/lib/gcp/gemini';
import { storeMedia } from '@/lib/gcp/gcs';
import { constructionDef, schemaOf } from '@/lib/spec/catalog';
import { specLines } from '@/lib/spec/describe';
import type { ConstructionType, CraftCategory, MockupEngine, Specifications } from '@/lib/types';
import { renderConceptSvg } from '@/lib/utils/svg';

/**
 * Agent 2 — Studio Mockup Generator.
 *   Gemini multimodal image model: conditioned on the client sketch and, for crafter feedback, on the previous render.
 *   Imagen (Vertex AI only): text-to-image.
 *   Otherwise a deterministic SVG concept so the demo never shows a blank (it cannot apply free-text feedback).
 * The prompt lists only the active category's filled attributes, so a table never inherits wallet wording.
 */

const SHAPE_HINT: Partial<Record<ConstructionType, string>> = {
  FLAT_CARD_HOLDER: 'a SINGLE FLAT card sleeve, not folded, card slots visible on the front face, cards peeking out of the top edge',
  PATTERNED_CARD_HOLDER: 'a single flat card holder with a decorative engraved/patterned outer face, not folded',
  BIFOLD_WALLET: 'a bifold wallet shown slightly open to reveal card slots and the cash compartment',
  TRIFOLD_WALLET: 'a trifold wallet shown partly unfolded',
  ACCORDION_WALLET: 'an accordion wallet with a pleated expanding gusset',
  ZIP_AROUND_LONG_WALLET: 'a long zip-around wallet, zipper running around three sides',
};

const SCENE: Record<CraftCategory, string> = {
  SMALL_GOODS: 'soft-box lighting, warm neutral seamless backdrop, three-quarter angle, 85mm macro lens',
  BAG: 'soft-box lighting, warm neutral seamless backdrop, three-quarter angle, 85mm lens',
  FOOTWEAR: 'pair of shoes, side and three-quarter view, soft-box lighting, neutral backdrop, 85mm lens',
  FURNITURE: 'interior catalogue photo, natural window light, minimal room, eye-level three-quarter view, 35mm lens',
  CUSTOM_GENERIC: 'soft-box lighting, neutral seamless backdrop, three-quarter angle',
};

export function buildMockupPrompt(spec: Specifications, hardware: string[] = []): string {
  const schema = schemaOf(spec.category);
  const label = constructionDef(spec.construction_type)?.label ?? schema.noun;
  const subject = SHAPE_HINT[spec.construction_type] ?? `a handcrafted ${label.toLowerCase()} (${schema.noun})`;
  const details = specLines(spec, 'en').map((l) => l.replace(/^• /, ''));
  return [
    `Studio product photograph of ${subject}`,
    ...details,
    hardware.length ? `hardware: ${hardware.slice(0, 3).join(', ')}` : '',
    `${SCENE[spec.category]}, photorealistic, no text, no logo watermark`,
  ]
    .filter(Boolean)
    .join('; ');
}

export async function runVisualAgent(input: {
  orderId: string;
  spec: Specifications;
  hardware?: string[];
  sketchUrl?: string;
  /** Crafter's free-text feedback, e.g. "flat card sleeve, show open card slots from the front". */
  adjustment?: string;
  /** Current mockup, used as a reference so feedback edits it instead of starting over. */
  previousMockupUrl?: string;
}): Promise<{ url: string; engine: MockupEngine; prompt: string; mime_type: string }> {
  const base = buildMockupPrompt(input.spec, input.hardware);
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

  return { url: renderConceptSvg(input.spec), engine: 'offline-svg', prompt, mime_type: 'image/svg+xml' };
}
