export const ALLOWED_IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type AllowedImageMime = (typeof ALLOWED_IMAGE_MIMES)[number];

const MAX_DIM_DEFAULT = 1568;
const QUALITY_DEFAULT = 0.85;
const MAX_RAW_BYTES = 10 * 1024 * 1024;

export type ResizeError =
  | { kind: 'unsupported_format'; mime: string }
  | { kind: 'file_too_large'; bytes: number }
  | { kind: 'decode_failed' }
  | { kind: 'encode_failed' };

export type ResizeResult = {
  ok: true;
  base64: string;
  mimeType: 'image/jpeg';
  bytes: number;
  width: number;
  height: number;
} | {
  ok: false;
  error: ResizeError;
};

export function isAllowedMime(mime: string): mime is AllowedImageMime {
  return (ALLOWED_IMAGE_MIMES as readonly string[]).includes(mime);
}

export async function resizeImage(
  file: Blob,
  options: { maxDim?: number; quality?: number } = {}
): Promise<ResizeResult> {
  const maxDim = options.maxDim ?? MAX_DIM_DEFAULT;
  const quality = options.quality ?? QUALITY_DEFAULT;

  if (!isAllowedMime(file.type)) {
    return { ok: false, error: { kind: 'unsupported_format', mime: file.type } };
  }
  if (file.size > MAX_RAW_BYTES) {
    return { ok: false, error: { kind: 'file_too_large', bytes: file.size } };
  }

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return { ok: false, error: { kind: 'decode_failed' } };
  }

  const { targetWidth, targetHeight } = fitToMaxDim(bitmap.width, bitmap.height, maxDim);

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    return { ok: false, error: { kind: 'encode_failed' } };
  }
  ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), 'image/jpeg', quality);
  });
  if (!blob) {
    return { ok: false, error: { kind: 'encode_failed' } };
  }

  const dataUrl = await blobToDataUrl(blob);
  const base64 = stripDataUrlPrefix(dataUrl);
  return {
    ok: true,
    base64,
    mimeType: 'image/jpeg',
    bytes: blob.size,
    width: targetWidth,
    height: targetHeight,
  };
}

export function fitToMaxDim(
  width: number,
  height: number,
  maxDim: number
): { targetWidth: number; targetHeight: number } {
  if (width <= maxDim && height <= maxDim) {
    return { targetWidth: width, targetHeight: height };
  }
  const scale = maxDim / Math.max(width, height);
  return {
    targetWidth: Math.round(width * scale),
    targetHeight: Math.round(height * scale),
  };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('FileReader failed'));
    reader.readAsDataURL(blob);
  });
}

function stripDataUrlPrefix(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}
