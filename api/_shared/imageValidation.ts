export const ALLOWED_MIMES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type AllowedMime = (typeof ALLOWED_MIMES)[number];

export function isAllowedMime(mime: string): mime is AllowedMime {
  return (ALLOWED_MIMES as readonly string[]).includes(mime);
}

/**
 * Validate that a base64-decoded buffer starts with the expected magic bytes
 * for the claimed MIME. Prevents MIME-lying attacks and catches corrupted uploads.
 */
export function validateImageMagicBytes(buffer: Buffer, mime: AllowedMime): boolean {
  if (buffer.length < 12) return false;

  if (mime === 'image/jpeg') {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (mime === 'image/png') {
    return (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a
    );
  }
  if (mime === 'image/webp') {
    return (
      buffer[0] === 0x52 &&
      buffer[1] === 0x49 &&
      buffer[2] === 0x46 &&
      buffer[3] === 0x46 &&
      buffer[8] === 0x57 &&
      buffer[9] === 0x45 &&
      buffer[10] === 0x42 &&
      buffer[11] === 0x50
    );
  }
  return false;
}

export function decodeBase64Image(base64: string): Buffer {
  const cleaned = base64.replace(/^data:[^;]+;base64,/, '');
  return Buffer.from(cleaned, 'base64');
}
