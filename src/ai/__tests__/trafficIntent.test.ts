/**
 * @file ai/__tests__/trafficIntent.test.ts
 *
 * Unit coverage for the traffic-intent client + validator.
 * Mocks `fetch` with `vi.stubGlobal` (same pattern as describeIntent.test.ts).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { trafficIntent } from '../trafficIntent';
import { validateTrafficIntent } from '../trafficIntentSchema';

const okPayload = {
  profileName: 'spike_then_cooldown',
  durationSeconds: 60,
  phases: [
    { startS: 0, endS: 10, rps: 100, shape: 'steady', description: 'Warm-up' },
    { startS: 10, endS: 20, rps: 5000, shape: 'instant_spike', description: 'Spike' },
    { startS: 20, endS: 60, rps: 100, shape: 'ramp_down', description: 'Cool down' },
  ],
  requestMix: { default: 1.0 },
  userDistribution: 'uniform',
  jitterPercent: 15,
  promptVersion: '2026-04-18.1',
};

describe('trafficIntent client', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns ok with parsed TrafficProfile on 200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => okPayload,
    }));
    const result = await trafficIntent({ description: 'ramp to spike then cool down' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.profileName).toBe('spike_then_cooldown');
      expect(result.data.phases).toHaveLength(3);
    }
  });

  it('maps a 429 to rate_limit', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ error: true, kind: 'rate_limit', message: 'Too many requests' }),
    }));
    const result = await trafficIntent({ description: 'anything' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('rate_limit');
    }
  });

  it('maps a 400 validation error through', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: true, kind: 'validation', message: 'too short' }),
    }));
    const result = await trafficIntent({ description: 'x' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('validation');
    }
  });

  it('returns api_error when the server sends 200 with malformed shape', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ profileName: 'x' /* missing phases */ }),
    }));
    const result = await trafficIntent({ description: 'anything' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('api_error');
    }
  });

  it('returns network on TypeError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    const result = await trafficIntent({ description: 'anything' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('network');
    }
  });
});

describe('validateTrafficIntent', () => {
  it('accepts a well-formed payload', () => {
    const r = validateTrafficIntent(okPayload);
    expect(r.ok).toBe(true);
  });

  it('rejects a non-object', () => {
    expect(validateTrafficIntent(null)).toEqual({ ok: false, reason: 'tool_input_not_object' });
    expect(validateTrafficIntent('x')).toEqual({ ok: false, reason: 'tool_input_not_object' });
  });

  it('rejects missing profileName', () => {
    const r = validateTrafficIntent({ ...okPayload, profileName: '' });
    expect(r.ok).toBe(false);
  });

  it('rejects out-of-range durationSeconds', () => {
    const r = validateTrafficIntent({ ...okPayload, durationSeconds: 10_000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('durationSeconds_invalid');
  });

  it('rejects overlapping phases', () => {
    const r = validateTrafficIntent({
      ...okPayload,
      phases: [
        { startS: 0, endS: 10, rps: 100, shape: 'steady', description: 'a' },
        { startS: 5, endS: 20, rps: 200, shape: 'steady', description: 'overlap' },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('phase_1_overlaps_previous');
  });

  it('rejects unknown shape', () => {
    const r = validateTrafficIntent({
      ...okPayload,
      phases: [{ startS: 0, endS: 10, rps: 100, shape: 'wavy', description: 'a' }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('phase_0_shape_invalid');
  });

  it('rejects Infinity rps', () => {
    const r = validateTrafficIntent({
      ...okPayload,
      phases: [{ startS: 0, endS: 10, rps: Infinity, shape: 'steady', description: 'a' }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('phase_0_rps_invalid');
  });

  it('rejects jitterPercent > 100', () => {
    const r = validateTrafficIntent({ ...okPayload, jitterPercent: 150 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('jitterPercent_invalid');
  });

  it('rejects endS <= startS', () => {
    const r = validateTrafficIntent({
      ...okPayload,
      phases: [{ startS: 5, endS: 5, rps: 100, shape: 'steady', description: 'a' }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('phase_0_endS_invalid');
  });

  it('defaults requestMix when absent', () => {
    const { requestMix, ...noMix } = okPayload;
    void requestMix;
    const r = validateTrafficIntent(noMix);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.requestMix).toEqual({ default: 1.0 });
  });
});
