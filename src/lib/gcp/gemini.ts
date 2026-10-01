import { GoogleGenAI, type Part, type Schema } from '@google/genai';
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

/**
 * Run `call` against each model in the chain. Transient errors are retried once on the
 * same model with a short backoff, then the next model is tried. Throws the last error.
 */
async function withModelFallback<T>(models: readonly string[], call: (model: string) => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (const model of [...new Set(models)]) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await call(model);
      } catch (err) {
        lastError = err;
        const status = apiStatus(err);
        console.warn(`[gemini] ${model} attempt ${attempt + 1} failed (${status ?? 'error'})`);
        // Quota (429) and missing models (404) won't recover on a retry; move on immediately.
        if (!isTransient(err) || status === 429) break;
        await sleep(600 * (attempt + 1));
      }
    }
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

export interface GeneratedImage {
  mimeType: string;
  base64: string;
}

/** Image generation via a Gemini multimodal model (accepts reference images such as the sketch and the previous render). */
export async function generateImageWithGemini(prompt: string, references: Part[] = []): Promise<GeneratedImage> {
  const parts: Part[] = [...references, { text: prompt }];
  const response = await getGenAI().models.generateContent({
    model: MODELS.image,
    contents: [{ role: 'user', parts }],
    config: { responseModalities: ['IMAGE', 'TEXT'] },
  });
  for (const part of response.candidates?.[0]?.content?.parts ?? []) {
    if (part.inlineData?.data) {
      return { mimeType: part.inlineData.mimeType ?? 'image/png', base64: part.inlineData.data };
    }
  }
  throw new Error(`${MODELS.image} returned no image`);
}

/** Imagen is only served by Vertex AI; the AI Studio API key rejects it. */
export function isImagenAvailable(): boolean {
  return process.env.GOOGLE_GENAI_USE_VERTEXAI === 'true';
}

/** Text-to-image via Imagen. */
export async function generateImageWithImagen(prompt: string): Promise<GeneratedImage> {
  const response = await getGenAI().models.generateImages({
    model: MODELS.imagen,
    prompt,
    config: { numberOfImages: 1, aspectRatio: '1:1' },
  });
  const image = response.generatedImages?.[0]?.image;
  if (!image?.imageBytes) throw new Error(`${MODELS.imagen} returned no image`);
  return { mimeType: image.mimeType ?? 'image/png', base64: image.imageBytes };
}
