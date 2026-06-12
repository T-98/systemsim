/**
 * @file challenges/evaluate.ts
 *
 * Pure pass/fail evaluation of a simulation run against a challenge's
 * criteria (Decisions §72). No store access, no engine access — takes the
 * run artifact + the node list, returns per-criterion results. Used by the
 * ChallengeBanner after every completed run and by the content test harness
 * that proves every shipped challenge is broken-by-default and solvable.
 */

import type { Node } from '@xyflow/react';
import type { SimComponentData } from '../types';
import type { Challenge, Criterion, CriterionResult, ComponentSelector, EvaluatableRun, MetricCriterion } from './types';

function matchIds(nodes: Node<SimComponentData>[], selector?: ComponentSelector): string[] {
  return nodes
    .filter((n) => {
      if (selector?.type && n.data.type !== selector.type) return false;
      if (selector?.label && n.data.label !== selector.label) return false;
      return true;
    })
    .map((n) => n.id);
}

const OPS: Record<MetricCriterion['op'], (a: number, b: number) => boolean> = {
  '<': (a, b) => a < b,
  '<=': (a, b) => a <= b,
  '>': (a, b) => a > b,
  '>=': (a, b) => a >= b,
};

function evaluateMetric(c: MetricCriterion, run: EvaluatableRun, nodes: Node<SimComponentData>[]): CriterionResult {
  const ids = matchIds(nodes, c.selector);
  const windowStart = c.windowStartS ?? 0;
  const samples: number[] = [];
  for (const id of ids) {
    const series = run.metricsTimeSeries[id] ?? [];
    // Series index ≈ tick ≈ sim-second (1 tick = 1s, Knowledge.md engine flow).
    for (let t = windowStart; t < series.length; t++) {
      const v = series[t][c.metric];
      if (typeof v === 'number' && Number.isFinite(v)) samples.push(v);
    }
  }
  if (samples.length === 0) {
    // No data — a criterion over a component that never reported fails loudly
    // rather than passing silently (e.g. user deleted the component).
    return { criterion: c, passed: false, observed: NaN };
  }
  const observed = c.agg === 'max'
    ? Math.max(...samples)
    : samples.reduce((s, v) => s + v, 0) / samples.length;
  return { criterion: c, passed: OPS[c.op](observed, c.value), observed };
}

function evaluateNoCrash(c: Extract<Criterion, { kind: 'noCrash' }>, run: EvaluatableRun, nodes: Node<SimComponentData>[]): CriterionResult {
  const ids = new Set(matchIds(nodes, c.selector));
  const crashes = run.log.filter(
    (l) => l.message.includes('CRASH') && l.componentId && ids.has(l.componentId),
  ).length;
  return { criterion: c, passed: crashes === 0, observed: crashes };
}

export function evaluateChallenge(
  challenge: Challenge,
  run: EvaluatableRun,
  nodes: Node<SimComponentData>[],
): { passed: boolean; results: CriterionResult[] } {
  const results = challenge.fix.criteria.map((c) =>
    c.kind === 'metric' ? evaluateMetric(c, run, nodes) : evaluateNoCrash(c, run, nodes),
  );
  return { passed: results.every((r) => r.passed), results };
}

/** Display helper: "p99 4 003 ms" / "errors 33%" / "2 crashes". */
export function formatObserved(r: CriterionResult): string {
  if (Number.isNaN(r.observed)) return 'no data';
  if (r.criterion.kind === 'noCrash') {
    return r.observed === 0 ? 'no crashes' : `${r.observed} crash${r.observed === 1 ? '' : 'es'}`;
  }
  const m = r.criterion.metric;
  if (m === 'errorRate' || m === 'cacheHitRate') return `${Math.round(r.observed * 100)}%`;
  if (m === 'p99') return `${Math.round(r.observed).toLocaleString()} ms`;
  return Math.round(r.observed).toLocaleString();
}
