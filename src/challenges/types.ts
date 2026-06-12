/**
 * @file challenges/types.ts
 *
 * Drill system (Decisions §72): a challenge recreates a BROKEN production
 * scenario on the canvas, auto-runs it so the user sees the failure live,
 * then walks them through diagnose (multiple choice, checkable without AI)
 * and fix (edit the design, re-run, machine-verified criteria).
 *
 * Challenge JSON lives in /public/challenges/<id>.json. Node references in
 * selectors and knownFix use LABELS (stable, human-authored); the loader and
 * test harness resolve them against replaceGraph's `${type}-${index}` ids.
 */

import type { CanonicalGraph, TrafficProfile, SchemaMemoryBlock, ApiContract, ComponentType, LogEntry, ComponentMetrics } from '../types';

/** Which components a criterion inspects. Empty selector = every component. */
export interface ComponentSelector {
  type?: ComponentType;
  label?: string;
}

export interface MetricCriterion {
  kind: 'metric';
  /** Field of ComponentMetrics to inspect. */
  metric: 'errorRate' | 'p99' | 'queueDepth' | 'cpuPercent' | 'cacheHitRate';
  selector?: ComponentSelector;
  /** max = worst tick across matched components; avg = mean over ticks+components. */
  agg: 'max' | 'avg';
  op: '<' | '<=' | '>' | '>=';
  value: number;
  /** Ignore ticks before this sim-second (skip cold-start noise). */
  windowStartS?: number;
  /** Human-readable goal shown in the HUD, e.g. "Queue depth stays under 5 000". */
  label: string;
}

export interface NoCrashCriterion {
  kind: 'noCrash';
  selector?: ComponentSelector;
  label: string;
}

export type Criterion = MetricCriterion | NoCrashCriterion;

export interface CriterionResult {
  criterion: Criterion;
  passed: boolean;
  /** The measured value (worst/avg metric, or crash count) for display. */
  observed: number;
}

export interface DiagnosisOption {
  id: string;
  text: string;
  correct: boolean;
  /** Shown after the user picks this option — teaches either way. */
  explain: string;
}

/** A graph edit the test harness applies to prove the challenge is solvable.
 *  Also powers a future "show me the answer" affordance. */
export type FixOp =
  | { op: 'updateConfig'; label: string; patch: Record<string, unknown> }
  | { op: 'updateWireConfig'; sourceLabel: string; targetLabel: string; patch: Record<string, unknown> }
  | { op: 'addNode'; node: { type: ComponentType; label: string; config?: Record<string, unknown> } }
  | { op: 'addEdge'; sourceLabel: string; targetLabel: string; config?: Record<string, unknown> }
  | { op: 'removeEdge'; sourceLabel: string; targetLabel: string };

export interface Challenge {
  id: string;
  title: string;
  /** KB section this drills, e.g. "§13" — links back to the Reference page. */
  kbRef: string;
  /** Reference topic key for the "study up" link, e.g. "reference.13-message-queues-async-communication". */
  topicKey: string;
  difficulty: 'intro' | 'intermediate' | 'hard';
  /** One-line on-call story for the card + HUD. */
  tagline: string;
  /** The observe-phase story: what just happened, what the user is looking at. */
  brief: string;
  /** What to watch in the log/metrics during the observe run. */
  symptom: string;
  graph: CanonicalGraph;
  starter: {
    trafficProfile: TrafficProfile;
    schemaMemory?: SchemaMemoryBlock;
    apiContracts?: ApiContract[];
  };
  diagnosis: {
    question: string;
    options: DiagnosisOption[];
  };
  fix: {
    objective: string;
    criteria: Criterion[];
    hints: string[];
  };
  /** Applied by the content test harness to prove solvability. */
  knownFix: FixOp[];
}

export interface ChallengeIndexEntry {
  id: string;
  title: string;
  kbRef: string;
  difficulty: Challenge['difficulty'];
  tagline: string;
}

/** Minimal slice of a run the evaluator needs (subset of SimulationRun). */
export interface EvaluatableRun {
  metricsTimeSeries: Record<string, ComponentMetrics[]>;
  log: LogEntry[];
}

export type ChallengeStep = 'observe' | 'diagnose' | 'fix' | 'passed';
