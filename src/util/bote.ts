/**
 * @file util/bote.ts
 *
 * Back-of-the-envelope capacity math (SIMFID Phase 8a.1). Pure functions,
 * no engine coupling — the BOTE panel renders these numbers live and can
 * project them into a two-phase TrafficProfile.
 *
 * Formulas (the classic interview-whiteboard set):
 * - avg QPS            = DAU × actions-per-user-per-day / 86 400
 * - peak QPS           = avg QPS × peak multiplier (default 3×)
 * - write QPS          = avg QPS × (1 − read ratio)
 * - storage growth/mo  = write QPS × payload bytes × 86 400 × 30
 * - storage @retention = write QPS × payload bytes × 86 400 × retention days
 * - concurrent conns   = QPS × avg response time (Little's Law, N = λ × W)
 */

import type { TrafficProfile } from '../types';

export interface BoteInputs {
  /** Daily active users. */
  dau: number;
  /** Actions (requests) each user performs per day. */
  actionsPerUserPerDay: number;
  /** Share of actions that are reads, 0..1. The rest are writes. */
  readRatio: number;
  /** Average payload persisted per WRITE action, in bytes. */
  payloadBytes: number;
  /** How long written data is retained, in days. */
  retentionDays: number;
  /** Peak-to-average traffic ratio. Industry default 3×. */
  peakMultiplier: number;
  /** Average response time in ms — the W in Little's Law. */
  avgResponseTimeMs: number;
}

export interface BoteEstimates {
  avgQps: number;
  peakQps: number;
  readQps: number;
  writeQps: number;
  /** Bytes written per 30-day month. */
  storageBytesPerMonth: number;
  /** Steady-state bytes held at the retention window. */
  storageBytesAtRetention: number;
  /** Concurrent in-flight requests at average load (Little's Law). */
  avgConcurrentConnections: number;
  /** Concurrent in-flight requests at peak load (Little's Law). */
  peakConcurrentConnections: number;
}

export const DEFAULT_BOTE_INPUTS: BoteInputs = {
  dau: 1_000_000,
  actionsPerUserPerDay: 10,
  readRatio: 0.8,
  payloadBytes: 1_024,
  retentionDays: 365,
  peakMultiplier: 3,
  avgResponseTimeMs: 100,
};

const SECONDS_PER_DAY = 86_400;

/** Clamp non-finite / negative user input to 0 so the math never NaNs. */
function safe(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function computeBote(inputs: BoteInputs): BoteEstimates {
  const dau = safe(inputs.dau);
  const actions = safe(inputs.actionsPerUserPerDay);
  const readRatio = Math.min(1, Math.max(0, Number.isFinite(inputs.readRatio) ? inputs.readRatio : 0));
  const payload = safe(inputs.payloadBytes);
  const retention = safe(inputs.retentionDays);
  // A peak below 1× average is nonsensical — clamp up to 1.
  const peakMult = Math.max(1, safe(inputs.peakMultiplier));
  const rtSeconds = safe(inputs.avgResponseTimeMs) / 1000;

  const avgQps = (dau * actions) / SECONDS_PER_DAY;
  const peakQps = avgQps * peakMult;
  const readQps = avgQps * readRatio;
  const writeQps = avgQps - readQps;
  const bytesPerDay = writeQps * payload * SECONDS_PER_DAY;

  return {
    avgQps,
    peakQps,
    readQps,
    writeQps,
    storageBytesPerMonth: bytesPerDay * 30,
    storageBytesAtRetention: bytesPerDay * retention,
    avgConcurrentConnections: avgQps * rtSeconds,
    peakConcurrentConnections: peakQps * rtSeconds,
  };
}

/**
 * Project BOTE estimates into a two-phase TrafficProfile: a steady baseline
 * at avg QPS for the first ~2/3 of the run, then a spike to peak QPS.
 * Non-phase fields are preserved from `existing` when present so a user's
 * requestMix / distribution choices survive the overwrite (the spec only
 * replaces `phases`).
 */
export function toTwoPhaseProfile(
  estimates: BoteEstimates,
  existing: TrafficProfile | null,
  durationSeconds = 60,
): TrafficProfile {
  const spikeStart = Math.round(durationSeconds * (2 / 3));
  const avg = Math.max(1, Math.round(estimates.avgQps));
  const peak = Math.max(avg, Math.round(estimates.peakQps));
  return {
    profileName: 'BOTE estimate',
    durationSeconds,
    requestMix: existing?.requestMix ?? {},
    userDistribution: existing?.userDistribution ?? 'uniform',
    jitterPercent: existing?.jitterPercent ?? 5,
    ...(existing?.largeServerConcentration !== undefined
      ? { largeServerConcentration: existing.largeServerConcentration }
      : {}),
    phases: [
      {
        startS: 0,
        endS: spikeStart,
        rps: avg,
        shape: 'steady',
        description: `Baseline average (${avg} RPS from BOTE)`,
      },
      {
        startS: spikeStart,
        endS: durationSeconds,
        rps: peak,
        shape: 'spike',
        description: `Peak load (${peak} RPS, ${estimates.avgQps > 0 ? (peak / avg).toFixed(1) : '0'}× baseline)`,
      },
    ],
  };
}

/** "1.2 GB", "340 MB", "12 KB" — humanized base-1024 bytes for the panel. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log2(bytes) / 10));
  const v = bytes / 2 ** (10 * i);
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

/** "1.2M", "340K", "12" — humanized counts for the panel. */
export function formatCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n >= 100 ? String(Math.round(n)) : n.toFixed(1);
}
