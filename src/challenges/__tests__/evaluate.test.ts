import { describe, it, expect } from 'vitest';
import { evaluateChallenge, formatObserved } from '../evaluate';
import { parseChain } from '../../wiki/components/FlowDiagram';
import type { Challenge, EvaluatableRun } from '../types';
import type { Node } from '@xyflow/react';
import type { SimComponentData, ComponentMetrics } from '../../types';

function node(id: string, type: string, label: string): Node<SimComponentData> {
  return {
    id, position: { x: 0, y: 0 },
    data: { type: type as SimComponentData['type'], label, config: {}, health: 'healthy', metrics: {} as ComponentMetrics },
  } as Node<SimComponentData>;
}

function series(values: Partial<ComponentMetrics>[]): ComponentMetrics[] {
  return values.map((v) => ({ rps: 0, p50: 0, p95: 0, p99: 0, errorRate: 0, cpuPercent: 0, memoryPercent: 0, ...v }));
}

const baseChallenge = (criteria: Challenge['fix']['criteria']): Challenge => ({
  id: 't', title: 't', kbRef: '§0', topicKey: 'x', difficulty: 'intro', tagline: '', brief: '', symptom: '',
  graph: { nodes: [], edges: [] },
  starter: { trafficProfile: { profileName: 't', durationSeconds: 1, phases: [], requestMix: {}, userDistribution: 'uniform', jitterPercent: 0 } },
  diagnosis: { question: '', options: [] },
  fix: { objective: '', criteria, hints: [] },
  knownFix: [],
});

describe('evaluateChallenge', () => {
  const nodes = [node('queue-0', 'queue', 'Q'), node('server-1', 'server', 'S')];

  it('metric max with selector and window', () => {
    const run: EvaluatableRun = {
      metricsTimeSeries: {
        'queue-0': series([{ queueDepth: 9000 }, { queueDepth: 100 }, { queueDepth: 200 }]),
        'server-1': series([{ queueDepth: 0 }, { queueDepth: 0 }, { queueDepth: 0 }]),
      },
      log: [],
    };
    const c = baseChallenge([
      { kind: 'metric', metric: 'queueDepth', selector: { type: 'queue' }, agg: 'max', op: '<', value: 500, windowStartS: 1, label: 'depth' },
    ]);
    // Tick 0 (9000) is outside the window — only 100/200 count.
    expect(evaluateChallenge(c, run, nodes).passed).toBe(true);
    const noWindow = baseChallenge([
      { kind: 'metric', metric: 'queueDepth', selector: { type: 'queue' }, agg: 'max', op: '<', value: 500, label: 'depth' },
    ]);
    expect(evaluateChallenge(noWindow, run, nodes).passed).toBe(false);
  });

  it('a criterion over a missing component fails loudly, never passes silently', () => {
    const run: EvaluatableRun = { metricsTimeSeries: {}, log: [] };
    const c = baseChallenge([
      { kind: 'metric', metric: 'errorRate', selector: { label: 'Deleted' }, agg: 'max', op: '<', value: 1, label: 'x' },
    ]);
    const { passed, results } = evaluateChallenge(c, run, nodes);
    expect(passed).toBe(false);
    expect(Number.isNaN(results[0].observed)).toBe(true);
    expect(formatObserved(results[0])).toBe('no data');
  });

  it('noCrash scans the log scoped by selector', () => {
    const run: EvaluatableRun = {
      metricsTimeSeries: {},
      log: [{ time: 5, message: 'server-1 CRASH. CPU exhausted.', severity: 'critical', componentId: 'server-1' }],
    };
    const all = baseChallenge([{ kind: 'noCrash', label: 'nothing crashes' }]);
    expect(evaluateChallenge(all, run, nodes).passed).toBe(false);
    const queueOnly = baseChallenge([{ kind: 'noCrash', selector: { type: 'queue' }, label: 'queue lives' }]);
    expect(evaluateChallenge(queueOnly, run, nodes).passed).toBe(true);
  });
});

describe('FlowDiagram parseChain', () => {
  it('parses typed nodes, generics, rows, and arrow flavors', () => {
    const rows = parseChain('lb:Edge LB -> server:API ×3 -x-> db missing | client:Users -?-> cache:Redis');
    expect(rows).toHaveLength(2);
    expect(rows[0].nodes.map((n) => n.type)).toEqual(['load_balancer'.startsWith('l') ? 'generic' : 'generic', 'server', 'generic'].map((_, i) =>
      // lb is not a ComponentType — falls back to generic; server is real; bare label generic.
      i === 1 ? 'server' : 'generic'));
    expect(rows[0].arrows).toEqual(['normal', 'failure']);
    expect(rows[1].nodes[0].type).toBe('client');
    expect(rows[1].arrows).toEqual(['optional']);
  });

  it('real component types carry through', () => {
    const rows = parseChain('load_balancer:LB -> queue:Jobs -> database:PG');
    expect(rows[0].nodes.map((n) => n.type)).toEqual(['load_balancer', 'queue', 'database']);
  });
});
