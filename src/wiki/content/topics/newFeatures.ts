/**
 * @file wiki/content/topics/newFeatures.ts
 *
 * Topic entries for SIMFID Phase 8a features: the BOTE capacity estimator
 * inputs (`config.bote.*`), the Kingman service-variance config knob, and
 * the capacity-planning how-to. Merged into `TOPICS` by `wiki/topics.ts`
 * the same way the generated modules are.
 *
 * `howto.capacityPlanning` ships with an empty body on purpose — the
 * build-time generator fills it from
 * `src/wiki/content/howto/06-capacityPlanning.md`, exactly like the other
 * five how-to stubs.
 */

import type { Topic } from '../../topics';

export const NEW_FEATURE_TOPICS: Record<string, Topic> = {
  'config.serviceVariance': {
    title: 'Service variance (C_s²)',
    shortDescription:
      'C_s² in the Kingman wait-time formula — service-time variability. 1.0 = exponential (M/M/1); <1 near-deterministic; >1 long-tailed (GC, I/O).',
    body: `# Service variance (C_s²)

The squared coefficient of variation of service times, fed into the Kingman G/G/1 wait-time formula: \`wait ≈ ρ/(1−ρ) × (Cₐ² + C_s²)/2 × serviceTime\`. The default 1.0 models an exponential service distribution, which collapses the formula to the classic M/M/1 case. Values below 1.0 model near-deterministic work — batch jobs that finish in consistent time — and cut queueing delay. Values above 1.0 model long-tailed service (GC pauses, variable I/O) and stretch the p99. At the same utilization, a burstier service distribution queues longer — that is the lesson this knob teaches.`,
    category: 'config',
  },

  'howto.capacityPlanning': {
    title: 'Size a system from a guess',
    shortDescription:
      'Open the capacity estimator, size a gut-feel design for 1M DAU, apply the two-phase profile, and watch the peak spike saturate it.',
    body: '',
    category: 'howto',
    howtoTemplate: 'capacityPlanning',
  },

  'config.bote.dau': {
    title: 'Daily active users',
    shortDescription:
      'Daily active users — the headline scale input. Drives average QPS: DAU × actions per user / 86,400 seconds in a day.',
    body: `# Daily active users

The headline scale number for back-of-envelope estimation: how many distinct users hit the system per day. It anchors the average-QPS formula — DAU × actions per user per day, spread over the 86,400 seconds in a day. Every other estimate (peak QPS, storage, connections) scales from it. The same design problem has radically different answers at 100 DAU vs 100M DAU. See §5 Back-of-Envelope Resource Estimation and §47 for the estimator's full formula set.`,
    category: 'config',
  },

  'config.bote.actionsPerUserPerDay': {
    title: 'Actions per user per day',
    shortDescription:
      'Requests each user fires per day — page loads, posts, likes. Multiplies DAU in the average-QPS formula: DAU × actions / 86,400.',
    body: `# Actions per user per day

How many requests each active user fires in a day — page loads, posts, likes, every API call counts. It multiplies DAU in the average-QPS formula: average QPS = DAU × actions / 86,400. A passive-consumption product might sit at 5–20; a chat or trading app can run into the hundreds. Getting this within 2× matters more than getting it exact. See §5 Back-of-Envelope Resource Estimation and §47.`,
    category: 'config',
  },

  'config.bote.readRatio': {
    title: 'Read share',
    shortDescription:
      'Fraction of actions that are reads, 0–1. Splits average QPS into read vs write QPS; only the write share consumes storage.',
    body: `# Read share

The fraction of actions that are reads, from 0 to 1; the remainder are writes. It splits average QPS into read QPS and write QPS, and only the write share feeds the storage formulas. Social feeds run extremely read-heavy (0.99); analytics ingest can be write-heavy (0.5 or lower). The ratio drives replica strategy and cache aggressiveness, so write it down before picking components. See §5 Back-of-Envelope Resource Estimation and §47.`,
    category: 'config',
  },

  'config.bote.payloadBytes': {
    title: 'Payload per write',
    shortDescription:
      'Average bytes persisted per write action. The per-record size in the storage formulas: storage = write QPS × payload × seconds.',
    body: `# Payload per write

The average number of bytes persisted by each write action — the per-record size in the storage formulas. Monthly growth is write QPS × payload × the seconds in a 30-day month; the retention estimate uses the same daily volume over the retention window. A tweet-sized record is ~1 KB; a photo post is megabytes and usually belongs in blob storage, not the database rows you size here. Remember replication multiplies the raw figure (3 replicas = 3× the bytes). See §5 Back-of-Envelope Resource Estimation and §47.`,
    category: 'config',
  },

  'config.bote.retentionDays': {
    title: 'Retention',
    shortDescription:
      'How long written data is kept, in days. Storage at retention = daily write volume × retention days — the steady-state footprint.',
    body: `# Retention

How long written data is kept before deletion or archive, in days. The estimator multiplies the daily write volume (write QPS × payload × 86,400) by this window to get the steady-state storage footprint — the disk you actually have to provision, as opposed to the monthly growth rate. 365 days is a common default; logs and events often archive sooner, regulated data later. See §5 Back-of-Envelope Resource Estimation and §47.`,
    category: 'config',
  },

  'config.bote.peakMultiplier': {
    title: 'Peak-to-average multiplier',
    shortDescription:
      'Peak traffic as a multiple of the daily average. Peak QPS = average QPS × multiplier; 3× is the industry rule of thumb.',
    body: `# Peak-to-average multiplier

Peak traffic expressed as a multiple of the daily average: peak QPS = average QPS × this multiplier. Traffic is never flat — diurnal cycles, lunch-hour spikes, and launch events all push the busy hour well above the mean, and 3× is the standard rule of thumb. Size capacity for the peak, not the average; average-based sizing is the classic way designs die. The estimator's "Apply to traffic profile" uses this number for its spike phase. See §5 Back-of-Envelope Resource Estimation and §47.`,
    category: 'config',
  },

  'config.bote.avgResponseTimeMs': {
    title: 'Avg response time',
    shortDescription:
      'How long a request stays in flight, in ms — the W in Little’s Law. Concurrent requests N = QPS × W (in seconds).',
    body: `# Avg response time

How long a request stays in flight, in milliseconds — the W in Little's Law. The estimator computes concurrent in-flight requests as N = QPS × W (with W in seconds), at both average and peak QPS. That N is what sizes socket budgets, thread pools, and connection pools: 347 QPS at 100ms is only ~35 concurrent requests, but the same QPS at 2s is ~700. Long-lived connections (WebSockets, chat) blow far past this estimate — they hold W open indefinitely. See §5 Back-of-Envelope Resource Estimation and §47.`,
    category: 'config',
  },
};
