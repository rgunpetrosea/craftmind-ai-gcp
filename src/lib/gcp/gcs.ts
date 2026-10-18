import { getStorage } from 'firebase-admin/storage';
import { getAdminApp } from '@/lib/gcp/firestore';

/**
 * Google Cloud Storage for generated mockups and customer sketches / voice notes.
 *
 *   GCS_BUCKET            bucket name; when set, media is uploaded and orders / messages only hold URLs (Firestore
 *                         documents stay small). Without it media stays inline as data URLs (fine for the in-memory store).
 *   GCS_PUBLIC_READ       'false' for a private bucket: media is served through /api/media/<path> (the app's service
 *                         account reads it); default: public URLs on storage.googleapis.com (bucket needs
 *                         allUsers:roles/storage.objectViewer, required for WhatsApp Cloud API image delivery).
 *   PUBLIC_BASE_URL       absolute origin used for /api/media URLs (e.g. the Cloud Run service URL).
 *
 * Object names are unique (timestamped), so they are cached as immutable.
 */

export function isGcsConfigured(): boolean {
  return Boolean(process.env.GCS_BUCKET);
}

const publicRead = () => process.env.GCS_PUBLIC_READ !== 'false';
const bucket = () => getStorage(getAdminApp()).bucket(process.env.GCS_BUCKET);

/** URL the dashboard, the client gallery and WhatsApp can open for an object path. */
export function mediaUrl(path: string): string {
  return publicRead()
    ? `https://storage.googleapis.com/${process.env.GCS_BUCKET}/${encodeURI(path)}`
    : `${process.env.PUBLIC_BASE_URL ?? ''}/api/media/${encodeURI(path)}`;
}

/**
 * Persist a generated / uploaded asset and return a URL to render it. Falls back to an inline data URL (and logs why)
 * when GCS is not configured or the upload fails, so a storage hiccup never breaks the conversation.
 */
export async function storeMedia(path: string, base64: string, mimeType: string): Promise<string> {
  const inline = `data:${mimeType};base64,${base64}`;
  if (!isGcsConfigured()) return inline;
  try {
    await bucket()
      .file(path)
      .save(Buffer.from(base64, 'base64'), { contentType: mimeType, resumable: false, metadata: { cacheControl: 'public, max-age=31536000, immutable' } });
    return mediaUrl(path);
  } catch (err) {
    console.error(`[gcs] upload of ${path} failed, keeping the media inline:`, err);
    return inline;
  }
}

/** Move an inbound data URL (sketch / voice note) to GCS when configured. */
export async function persistInboundMedia(orderId: string, dataUrl: string, mimeType: string): Promise<string> {
  const match = /^data:[^;,]+;base64,(.+)$/.exec(dataUrl);
  if (!match || !isGcsConfigured()) return dataUrl;
  const ext = mimeType.split('/')[1]?.split(/[;+]/)[0] ?? 'bin';
  return storeMedia(`orders/${orderId}/inbound-${Date.now()}.${ext}`, match[1], mimeType);
}

/** Object path of one of our own media URLs (public or /api/media), else undefined. */
export function objectPathOf(url: string): string | undefined {
  const name = process.env.GCS_BUCKET;
  if (!name) return undefined;
  const pub = `https://storage.googleapis.com/${name}/`;
  if (url.startsWith(pub)) return decodeURI(url.slice(pub.length));
  const at = url.indexOf('/api/media/');
  return at >= 0 ? decodeURI(url.slice(at + '/api/media/'.length)) : undefined;
}

/** Read one of our objects with the service account (works for private buckets); null when it is not ours / missing. */
export async function readMedia(path: string): Promise<{ data: Buffer; mimeType: string } | null> {
  if (!isGcsConfigured() || path.includes('..')) return null;
  try {
    const file = bucket().file(path);
    const [[data], [meta]] = await Promise.all([file.download(), file.getMetadata()]);
    return { data, mimeType: meta.contentType ?? 'application/octet-stream' };
  } catch {
    return null;
  }
}
