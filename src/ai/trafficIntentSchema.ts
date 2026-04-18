/**
 * @file ai/trafficIntentSchema.ts
 *
 * Tool-use schema + validator for the `traffic_intent` Anthropic tool.
 * Input: a natural-language description of traffic ("ramp from 5 to 100
 * rps over 30s, spike to 300 for 5s, cool down"). Output: a validated
 * TrafficProfile JSON the engine can consume directly.
 *
 * Hand-rolled validator (no Zod) matches the shape of describeIntentSchema
 * so error messages and failure modes are consistent across endpoints.
 */

import type { TrafficPhase, TrafficProfile } from '../types';

const SHAPES = ['steady', 'spike', 'instant_spike', 'ramp_up', 'ramp_down'] as const;
const USER_DISTRIBUTIONS = ['uniform', 'pareto'] as const;

const MAX_PHASES = 20;
const MAX_DURATION_SECONDS = 3600;
const MAX_DESC_CHARS = 200;
const MAX_PROFILE_NAME_CHARS = 80;
const MAX_RPS = 10_000_000;

export type ValidationResult =
  | { ok: true; data: TrafficProfile }
  | { ok: false; reason: string };

export const TRAFFIC_INTENT_TOOL_SCHEMA = {
  name: 'traffic_intent',
  description:
    'Emit a validated traffic profile describing an arrival-rate curve over time. Phases are ordered, non-overlapping. shape=ramp_up starts at 0 RPS, ramp_down starts at the previous phase RPS, spike peaks in the middle, instant_spike jumps immediately.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['profileName', 'durationSeconds', 'phases', 'userDistribution', 'jitterPercent'],
    properties: {
      profileName: {
        type: 'string',
        description: 'short snake_case identifier (e.g. "launch_day_spike")',
      },
      durationSeconds: {
        type: 'number',
        description: 'total duration in seconds; >= 1, <= 3600',
      },
      phases: {
        type: 'array',
        minItems: 1,
        maxItems: MAX_PHASES,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['startS', 'endS', 'rps', 'shape', 'description'],
          properties: {
            startS: { type: 'number', description: 'start time seconds' },
            endS: { type: 'number', description: 'end time seconds (>= startS)' },
            rps: { type: 'number', description: 'requests per second at the peak of this phase' },
            shape: { type: 'string', enum: SHAPES as unknown as string[] },
            description: { type: 'string', description: 'short phrase describing what this phase represents' },
          },
        },
      },
      userDistribution: { type: 'string', enum: USER_DISTRIBUTIONS as unknown as string[] },
      jitterPercent: { type: 'number', description: 'relative jitter on arrival times, 0–100' },
      requestMix: {
        type: 'object',
        description: 'map of endpoint label -> weight (0..1). Omit if unknown.',
        additionalProperties: { type: 'number' },
      },
    },
  },
} as const;

export function validateTrafficIntent(raw: unknown): ValidationResult {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, reason: 'tool_input_not_object' };
  }
  const obj = raw as Record<string, unknown>;

  const profileName = obj.profileName;
  if (typeof profileName !== 'string' || profileName.trim().length === 0 || profileName.length > MAX_PROFILE_NAME_CHARS) {
    return { ok: false, reason: 'profileName_invalid' };
  }

  const durationSeconds = obj.durationSeconds;
  if (typeof durationSeconds !== 'number' || !Number.isFinite(durationSeconds) || durationSeconds < 1 || durationSeconds > MAX_DURATION_SECONDS) {
    return { ok: false, reason: 'durationSeconds_invalid' };
  }

  const phasesRaw = obj.phases;
  if (!Array.isArray(phasesRaw) || phasesRaw.length === 0 || phasesRaw.length > MAX_PHASES) {
    return { ok: false, reason: 'phases_invalid' };
  }

  const phases: TrafficPhase[] = [];
  let prevEnd = 0;
  for (let i = 0; i < phasesRaw.length; i++) {
    const p = phasesRaw[i];
    if (typeof p !== 'object' || p === null) return { ok: false, reason: `phase_${i}_not_object` };
    const pr = p as Record<string, unknown>;
    const startS = pr.startS;
    const endS = pr.endS;
    const rps = pr.rps;
    const shape = pr.shape;
    const description = pr.description;

    if (typeof startS !== 'number' || !Number.isFinite(startS) || startS < 0) {
      return { ok: false, reason: `phase_${i}_startS_invalid` };
    }
    if (typeof endS !== 'number' || !Number.isFinite(endS) || endS <= startS || endS > durationSeconds) {
      return { ok: false, reason: `phase_${i}_endS_invalid` };
    }
    if (typeof rps !== 'number' || !Number.isFinite(rps) || rps < 0 || rps > MAX_RPS) {
      return { ok: false, reason: `phase_${i}_rps_invalid` };
    }
    if (typeof shape !== 'string' || !(SHAPES as readonly string[]).includes(shape)) {
      return { ok: false, reason: `phase_${i}_shape_invalid` };
    }
    if (typeof description !== 'string' || description.length > MAX_DESC_CHARS) {
      return { ok: false, reason: `phase_${i}_description_invalid` };
    }
    if (i > 0 && startS < prevEnd) {
      return { ok: false, reason: `phase_${i}_overlaps_previous` };
    }
    prevEnd = endS;
    phases.push({
      startS,
      endS,
      rps,
      shape: shape as TrafficPhase['shape'],
      description,
    });
  }

  const userDistribution = obj.userDistribution;
  if (typeof userDistribution !== 'string' || !(USER_DISTRIBUTIONS as readonly string[]).includes(userDistribution)) {
    return { ok: false, reason: 'userDistribution_invalid' };
  }

  const jitterPercent = obj.jitterPercent;
  if (typeof jitterPercent !== 'number' || !Number.isFinite(jitterPercent) || jitterPercent < 0 || jitterPercent > 100) {
    return { ok: false, reason: 'jitterPercent_invalid' };
  }

  // requestMix is optional; if present, validate lightly (numeric weights).
  let requestMix: Record<string, number> = { default: 1.0 };
  if (obj.requestMix !== undefined) {
    if (typeof obj.requestMix !== 'object' || obj.requestMix === null || Array.isArray(obj.requestMix)) {
      return { ok: false, reason: 'requestMix_invalid' };
    }
    const mix: Record<string, number> = {};
    for (const [k, v] of Object.entries(obj.requestMix as Record<string, unknown>)) {
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
        return { ok: false, reason: `requestMix_${k}_invalid` };
      }
      mix[k] = v;
    }
    if (Object.keys(mix).length > 0) requestMix = mix;
  }

  return {
    ok: true,
    data: {
      profileName,
      durationSeconds,
      phases,
      requestMix,
      userDistribution: userDistribution as 'uniform' | 'pareto',
      jitterPercent,
    },
  };
}
