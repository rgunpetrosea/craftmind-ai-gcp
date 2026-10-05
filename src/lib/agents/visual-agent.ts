import {
  generateImageWithGemini,
  describeImageError,
  generateImageWithImagen,
  isGeminiConfigured,
  isImagenAvailable,
  mediaUrlToPart,
  type ImageAspectRatio,
} from '@/lib/gcp/gemini';
import { storeMedia } from '@/lib/gcp/gcs';
import { compressRender } from '@/lib/utils/image';
import { constructionDef, describeFields, schemaOf } from '@/lib/spec/catalog';
import { angleDef, customView, type AngleView, type ViewScope } from '@/lib/spec/angles';
import type { ConstructionType, CraftCategory, MockupAngle, MockupEngine, Specifications } from '@/lib/types';
import { renderConceptSvg } from '@/lib/utils/svg';

/**
 * Agent 2 — Studio Mockup Generator.
 *   Gemini multimodal image models (MODEL_CHAINS.image, tried in order): conditioned on the client sketch and, for crafter
 *   feedback, on the previous render.
 *   Imagen (Vertex AI only): text-to-image.
 *   Only when every model fails: a deterministic SVG concept (it cannot apply free-text feedback) plus the reason.
 * The prompt lists only the active category's filled attributes, so a table never inherits wallet wording.
 */

/** Neutral form-factor descriptions: they never say open/closed, the camera direction decides that. */
const SHAPE_HINT: Partial<Record<ConstructionType, string>> = {
  FLAT_CARD_HOLDER: 'a single flat card holder (one flat panel, no fold)',
  PATTERNED_CARD_HOLDER: 'a single flat card holder with a decorative engraved / patterned outer face (no fold)',
  BIFOLD_WALLET: 'a bifold wallet (folds once along a centre spine)',
  LONG_BIFOLD_WALLET:
    'a tall long bifold wallet, vertical orientation, breast pocket wallet (folds once along a centre spine; closed it stands about twice as tall as it is wide)',
  TRIFOLD_WALLET: 'a trifold wallet (folds twice into three panels)',
  ACCORDION_WALLET: 'an accordion wallet with a pleated expanding gusset',
  ZIP_AROUND_LONG_WALLET: 'a long zip-around wallet, zipper running around three sides',
};

const SCENE: Record<CraftCategory, string> = {
  SMALL_GOODS: 'soft-box lighting, warm neutral seamless backdrop, 85mm macro lens',
  BAG: 'soft-box lighting, warm neutral seamless backdrop, 85mm lens',
  FOOTWEAR: 'soft-box lighting, neutral backdrop, 85mm lens',
  FURNITURE: 'interior catalogue photo, natural window light, minimal styled room, 35mm lens',
  CUSTOM_GENERIC: 'soft-box lighting, neutral seamless backdrop',
};

/** Words in the spec that say the wallet is long / tall ("dompet panjang", "long", "tall"), not a measurement. */
const LONG_WORDS = /\b(panjang|long|tall|tinggi)\b(?![a-z]*\s*\d)/i;

export interface MockupFrame {
  aspect: ImageAspectRatio;
  /** Orientation instruction added to the prompt (absent for the square default). */
  framing?: string;
}

/**
 * Output frame per product and view. A tall small good (long bifold / breast-pocket wallet, a closed face at least 1.4x
 * as tall as wide, or "panjang / long / tall" in the spec) gets a VERTICAL frame and an explicit orientation rule, so it is
 * never squashed into a square short bifold: 2:3 for closed and detail views, 3:4 for the opened spread. A zip-around
 * long wallet is landscape and keeps the default. Everything else stays 1:1.
 */
export function mockupFrame(spec: Specifications, scope: ViewScope = 'EXTERIOR'): MockupFrame {
  if (spec.category !== 'SMALL_GOODS' || spec.construction_type === 'ZIP_AROUND_LONG_WALLET') return { aspect: '1:1' };
  const d = (spec.attributes as { dimensions_cm?: { length: number; height: number } }).dimensions_cm;
  const words = [spec.model_name, spec.notes, spec.reference_object, ...spec.custom_fields.map((f) => `${f.label} ${f.value}`)].join(' ');
  const tall =
    spec.construction_type === 'LONG_BIFOLD_WALLET' ||
    (!!d && d.length > 0 && d.height >= 1.4 * d.length) ||
    (/WALLET/.test(spec.construction_type) && LONG_WORDS.test(words));
  if (!tall) return { aspect: '1:1' };
  const size = d && d.length > 0 && d.height > 0 ? ` (closed about ${d.length} cm wide x ${d.height} cm tall)` : '';
  return scope === 'INTERIOR' || scope === 'FULL'
    ? {
        aspect: '3:4',
        framing: `VERTICAL frame. Tall long wallet${size}: opened flat, each half is a tall column of stacked card slots; vertical orientation, not a square short bifold.`,
      }
    : {
        aspect: '2:3',
        framing: `VERTICAL portrait frame (2:3). Tall long bifold wallet${size}, standing upright in vertical orientation like a breast pocket wallet; never a square or short bifold.`,
      };
}

