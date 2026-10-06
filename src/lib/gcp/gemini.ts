import { GoogleGenAI, type FunctionDeclaration, type Part, type Schema } from '@google/genai';
import { parseDataUrl } from '@/lib/utils/format';

/**
 * Model routing. CLAUDE.md names Gemini 1.5 Flash / 1.5 Pro / Imagen 3; those
 * IDs have been retired, so defaults point at the current aliases and every
 * role can be overridden per environment.
 */
export const MODELS = {
  /** Requirement parsing, structured output, fast classification. */
  flash: process.env.GEMINI_FLASH_MODEL ?? 'gemini-flash-latest',
  /** Pattern breakdown & geometrical BOM reasoning. */
  pro: process.env.GEMINI_PRO_MODEL ?? 'gemini-pro-latest',
  /** Sketch-conditioned mockup (Gemini multimodal image output). */
  image: process.env.GEMINI_IMAGE_MODEL ?? 'gemini-2.5-flash-image',
  /** Text-only studio render. */
  imagen: process.env.IMAGEN_MODEL ?? 'imagen-4.0-generate-001',
} as const;

/** Ordered fallbacks tried when a model is overloaded, rate limited or unavailable. */
export const MODEL_CHAINS = {
  flash: [MODELS.flash, process.env.GEMINI_FLASH_FALLBACK_MODEL ?? 'gemini-flash-lite-latest'],
  pro: [MODELS.pro, MODELS.flash, 'gemini-flash-lite-latest'],
  /** Image generation (sketch-conditioned renders and crafter feedback edits), best quality first. */
  image: [MODELS.image, 'gemini-2.5-flash-image', 'gemini-3.1-flash-image', 'gemini-3-pro-image', 'gemini-3.1-flash-lite-image'],
  /** Short conversational replies: lightest model first for latency. */
  fast: ['gemini-flash-lite-latest', MODELS.flash],
} as const;

let client: GoogleGenAI | null = null;

/** True when either an AI Studio key or Vertex AI (GOOGLE_GENAI_USE_VERTEXAI) is configured. */
export function isGeminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY) || process.env.GOOGLE_GENAI_USE_VERTEXAI === 'true';
}

export function getGenAI(): GoogleGenAI {
  if (client) return client;
  if (process.env.GOOGLE_GENAI_USE_VERTEXAI === 'true') {
    client = new GoogleGenAI({
      vertexai: true,
      project: process.env.GCP_PROJECT_ID,
      location: process.env.GCP_LOCATION ?? 'us-central1',
    });
  } else {
    client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return client;
}

/** Convert a stored media URL (data: or http[s]:) into an inline part Gemini can read. */
export async function mediaUrlToPart(url: string, fallbackMime?: string): Promise<Part | null> {
  const parsed = parseDataUrl(url);
  if (parsed) {
    // SVG is not an accepted vision input; skip the placeholder sketches.
    if (parsed.mimeType === 'image/svg+xml') return null;
    return { inlineData: { mimeType: parsed.mimeType, data: parsed.data } };
  }
  if (/^https?:\/\//.test(url)) {
    const res = await fetch(url);
    if (!res.ok) return null;
    const mimeType = res.headers.get('content-type') ?? fallbackMime ?? 'application/octet-stream';
    const data = Buffer.from(await res.arrayBuffer()).toString('base64');
    return { inlineData: { mimeType, data } };
  }
  return null;
}

function apiStatus(err: unknown): number | undefined {
  const status = (err as { status?: number }).status;
  if (status) return status;
  const match = /"code":\s*(\d{3})/.exec(String((err as Error)?.message ?? err));
  return match ? Number(match[1]) : undefined;
}

/** 5xx (overloaded) and 429 (quota/rate) are worth retrying or routing around; 4xx means our request is wrong. */
const isTransient = (err: unknown) => [429, 500, 502, 503, 504].includes(apiStatus(err) ?? 0);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Hard quota (free tier "limit: 0" or a per-day cap): retrying the same model cannot succeed today. */
function isHardQuota(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err);
  return /limit:\s*0\b|"quotaValue":"0"|PerDay/i.test(msg);
}

