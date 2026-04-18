/**
 * @file components/panels/PhaseCurve.tsx
 *
 * SVG preview of a TrafficProfile's phase sequence. Rendered above the phases
 * table in TrafficEditor so the user can see the RPS shape at a glance as
 * they edit phase fields. Shape-aware per phase:
 *
 *   steady        → horizontal line at phase.rps
 *   ramp_up       → diagonal from 0 to phase.rps
 *   ramp_down     → diagonal from previous-phase rps to phase.rps
 *   spike         → short peak triangle centered in the phase window
 *   instant_spike → instantaneous jump to phase.rps held until endS
 *
 * Hover anywhere on the chart: tooltip shows `t=<s>s, RPS=<n>` derived by
 * evaluating the phase at that x-coordinate. No store dependency — pure
 * render over the phases prop.
 */

import { useMemo, useState } from 'react';
import type { TrafficPhase } from '../../types';

const CHART_HEIGHT = 60;
const PADDING_TOP = 6;
const PADDING_BOTTOM = 12;

interface Props {
  phases: TrafficPhase[];
  durationSeconds: number;
  /** Optional test handle injected via data-testid on the <svg>. */
  testId?: string;
}

export default function PhaseCurve({ phases, durationSeconds, testId = 'phase-curve' }: Props) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; t: number; rps: number } | null>(null);

  const maxRps = useMemo(() => {
    const vals = phases.map((p) => p.rps);
    const max = vals.length > 0 ? Math.max(...vals, 0) : 0;
    // Pad a touch so the top of the curve isn't flush against the top edge.
    return max <= 0 ? 1 : max * 1.05;
  }, [phases]);

  const width = 100; // viewBox width — scales to container via preserveAspectRatio="none" for x, but we clamp with max-width
  const plotHeight = CHART_HEIGHT - PADDING_TOP - PADDING_BOTTOM;

  const scaleX = (t: number) => (durationSeconds <= 0 ? 0 : (t / durationSeconds) * width);
  const scaleY = (rps: number) => PADDING_TOP + plotHeight - (rps / maxRps) * plotHeight;

  // Build the RPS polyline as a set of (t, rps) points derived from phase shapes.
  const points = useMemo(() => buildCurvePoints(phases, durationSeconds), [phases, durationSeconds]);
  const pathD = useMemo(() => toPath(points, scaleX, scaleY), [points, scaleX, scaleY]);

  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const xInViewbox = ((e.clientX - rect.left) / rect.width) * width;
    const t = (xInViewbox / width) * durationSeconds;
    const rps = evaluateAt(phases, t);
    setTooltip({ x: e.clientX - rect.left, y: e.clientY - rect.top, t, rps });
  };

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <svg
        data-testid={testId}
        viewBox={`0 0 ${width} ${CHART_HEIGHT}`}
        preserveAspectRatio="none"
        width="100%"
        height={CHART_HEIGHT}
        onMouseMove={handleMove}
        onMouseLeave={() => setTooltip(null)}
        style={{
          background: 'var(--bg-input)',
          borderRadius: 6,
          border: '1px solid var(--border-color)',
          display: 'block',
        }}
      >
        {/* Zero-line baseline */}
        <line
          x1={0}
          y1={scaleY(0)}
          x2={width}
          y2={scaleY(0)}
          stroke="var(--border-color)"
          strokeWidth={0.3}
          vectorEffect="non-scaling-stroke"
        />
        {/* Phase boundary ticks at the bottom */}
        {phases.map((p, i) => (
          <line
            key={`tick-${i}`}
            x1={scaleX(p.endS)}
            y1={scaleY(0)}
            x2={scaleX(p.endS)}
            y2={CHART_HEIGHT - 2}
            stroke="var(--text-tertiary)"
            strokeOpacity={0.3}
            strokeWidth={0.3}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {/* Curve */}
        <path
          d={pathD}
          data-testid="phase-curve-path"
          fill="none"
          stroke="var(--accent)"
          strokeWidth={1.25}
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
        />
      </svg>
      {tooltip && (
        <div
          data-testid="phase-curve-tooltip"
          style={{
            position: 'absolute',
            left: Math.min(tooltip.x + 8, 200),
            top: Math.max(tooltip.y - 28, 0),
            padding: '3px 7px',
            borderRadius: 4,
            background: 'var(--bg-sidebar)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-color)',
            fontSize: 11,
            fontFamily: "'Geist Mono', monospace",
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            letterSpacing: '-0.12px',
          }}
        >
          t={tooltip.t.toFixed(0)}s, RPS={Math.round(tooltip.rps).toLocaleString()}
        </div>
      )}
    </div>
  );
}

// --- curve construction -----------------------------------------------------

interface CurvePoint { t: number; rps: number }

/**
 * Expand phases into a dense series of (t, rps) points. Each shape contributes:
 *  - steady / instant_spike: flat segment at phase.rps from startS to endS
 *  - ramp_up: diagonal from 0 to phase.rps
 *  - ramp_down: diagonal from previous-phase endRps to phase.rps
 *  - spike: triangle peaking mid-phase at phase.rps
 * Adjacent steps get stitched together so the path is continuous.
 */
function buildCurvePoints(phases: TrafficPhase[], durationSeconds: number): CurvePoint[] {
  const out: CurvePoint[] = [];
  if (phases.length === 0) {
    out.push({ t: 0, rps: 0 });
    out.push({ t: durationSeconds, rps: 0 });
    return out;
  }

  for (let i = 0; i < phases.length; i++) {
    const p = phases[i];
    const prev = i > 0 ? phases[i - 1] : null;
    const startRps = prev ? phaseEndRps(prev) : 0;

    switch (p.shape) {
      case 'steady':
        out.push({ t: p.startS, rps: p.rps });
        out.push({ t: p.endS, rps: p.rps });
        break;
      case 'instant_spike':
        // Pre-step to the baseline we came from (prevents slope artifacts),
        // then instantaneous jump at startS.
        if (out.length === 0) out.push({ t: p.startS, rps: 0 });
        out.push({ t: p.startS, rps: p.rps });
        out.push({ t: p.endS, rps: p.rps });
        break;
      case 'ramp_up':
        out.push({ t: p.startS, rps: 0 });
        out.push({ t: p.endS, rps: p.rps });
        break;
      case 'ramp_down':
        out.push({ t: p.startS, rps: startRps });
        out.push({ t: p.endS, rps: p.rps });
        break;
      case 'spike': {
        const mid = (p.startS + p.endS) / 2;
        out.push({ t: p.startS, rps: startRps });
        out.push({ t: mid, rps: p.rps });
        out.push({ t: p.endS, rps: startRps });
        break;
      }
    }
  }
  // Ensure the curve extends to durationSeconds even if phases don't cover it.
  const last = out[out.length - 1];
  if (last && last.t < durationSeconds) {
    out.push({ t: durationSeconds, rps: last.rps });
  }
  return out;
}

/** The "end-of-phase" rps used when subsequent ramps need a starting value. */
function phaseEndRps(p: TrafficPhase): number {
  return p.rps;
}

/**
 * Evaluate RPS at time `t` by finding the phase that contains t and
 * interpolating by its shape. Used for the hover tooltip.
 */
function evaluateAt(phases: TrafficPhase[], t: number): number {
  if (phases.length === 0) return 0;
  for (let i = 0; i < phases.length; i++) {
    const p = phases[i];
    if (t < p.startS || t > p.endS) continue;
    const progress = p.endS === p.startS ? 0 : (t - p.startS) / (p.endS - p.startS);
    const prev = i > 0 ? phases[i - 1] : null;
    const startRps = prev ? phaseEndRps(prev) : 0;
    switch (p.shape) {
      case 'steady':
      case 'instant_spike':
        return p.rps;
      case 'ramp_up':
        return p.rps * progress;
      case 'ramp_down':
        return startRps + (p.rps - startRps) * progress;
      case 'spike':
        return startRps + (p.rps - startRps) * (1 - Math.abs(progress - 0.5) * 2);
    }
  }
  return 0;
}

function toPath(points: CurvePoint[], sx: (t: number) => number, sy: (r: number) => number): string {
  if (points.length === 0) return '';
  return points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.t).toFixed(2)},${sy(p.rps).toFixed(2)}`)
    .join(' ');
}
