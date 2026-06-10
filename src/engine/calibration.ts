/**
 * @file engine/calibration.ts
 *
 * calibration.json scaffolding (SIMFID Phase 8a.2). Ships the schema that
 * Phase 5's `npx systemsim-daemon` calibration harness will emit, plus a
 * loader with hard fallbacks so the engine behaves bit-identically while
 * the shipped files contain only null anchors ("empty-default").
 *
 * Files live at `public/calibration/<hardware-class>/<primitive>-<version>.json`
 * and are fetched like templates (same pattern as TemplatePicker). A missing
 * or malformed file simply leaves that primitive absent from the set — the
 * engine's hard-coded defaults then apply, exactly as before Phase 8a.
 *
 * Anchor → engine-default mapping (only sites with a real config knob today):
 * - postgres.readThroughputRps  → database `readThroughputRps` default (50 000)
 * - postgres.writeThroughputRps → database `writeThroughputRps` default (20 000)
 * - fastify.serviceTimeMs.p50   → server `processingTimeMs` default (50)
 * - fastify.serviceVariance     → server `serviceVariance` (Kingman C_s²) default (1.0)
 * The redis profile ships schema-only: the cache model has no calibrated
 * latency knob yet — it gains one when Phase 5 lands real measurements.
 */

export interface CalibrationAnchors {
  serviceTimeMs: { p50: number | null; p99: number | null };
  serviceVariance: number | null;
  readThroughputRps: number | null;
  writeThroughputRps: number | null;
  connectionPoolExhaustionMs: number | null;
}

export interface CalibrationProfile {
  primitive: string;
  version: string;
  hardwareClass: string;
  capturedAt: string | null;
  anchors: CalibrationAnchors;
  source: string;
}

/** The primitives Phase 8a ships profiles for (Kafka deferred — plan §8a). */
export type CalibrationPrimitive = 'postgres' | 'redis' | 'fastify';

export type CalibrationSet = Partial<Record<CalibrationPrimitive, CalibrationProfile>>;

export const DEFAULT_HARDWARE_CLASS = 'laptop-m-series-16gb';

/** primitive → shipped major version, mirrored in public/calibration/. */
const PRIMITIVE_VERSIONS: Record<CalibrationPrimitive, string> = {
  postgres: '16',
  redis: '7',
  fastify: '5',
};

/**
 * All current anchors are throughputs, latencies, or variance — strictly
 * positive quantities. Zero or negative values would poison downstream math
 * (`serviceTimeMs.p50: 0` → `1000/0 = Infinity` RPS per instance in
 * QueueingModel; negative throughput → negative utilization), so they are
 * rejected at the parse boundary, same as non-numbers.
 */
function positiveOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * Validate one fetched profile at the boundary. Returns null when the file
 * is not shaped like a calibration profile (treated the same as missing).
 */
export function parseCalibrationProfile(json: unknown): CalibrationProfile | null {
  if (typeof json !== 'object' || json === null) return null;
  const o = json as Record<string, unknown>;
  if (typeof o.primitive !== 'string' || typeof o.version !== 'string') return null;
  const rawAnchors = (typeof o.anchors === 'object' && o.anchors !== null)
    ? (o.anchors as Record<string, unknown>)
    : {};
  const rawService = (typeof rawAnchors.serviceTimeMs === 'object' && rawAnchors.serviceTimeMs !== null)
    ? (rawAnchors.serviceTimeMs as Record<string, unknown>)
    : {};
  return {
    primitive: o.primitive,
    version: o.version,
    hardwareClass: typeof o.hardwareClass === 'string' ? o.hardwareClass : DEFAULT_HARDWARE_CLASS,
    capturedAt: typeof o.capturedAt === 'string' ? o.capturedAt : null,
    anchors: {
      serviceTimeMs: {
        p50: positiveOrNull(rawService.p50),
        p99: positiveOrNull(rawService.p99),
      },
      serviceVariance: positiveOrNull(rawAnchors.serviceVariance),
      readThroughputRps: positiveOrNull(rawAnchors.readThroughputRps),
      writeThroughputRps: positiveOrNull(rawAnchors.writeThroughputRps),
      connectionPoolExhaustionMs: positiveOrNull(rawAnchors.connectionPoolExhaustionMs),
    },
    source: typeof o.source === 'string' ? o.source : 'unknown',
  };
}

/**
 * Fetch the calibration set for a hardware class. Missing files, network
 * failures, and malformed JSON all degrade to "primitive absent" — never
 * throws, so callers can fire-and-forget.
 */
export async function loadCalibrationSet(
  hardwareClass: string = DEFAULT_HARDWARE_CLASS,
  fetchImpl: typeof fetch = fetch,
): Promise<CalibrationSet> {
  const set: CalibrationSet = {};
  await Promise.all(
    (Object.keys(PRIMITIVE_VERSIONS) as CalibrationPrimitive[]).map(async (primitive) => {
      const url = `/calibration/${hardwareClass}/${primitive}-${PRIMITIVE_VERSIONS[primitive]}.json`;
      try {
        const res = await fetchImpl(url);
        if (!res.ok) return;
        const profile = parseCalibrationProfile(await res.json());
        // The body must claim the primitive its filename promises — a
        // postgres-16.json declaring `primitive: "fastify"` would otherwise
        // silently apply service-time anchors as database throughput.
        if (profile && profile.primitive === primitive) set[primitive] = profile;
      } catch {
        // Network/parse failure → primitive stays absent → engine defaults.
      }
    }),
  );
  return set;
}

// ── Module-level cache for the browser app ─────────────────────────────────
//
// `primeCalibration()` is idempotent and fire-and-forget: useSimulation
// calls it on mount, and whatever has loaded by the time the user hits Run
// is what the engine sees. The shipped files are empty defaults, so racing
// the fetch changes nothing today; once Phase 5 writes real anchors the
// fetch will long have settled before any human clicks Run.

let cachedSet: CalibrationSet = {};
let primeStarted = false;

export function primeCalibration(hardwareClass: string = DEFAULT_HARDWARE_CLASS): void {
  if (primeStarted) return;
  primeStarted = true;
  void loadCalibrationSet(hardwareClass).then((set) => {
    cachedSet = set;
  });
}

export function getCalibrationSet(): CalibrationSet {
  return cachedSet;
}

/** Test hook: reset the module cache between vitest cases. */
export function __resetCalibrationForTests(): void {
  cachedSet = {};
  primeStarted = false;
}