/**
 * The spec as the image model sees it, limited to what the view can show: closed / exterior views never receive
 * interior-zone fields (card slots, lining, inner pockets), so they cannot leak into the render.
 */
/** Free-form client requests about the inside (card slots, lining, inner pockets) only show on interior views. */
const INTERIOR_CUSTOM = /slot|kartu|card|lining|furing|dalam|inner|inside|interior|saku|kantong|pocket|compartment|sekat|uang|cash|koin|coin|id window|jendela/i;

export function customFieldZone(f: { label: string; value: string }): 'interior' | 'exterior' {
  return INTERIOR_CUSTOM.test(`${f.label} ${f.value}`) ? 'interior' : 'exterior';
}

export function visualSpec(spec: Specifications, scope: ViewScope, hardware: string[] = []): Record<string, unknown> {
  const showInterior = scope === 'INTERIOR' || scope === 'FULL';
  const a = spec.attributes as unknown as Record<string, unknown>;
  const zipIsOutside = a.main_closure === 'ZIPPER' || spec.construction_type === 'ZIP_AROUND_LONG_WALLET';
  const fields = describeFields(spec).filter(({ field }) => showInterior || field.zone !== 'interior');
  const out: Record<string, unknown> = {
    product: constructionDef(spec.construction_type)?.label ?? schemaOf(spec.category).noun,
    ...(spec.model_name && { name: spec.model_name }),
    ...Object.fromEntries(fields.map(({ field, text }) => [field.label.toLowerCase(), text])),
    ...(hardware.length && {
      hardware: hardware.filter((h) => showInterior || zipIsOutside || !/zip/i.test(h)).slice(0, 5),
    }),
  };
  // client requests the schema has no field for ("slot kartu miring", "two-tone"): part of the picture and its signature,
  // scoped like regular fields so a closed view never shows interior requests
  const custom = spec.custom_fields.filter((f) => f.value.trim() && (showInterior || customFieldZone(f) !== 'interior'));
  return custom.length ? { ...out, custom_requests: Object.fromEntries(custom.map((f) => [f.label, f.value])) } : out;
}

/**
 * What one angle's render depends on: the slot's view, the spec fields that view may show (an exterior view ignores
 * interior changes) and the crafter's custom shot. Equal signatures render the same picture, so it is not paid twice.
 */
export function mockupSignature(spec: Specifications, angle: MockupAngle = 'ANGLE_1', customPrompt?: string): string {
  const view = customPrompt ? customView(spec.category, angle, spec.construction_type) : angleDef(spec.category, angle, spec.construction_type);
  const { aspect } = mockupFrame(spec, view.scope);
  // the frame only joins the signature when it isn't the square default, so existing square renders stay reusable
  return JSON.stringify({ c: spec.construction_type, a: angle, view: view.view, v: visualSpec(spec, view.scope), p: customPrompt ?? '', ...(aspect !== '1:1' && { f: aspect }) });
}

export function buildMockupPrompt(spec: Specifications, hardware: string[], view: AngleView, customShot?: string): string {
  const schema = schemaOf(spec.category);
  const label = constructionDef(spec.construction_type)?.label ?? schema.noun;
  const subject = SHAPE_HINT[spec.construction_type] ?? `a handcrafted ${label.toLowerCase()} (${schema.noun})`;
  const frame = mockupFrame(spec, view.scope);
  return [
    `Studio product photograph of ${subject}.`,
    `PRODUCT SPEC (JSON): ${JSON.stringify(visualSpec(spec, view.scope, hardware))}`,
    `CAMERA / SHOT: ${customShot?.trim() || view.shot}`,
    frame.framing ? `FRAMING: ${frame.framing}` : '',
    view.isolation ? `STRICT RULE: ${view.isolation}` : '',
    `STYLE: ${SCENE[spec.category]}, photorealistic, no text, no logo watermark.`,
  ]
    .filter(Boolean)
    .join('\n');
}

