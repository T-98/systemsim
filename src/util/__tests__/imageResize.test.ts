import { describe, it, expect } from 'vitest';
import { fitToMaxDim, isAllowedMime, ALLOWED_IMAGE_MIMES } from '../imageResize';

describe('fitToMaxDim', () => {
  it('returns same dimensions when both sides are under max', () => {
    expect(fitToMaxDim(800, 600, 1568)).toEqual({ targetWidth: 800, targetHeight: 600 });
  });

  it('scales landscape image by width when width is the longest edge', () => {
    const result = fitToMaxDim(3136, 2000, 1568);
    expect(result.targetWidth).toBe(1568);
    expect(result.targetHeight).toBe(1000);
  });

  it('scales portrait image by height when height is the longest edge', () => {
    const result = fitToMaxDim(2000, 3136, 1568);
    expect(result.targetHeight).toBe(1568);
    expect(result.targetWidth).toBe(1000);
  });

  it('handles square images at exact max dim', () => {
    expect(fitToMaxDim(1568, 1568, 1568)).toEqual({ targetWidth: 1568, targetHeight: 1568 });
  });

  it('rounds fractional dimensions', () => {
    const result = fitToMaxDim(1000, 333, 500);
    expect(result.targetWidth).toBe(500);
    expect(result.targetHeight).toBe(Math.round(333 * 0.5));
  });

  it('preserves aspect ratio when scaling', () => {
    const { targetWidth, targetHeight } = fitToMaxDim(1920, 1080, 1568);
    const inputRatio = 1920 / 1080;
    const outputRatio = targetWidth / targetHeight;
    expect(Math.abs(inputRatio - outputRatio)).toBeLessThan(0.01);
  });
});

describe('isAllowedMime', () => {
  it('accepts image/png', () => {
    expect(isAllowedMime('image/png')).toBe(true);
  });

  it('accepts image/jpeg', () => {
    expect(isAllowedMime('image/jpeg')).toBe(true);
  });

  it('accepts image/webp', () => {
    expect(isAllowedMime('image/webp')).toBe(true);
  });

  it('rejects image/heic', () => {
    expect(isAllowedMime('image/heic')).toBe(false);
  });

  it('rejects image/gif', () => {
    expect(isAllowedMime('image/gif')).toBe(false);
  });

  it('rejects empty mime', () => {
    expect(isAllowedMime('')).toBe(false);
  });

  it('rejects application/pdf', () => {
    expect(isAllowedMime('application/pdf')).toBe(false);
  });

  it('exposes exactly three allowed mimes', () => {
    expect(ALLOWED_IMAGE_MIMES).toEqual(['image/png', 'image/jpeg', 'image/webp']);
  });
});