/** Google's suggested wait for a rate limit ("retryDelay":"17s"), capped. */
function retryDelayMs(err: unknown, fallbackMs: number): number {
  const s = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(String((err as Error)?.message ?? err))?.[1];
  return Math.min(20_000, s ? Number(s) * 1000 + 250 : fallbackMs);
}

interface FallbackOptions {
  /** Attempts per model per pass (default 2). */
  attempts?: number;
  /** Also retry per-minute rate limits (429) on the same model, honouring retryDelay (default: move on). */
  retryRateLimits?: boolean;
  /** Passes over the whole chain (default 1). */
  passes?: number;
}

/**
 * Run `call` against each model in the chain. Transient errors (5xx; 429 rate limits when `retryRateLimits`) are retried
 * on the same model with backoff, then the next model is tried; hard quotas and 4xx move on immediately. Throws the last
 * error once every pass is exhausted.
 */
async function withModelFallback<T>(models: readonly string[], call: (model: string) => Promise<T>, opts: FallbackOptions = {}): Promise<T> {
  const { attempts = 2, retryRateLimits = false, passes = 1 } = opts;
  const chain = [...new Set(models)];
  const dead = new Set<string>(); // models with a hard quota / 4xx: don't try again in a later pass
  let lastError: unknown;
  for (let pass = 0; pass < passes; pass++) {
    for (const model of chain) {
      if (dead.has(model)) continue;
      for (let attempt = 0; attempt < attempts; attempt++) {
        try {
          return await call(model);
        } catch (err) {
          lastError = err;
          const status = apiStatus(err);
          console.warn(`[gemini] ${model} pass ${pass + 1} attempt ${attempt + 1} failed (${status ?? 'error'})`);
          if (!isTransient(err) || isHardQuota(err)) {
            dead.add(model);
            break;
          }
          if (status === 429 && !retryRateLimits) break;
          if (attempt < attempts - 1) await sleep(status === 429 ? retryDelayMs(err, 4000) : 800 * 2 ** attempt);
        }
      }
    }
    if (dead.size === chain.length) break;
    if (pass < passes - 1) await sleep(3000);
  }
  throw lastError;
}

/** Structured JSON generation via Gemini `responseSchema`, with retry + model fallback. */
export async function generateStructured<T>(opts: {
  models: readonly string[];
  systemInstruction: string;
  parts: Part[];
  schema: Schema;
  temperature?: number;
}): Promise<T> {
  return withModelFallback(opts.models, async (model) => {
    const response = await getGenAI().models.generateContent({
      model,
      contents: [{ role: 'user', parts: opts.parts }],
      config: {
        systemInstruction: opts.systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: opts.schema,
        temperature: opts.temperature ?? 0.2,
      },
    });
    const text = response.text;
    if (!text) throw new Error(`Empty structured response from ${model}`);
    return JSON.parse(text) as T;
  });
}

/** Plain-text generation with retry + model fallback. */
export async function generateText(opts: {
  models: readonly string[];
  systemInstruction: string;
  parts: Part[];
  temperature?: number;
}): Promise<string> {
  return withModelFallback(opts.models, async (model) => {
    const response = await getGenAI().models.generateContent({
      model,
      contents: [{ role: 'user', parts: opts.parts }],
      config: { systemInstruction: opts.systemInstruction, temperature: opts.temperature ?? 0.7 },
    });
    const text = response.text?.trim();
    if (!text) throw new Error(`Empty text response from ${model}`);
    return text;
  });
}

/**
 * Text generation that may call tools (Gemini function calling). Returns the text (possibly empty when the model only
 * called a tool) and the names + args of the tools it called. With retry + model fallback.
 */
export async function generateTextWithTools(opts: {
  models: readonly string[];
  systemInstruction: string;
  parts: Part[];
  tools: FunctionDeclaration[];
  temperature?: number;
}): Promise<{ text: string; calls: Array<{ name: string; args: Record<string, unknown> }> }> {
  return withModelFallback(opts.models, async (model) => {
    const response = await getGenAI().models.generateContent({
      model,
      contents: [{ role: 'user', parts: opts.parts }],
      config: {
        systemInstruction: opts.systemInstruction,
        temperature: opts.temperature ?? 0.7,
        ...(opts.tools.length && { tools: [{ functionDeclarations: opts.tools }] }),
      },
    });
    const calls = (response.functionCalls ?? []).map((c) => ({ name: c.name ?? '', args: (c.args ?? {}) as Record<string, unknown> }));
    const text = (response.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.text ?? '')
      .join('')
      .trim();
    if (!text && !calls.length) throw new Error(`Empty response from ${model}`);
    return { text, calls };
  });
}

