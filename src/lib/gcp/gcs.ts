import { getStorage } from 'firebase-admin/storage';
import { getAdminApp } from '@/lib/gcp/firestore';

/** True when uploads should go to Cloud Storage instead of inline data URLs. */
export function isGcsConfigured(): boolean {
  return Boolean(process.env.GCS_BUCKET);
}

/**
 * Persist a generated/uploaded asset and return a URL the dashboard can render.
 * With GCS_BUCKET set the object is written to `gs://<bucket>/<path>` and served
 * from storage.googleapis.com (the bucket needs allUsers:objectViewer for the
 * demo). Without it the asset stays an inline data URL — fine for the
 * in-memory store, too large for Firestore's 1 MiB document limit.
 */
export async function storeMedia(path: string, base64: string, mimeType: string): Promise<string> {
  if (!isGcsConfigured()) return `data:${mimeType};base64,${base64}`;
  const bucket = getStorage(getAdminApp()).bucket(process.env.GCS_BUCKET);
  const file = bucket.file(path);
  await file.save(Buffer.from(base64, 'base64'), { contentType: mimeType, resumable: false });
  return `https://storage.googleapis.com/${bucket.name}/${encodeURI(path)}`;
}

/** Move an inbound data URL (sketch / voice note) to GCS when configured. */
export async function persistInboundMedia(orderId: string, dataUrl: string, mimeType: string): Promise<string> {
  const match = /^data:[^;,]+;base64,(.+)$/.exec(dataUrl);
  if (!match || !isGcsConfigured()) return dataUrl;
  const ext = mimeType.split('/')[1]?.split(/[;+]/)[0] ?? 'bin';
  return storeMedia(`orders/${orderId}/inbound-${Date.now()}.${ext}`, match[1], mimeType);
}
