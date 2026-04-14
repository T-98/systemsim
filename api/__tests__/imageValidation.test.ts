import { describe, it, expect } from 'vitest';
import { validateImageMagicBytes, decodeBase64Image, isAllowedMime } from '../_shared/imageValidation';

describe('validateImageMagicBytes', () => {
  it('accepts JPEG with FFD8FF signature', () => {
    const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(validateImageMagicBytes(buf, 'image/jpeg')).toBe(true);
  });

  it('rejects JPEG claim with wrong signature', () => {
    const buf = Buffer.from([0x00, 0x00, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(validateImageMagicBytes(buf, 'image/jpeg')).toBe(false);
  });

  it('accepts PNG with full 8-byte signature', () => {
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    expect(validateImageMagicBytes(buf, 'image/png')).toBe(true);
  });

  it('rejects PNG claim with wrong signature', () => {
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x48, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    expect(validateImageMagicBytes(buf, 'image/png')).toBe(false);
  });

  it('accepts WebP with RIFF....WEBP signature', () => {
    const buf = Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
    expect(validateImageMagicBytes(buf, 'image/webp')).toBe(true);
  });

  it('rejects WebP claim missing WEBP fourcc', () => {
    const buf = Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x51]);
    expect(validateImageMagicBytes(buf, 'image/webp')).toBe(false);
  });

  it('rejects buffers shorter than 12 bytes', () => {
    expect(validateImageMagicBytes(Buffer.from([0xff, 0xd8, 0xff]), 'image/jpeg')).toBe(false);
  });

  it('detects PDF uploaded as PNG', () => {
    const pdf = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0, 0, 0, 0]);
    expect(validateImageMagicBytes(pdf, 'image/png')).toBe(false);
  });
});

describe('decodeBase64Image', () => {
  it('decodes plain base64', () => {
    const buf = decodeBase64Image('aGVsbG8=');
    expect(buf.toString()).toBe('hello');
  });

  it('strips data URL prefix if present', () => {
    const buf = decodeBase64Image('data:image/png;base64,aGVsbG8=');
    expect(buf.toString()).toBe('hello');
  });

  it('strips data URL prefix with different mime', () => {
    const buf = decodeBase64Image('data:image/jpeg;base64,aGVsbG8=');
    expect(buf.toString()).toBe('hello');
  });
});

describe('isAllowedMime', () => {
  it('accepts allowed mimes', () => {
    expect(isAllowedMime('image/png')).toBe(true);
    expect(isAllowedMime('image/jpeg')).toBe(true);
    expect(isAllowedMime('image/webp')).toBe(true);
  });
  it('rejects others', () => {
    expect(isAllowedMime('image/heic')).toBe(false);
    expect(isAllowedMime('image/gif')).toBe(false);
  });
});