export interface GeneratedImage {
  mimeType: string;
  base64: string;
}

/**
 * Image generation via Gemini multimodal image models (accepts reference images such as the sketch and the previous
 * render). Tries every model in MODEL_CHAINS.image with the usual retry/fallback before giving up.
 */
/** Output frame of a render. Gemini image models take all of these; Imagen gets the nearest one it supports. */
export type ImageAspectRatio = '1:1' | '2:3' | '3:4' | '3:2';

export async function generateImageWithGemini(prompt: string, references: Part[] = [], aspectRatio: ImageAspectRatio = '1:1'): Promise<GeneratedImage> {
  const parts: Part[] = [...references, { text: prompt }];
  const request = (model: string, withFrame: boolean) =>
    getGenAI().models.generateContent({
      model,
      contents: [{ role: 'user', parts }],
      config: { responseModalities: ['IMAGE', 'TEXT'], ...(withFrame && { imageConfig: { aspectRatio } }) },
    });
  // Images are worth waiting for (billing on): retry rate limits with backoff, and make a second pass over the chain.
  return withModelFallback(MODEL_CHAINS.image, async (model) => {
    const response = await request(model, aspectRatio !== '1:1').catch((err) => {
      // a model that rejects the frame setting still renders (the prompt carries the orientation too)
      if (aspectRatio !== '1:1' && apiStatus(err) === 400 && /aspect|image_?config/i.test(String((err as Error)?.message))) return request(model, false);
      throw err;
    });
    for (const part of response.candidates?.[0]?.content?.parts ?? []) {
      if (part.inlineData?.data) return { mimeType: part.inlineData.mimeType ?? 'image/png', base64: part.inlineData.data };
    }
    // a text-only answer happens occasionally; treat it as transient so the same model is retried
    throw Object.assign(new Error(`${model} returned no image`), { status: 503 });
  }, { attempts: 3, retryRateLimits: true, passes: 2 });
}

/** Turn an image-generation failure into something the crafter can act on. */
export function describeImageError(err: unknown): string {
  const msg = String((err as Error)?.message ?? err);
  const status = apiStatus(err);
  if (status === 429 && /limit:\s*0\b|"quotaValue":"0"/.test(msg)) {
    return 'This Gemini API key is on the free tier, where Google sets the image-generation quota to 0 for every image model. Enable billing for the key\'s Google Cloud project (AI Studio → API keys → Set up billing) to get studio renders.';
  }
  if (status === 429) return 'Image-generation quota reached (per-minute or daily limit). Try "Re-render" again later.';
  if (status === 404) return 'The configured image model is not available to this key; set GEMINI_IMAGE_MODEL to a model listed for it.';
  if (status && status >= 500) return 'Google image service is temporarily unavailable. Try "Re-render" again in a minute.';
  return `Image generation failed: ${msg.slice(0, 160)}`;
}

/** Imagen is only served by Vertex AI; the AI Studio API key rejects it. */
export function isImagenAvailable(): boolean {
  return process.env.GOOGLE_GENAI_USE_VERTEXAI === 'true';
}

/** Text-to-image via Imagen. */
export async function generateImageWithImagen(prompt: string, aspectRatio: ImageAspectRatio = '1:1'): Promise<GeneratedImage> {
  const response = await getGenAI().models.generateImages({
    model: MODELS.imagen,
    prompt,
    // Imagen supports 1:1, 3:4, 4:3, 9:16, 16:9: a 2:3 portrait frame becomes 3:4, a 3:2 landscape one 4:3
    config: { numberOfImages: 1, aspectRatio: aspectRatio === '2:3' ? '3:4' : aspectRatio === '3:2' ? '4:3' : aspectRatio },
  });
  const image = response.generatedImages?.[0]?.image;
  if (!image?.imageBytes) throw new Error(`${MODELS.imagen} returned no image`);
  return { mimeType: image.mimeType ?? 'image/png', base64: image.imageBytes };
}
