import type { NextRequest } from 'next/server';
import { readMedia } from '@/lib/gcp/gcs';

/**
 * Serves order media from a PRIVATE Cloud Storage bucket (GCS_PUBLIC_READ=false) with the app's service account, so the
 * bucket never has to be public. Only objects under orders/ (mockups, sketches, voice notes) are readable here.
 */
export async function GET(_request: NextRequest, ctx: RouteContext<'/api/media/[...path]'>) {
  const { path } = await ctx.params;
  const objectPath = path.map(decodeURIComponent).join('/');
  if (!objectPath.startsWith('orders/') || objectPath.includes('..')) return new Response('Not found', { status: 404 });
  const media = await readMedia(objectPath);
  if (!media) return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(media.data), {
    headers: { 'Content-Type': media.mimeType, 'Cache-Control': 'private, max-age=31536000, immutable' },
  });
}
