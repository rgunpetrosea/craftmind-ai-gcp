import {
  generateImageWithGemini,
  generateImageWithImagen,
  isGeminiConfigured,
  mediaUrlToPart,
} from '@/lib/gcp/gemini';
import { storeMedia } from '@/lib/gcp/gcs';
import type { CraftCategory, Specifications } from '@/lib/types';
import { renderConceptSvg } from '@/lib/utils/svg';

/**
 * Agent 2 — Studio Mockup Generator.
 * Sketch present → Gemini multimodal image model (sketch-conditioned render).
 * No sketch      → Imagen text-to-image.
 * Either fails   → deterministic SVG concept so the demo never shows a blank.
 */

export type MockupEngine = 'gemini-image' | 'imagen' | 'offline-svg';

const CATEGORY_NOUN: Record<CraftCategory, string> = {
  bespoke_bag: 'leather bag',
  bespoke_wallet: 'leather wallet',
  bespoke_shoes: 'pair of leather shoes',
};

export function buildMockupPrompt(category: CraftCategory, spec: Specifications, hardware: string[] = []): string {
  const d = spec.dimensions_cm;
  return [
    `Studio product photograph of a handcrafted ${spec.silhouette || CATEGORY_NOUN[category]} (${CATEGORY_NOUN[category]})`,
    spec.exterior_leather && `made from ${spec.exterior_leather} leather`,
    d.length && `approx. ${d.length} x ${d.width || '?'} x ${d.height} cm`,
    spec.structure_temper && `${spec.structure_temper.toLowerCase()} body`,
    spec.stitching_method && `visible ${spec.stitching_method.toLowerCase()}`,
    spec.edge_finish && `${spec.edge_finish.toLowerCase()}s`,
    hardware.length && `hardware: ${hardware.slice(0, 3).join(', ')}`,
    'soft-box lighting, warm neutral seamless backdrop, three-quarter angle, 85mm lens, photorealistic, no text, no logo',
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
}): Promise<{ url: string; engine: MockupEngine; prompt: string }> {
  const prompt = buildMockupPrompt(input.category, input.spec, input.hardware);

  if (isGeminiConfigured()) {
    const sketch = input.sketchUrl ? await mediaUrlToPart(input.sketchUrl).catch(() => null) : null;
    const attempts: Array<[MockupEngine, () => ReturnType<typeof generateImageWithImagen>]> = sketch
      ? [
          ['gemini-image', () => generateImageWithGemini(`Turn this rough client sketch into a finished product render. ${prompt}`, sketch)],
          ['imagen', () => generateImageWithImagen(prompt)],
        ]
      : [
          ['imagen', () => generateImageWithImagen(prompt)],
          ['gemini-image', () => generateImageWithGemini(prompt)],
        ];

    for (const [engine, run] of attempts) {
      try {
        const image = await run();
        const ext = image.mimeType.split('/')[1] ?? 'png';
        const url = await storeMedia(`orders/${input.orderId}/mockup-${Date.now()}.${ext}`, image.base64, image.mimeType);
        return { url, engine, prompt };
      } catch (err) {
        console.warn(`[visual-agent] ${engine} failed:`, err);
      }
    }
  }

  return { url: renderConceptSvg(input.category, input.spec), engine: 'offline-svg', prompt };
}