export interface VisualResult {
  angle: MockupAngle;
  view: string;
  url: string;
  engine: MockupEngine;
  prompt: string;
  mime_type: string;
  error?: string;
  custom_prompt?: string;
}

export async function runVisualAgent(input: {
  orderId: string;
  spec: Specifications;
  hardware?: string[];
  sketchUrl?: string;
  angle?: MockupAngle;
  /** Crafter's custom camera / shot direction for this angle (replaces the category view's default shot). */
  customPrompt?: string;
  /** Crafter's free-text feedback editing this angle's previous render. */
  adjustment?: string;
  /** This angle's current render, used as a reference so feedback edits it instead of starting over. */
  previousMockupUrl?: string;
  /** The ANGLE_1 render, used so the other angles show the SAME product. */
  consistencyRefUrl?: string;
  /** Skip the image models (e.g. they already failed for this batch) and draw the offline concept. */
  offline?: { reason: string };
}): Promise<VisualResult> {
  const angle = input.angle ?? 'ANGLE_1';
  const customPrompt = input.customPrompt?.trim() || undefined;
  const view = customPrompt
    ? customView(input.spec.category, angle, input.spec.construction_type)
    : angleDef(input.spec.category, angle, input.spec.construction_type);
  const base = buildMockupPrompt(input.spec, input.hardware ?? [], view, customPrompt);
  const adjustment = input.adjustment?.trim();
  const prompt = adjustment ? `${base}\nCRAFTER FEEDBACK (highest priority, overrides anything above): ${adjustment}` : base;
  const result = { angle, view: view.view, prompt, ...(customPrompt && { custom_prompt: customPrompt }) };
  const offline = (error: string): VisualResult => ({
    ...result,
    url: renderConceptSvg(input.spec, angle),
    engine: 'offline-svg',
    mime_type: 'image/svg+xml',
    error,
  });

  if (input.offline) return offline(input.offline.reason);
  if (!isGeminiConfigured()) return offline('No GEMINI_API_KEY (or Vertex AI) configured, so the offline concept renderer was used.');

  const toPart = (url?: string) => (url ? mediaUrlToPart(url).catch(() => null) : Promise.resolve(null));
  const [sketch, previous, consistency] = await Promise.all([
    angle === 'ANGLE_1' && !customPrompt ? toPart(input.sketchUrl) : Promise.resolve(null),
    adjustment ? toPart(input.previousMockupUrl) : Promise.resolve(null),
    angle !== 'ANGLE_1' || customPrompt ? toPart(input.consistencyRefUrl) : Promise.resolve(null),
  ]);
  const references = [sketch, consistency, previous].filter((p): p is NonNullable<typeof p> => Boolean(p));

  const instructions = [
    consistency &&
      'The attached studio photo shows THIS EXACT product: keep identical material, colour, hardware and proportions; change only the camera / shot as described' +
        (view.scope === 'EXTERIOR' ? ' and keep it closed' : '') + '.',
    previous && "Edit the attached previous render of this angle according to the crafter's feedback while keeping the product recognisable.",
    sketch && 'Turn the attached rough client sketch into a finished product render.',
  ].filter(Boolean);
  const geminiPrompt = `${instructions.join(' ')}\n${prompt}`.trim();

  type Attempt = [MockupEngine, () => ReturnType<typeof generateImageWithImagen>];
  const { aspect } = mockupFrame(input.spec, view.scope);
  const gemini: Attempt = ['gemini-image', () => generateImageWithGemini(geminiPrompt, references, aspect)];
  const imagen: Attempt = ['imagen', () => generateImageWithImagen(prompt, aspect)];
  const attempts = isImagenAvailable() ? (references.length ? [gemini, imagen] : [imagen, gemini]) : [gemini];

  let lastError: unknown;
  for (const [engine, run] of attempts) {
    try {
      const raw = await run();
      const image = await compressRender(raw.base64, raw.mimeType);
      const ext = image.mimeType.split('/')[1] ?? 'png';
      const url = await storeMedia(`orders/${input.orderId}/mockup-${angle.toLowerCase()}-${view.view.toLowerCase()}-${Date.now()}.${ext}`, image.base64, image.mimeType);
      return { ...result, url, engine, mime_type: image.mimeType };
    } catch (err) {
      lastError = err;
      console.warn(`[visual-agent] ${engine} failed for ${angle}:`, err);
    }
  }
  // every image model failed → offline concept, with the reason so the crafter knows what to fix
  return offline(describeImageError(lastError));
}
