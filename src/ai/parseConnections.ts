/**
 * @file ai/parseConnections.ts
 *
 * Parses the `connections` lines from an intent spec into canonical edges.
 * Accepts `A --> B`, `A → B`, and `A --label--> B` formats. Matches labels
 * fuzzily to detected components (case-insensitive, trimmed).
 */

import type { DetectedComponent } from './describeIntentSchema';
import type { CanonicalGraph, CanonicalNode } from '../types';

export interface ParsedEdge {
  sourceLabel: string;
  targetLabel: string;
  edgeLabel?: string;
}

export type ParseLineResult =
  | { ok: true; edge: ParsedEdge }
  | { ok: false; reason: 'blank' | 'no_arrow' | 'empty_side' };

const ARROW_SPLIT = /\s*-->\s*|\s*→\s*/;
const LABELED_LEFT = /^(.+?)\s+--([^-](?:.*?))\s*$/;

export function parseConnectionLine(raw: string): ParseLineResult {
  const line = raw.trim();
  if (!line || line.startsWith('#') || line.startsWith('//')) {
    return { ok: false, reason: 'blank' };
  }
  const parts = line.split(ARROW_SPLIT);
  if (parts.length !== 2) {
    return { ok: false, reason: 'no_arrow' };
  }
  const [leftRaw, rightRaw] = parts;
  const right = rightRaw.trim();
  if (!right) {
    return { ok: false, reason: 'empty_side' };
  }

  const leftLabeled = leftRaw.match(LABELED_LEFT);
  if (leftLabeled) {
    const source = leftLabeled[1].trim();
    const edgeLabel = leftLabeled[2].trim();
    if (!source) return { ok: false, reason: 'empty_side' };
    return { ok: true, edge: { sourceLabel: source, targetLabel: right, edgeLabel } };
  }

  const source = leftRaw.trim();
  if (!source) return { ok: false, reason: 'empty_side' };
  return { ok: true, edge: { sourceLabel: source, targetLabel: right } };
}

export interface ParseConnectionsError {
  line: string;
  lineNumber: number;
  reason: 'no_arrow' | 'empty_side' | 'unknown_source' | 'unknown_target' | 'self_loop';
  hint?: string;
}

export interface ParseConnectionsResult {
  edges: ParsedEdge[];
  errors: ParseConnectionsError[];
  unusedComponents: DetectedComponent[];
}

function normalizeForMatch(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function parseConnections(
  connectionsText: string,
  components: DetectedComponent[]
): ParseConnectionsResult {
  const byNormalized = new Map<string, DetectedComponent>();
  for (const c of components) {
    byNormalized.set(normalizeForMatch(c.label), c);
  }

  const edges: ParsedEdge[] = [];
  const errors: ParseConnectionsError[] = [];
  const usedLabels = new Set<string>();

  const lines = connectionsText.split(/\r?\n/);
  lines.forEach((line, idx) => {
    const result = parseConnectionLine(line);
    if (!result.ok) {
      if (result.reason === 'blank') return;
      errors.push({
        line: line.trim(),
        lineNumber: idx + 1,
        reason: result.reason,
        hint:
          result.reason === 'no_arrow'
            ? 'Use the form "source --> target" (one per line).'
            : 'Both sides of the arrow must be non-empty.',
      });
      return;
    }

    const { sourceLabel, targetLabel, edgeLabel } = result.edge;
    const sourceKey = normalizeForMatch(sourceLabel);
    const targetKey = normalizeForMatch(targetLabel);

    const source = byNormalized.get(sourceKey);
    const target = byNormalized.get(targetKey);

    if (!source) {
      errors.push({
        line: line.trim(),
        lineNumber: idx + 1,
        reason: 'unknown_source',
        hint: `"${sourceLabel}" is not in the components list.`,
      });
      return;
    }
    if (!target) {
      errors.push({
        line: line.trim(),
        lineNumber: idx + 1,
        reason: 'unknown_target',
        hint: `"${targetLabel}" is not in the components list.`,
      });
      return;
    }
    if (sourceKey === targetKey) {
      errors.push({
        line: line.trim(),
        lineNumber: idx + 1,
        reason: 'self_loop',
        hint: 'A component cannot connect to itself.',
      });
      return;
    }

    usedLabels.add(sourceKey);
    usedLabels.add(targetKey);
    edges.push({
      sourceLabel: source.label,
      targetLabel: target.label,
      edgeLabel,
    });
  });

  const unusedComponents = components.filter(
    (c) => !usedLabels.has(normalizeForMatch(c.label))
  );

  return { edges, errors, unusedComponents };
}

/**
 * Build a CanonicalGraph from detected components and parsed edges.
 * IDs are type-indexed (matching the existing validateAndRewrite convention).
 */
export function buildCanonicalGraph(
  components: DetectedComponent[],
  edges: ParsedEdge[]
): CanonicalGraph {
  const nodes: CanonicalNode[] = components.map((c) => ({
    type: c.type,
    label: c.label,
  }));

  const labelToId = new Map<string, string>();
  components.forEach((c, i) => {
    labelToId.set(normalizeForMatch(c.label), `${c.type}-${i}`);
  });

  const canonicalEdges = edges
    .map((e) => {
      const source = labelToId.get(normalizeForMatch(e.sourceLabel));
      const target = labelToId.get(normalizeForMatch(e.targetLabel));
      if (!source || !target) return null;
      return { source, target };
    })
    .filter((e): e is { source: string; target: string } => e !== null);

  return { nodes, edges: canonicalEdges };
}

export function formatConnectionsForDisplay(
  edges: ParsedEdge[]
): string {
  return edges
    .map((e) =>
      e.edgeLabel
        ? `${e.sourceLabel} --${e.edgeLabel}--> ${e.targetLabel}`
        : `${e.sourceLabel} --> ${e.targetLabel}`
    )
    .join('\n');
}
