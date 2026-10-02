/**
 * Re-encode AI renders before storing them. Image models return multi-megabyte PNGs; a 1280px JPEG is ~20x smaller with
 * no visible loss at dashboard / WhatsApp sizes, which keeps inline (data URL) orders and dashboard polling light.
 * Falls back to the original bytes if sharp is unavailable or the input can't be decoded.
 */
export async function compressRender(base64: string, mimeType: string): Promise<{ base64: string; mimeType: string }> {
  if (!/^image\/(png|jpeg|webp)$/.test(mimeType)) return { base64, mimeType };
  try {
    const { default: sharp } = await import('sharp');
    const out = await sharp(Buffer.from(base64, 'base64'))
      .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer();
    return { base64: out.toString('base64'), mimeType: 'image/jpeg' };
  } catch (err) {
    console.warn('[image] compression skipped:', err);
    return { base64, mimeType };
  }
}
