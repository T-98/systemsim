import { describe, it, expect } from 'vitest';
import { generateDebrief } from '../debrief';
import { buildSimulationSummary } from '../buildSimulationSummary';
import { generateDebriefHtml } from '../generateDebriefHtml';
import type { SimComponentData, WireConfig, SimulationRun, TrafficProfile } from '../../types';
import type { Node, Edge } from '@xyflow/react';

function makeNode(id: string, type: string, config: Record<string, unknown> = {}): Node<SimComponentData> {
  return {
    id,
    position: { x: 0, y: 0 },
    data: {
      type: type as SimComponentData['type'],
      label: id,
      config: { instanceCount: 1, ...config },
      health: 'healthy',
      metrics: { rps: 0, p50: 0, p95: 0, p99: 0, errorRate: 0, cpuPercent: 0, memoryPercent: 0 },
    },
  } as Node<SimComponentData>;
}

function makeEdge(id: string, source: string, target: string): Edge<{ config: WireConfig }> {
  return {
    id,
    source,
    target,
    data: { config: { throughputRps: 100000, latencyMs: 5, jitterMs: 1 } },
  } as Edge<{ config: WireConfig }>;
}

function makeRun(): SimulationRun {
  const profile: TrafficProfile = {
    name: 'test',
    durationSeconds: 60,
    jitterPercent: 0,
    phases: [{ startS: 0, endS: 60, rps: 1000, shape: 'steady', description: 'test' }],
    requestMix: {},
    userDistribution: 'uniform',
  };
  return {
    runId: 'test-run',
    timestamp: new Date().toISOString(),
    schemaVersion: 1,
    trafficProfile: profile,
    metricsTimeSeries: {
      'server-1': Array.from({ length: 60 }, (_, i) => ({
        rps: 1000,
        p50: 50,
        p95: 150,
        p99: 300,
        errorRate: i > 30 ? 0.1 : 0,
        cpuPercent: Math.min(100, 30 + i * 2),
        memoryPercent: 40,
      })),
    },
    log: [
      { time: 15, message: 'server-1: CRITICAL — CPU 92%, MEM 40%.', severity: 'critical' as const, componentId: 'server-1' },
      { time: 20, message: 'server-1 CRASH. CPU exhausted.', severity: 'critical' as const, componentId: 'server-1' },
      { time: 5, message: 'Normal load', severity: 'info' as const },
    ],
  };
}

describe('generateDebrief', () => {
  it('should produce summary, questions, flags, and scores', () => {
    const nodes = [
      makeNode('gw', 'api_gateway', { rateLimitRps: 50000, authMiddleware: 'none' }),
      makeNode('s', 'server', { maxConcurrent: 1000, processingTimeMs: 50, instanceCount: 1 }),
    ];
    const edges = [makeEdge('e1', 'gw', 's')];

    const debrief = generateDebrief({
      nodes,
      edges,
      functionalReqs: [],
      nonFunctionalReqs: [],
      apiContracts: [],
      schemaMemory: null,
      simulationRun: makeRun(),
      scenarioId: 'discord_notification_fanout',
    });

    expect(debrief.summary).toBeTruthy();
    expect(debrief.scores.coherence).toBeGreaterThanOrEqual(0);
    expect(debrief.scores.coherence).toBeLessThanOrEqual(100);
    expect(debrief.scores.security).toBeGreaterThanOrEqual(0);
    expect(debrief.scores.performance).toBeGreaterThanOrEqual(0);
    expect(debrief.aiAvailable).toBe(false);
  });

  it('should flag API gateway with no auth', () => {
    const nodes = [makeNode('gw', 'api_gateway', { authMiddleware: 'none' })];
    const debrief = generateDebrief({
      nodes,
      edges: [],
      functionalReqs: [],
      nonFunctionalReqs: [],
      apiContracts: [],
      schemaMemory: null,
      simulationRun: makeRun(),
      scenarioId: null,
    });

    const authFlag = debrief.flags.find((f) => f.toLowerCase().includes('auth'));
    expect(authFlag).toBeDefined();
  });

  it('should flag queue without DLQ', () => {
    const nodes = [makeNode('q', 'queue', { dlqEnabled: false })];
    const debrief = generateDebrief({
      nodes,
      edges: [],
      functionalReqs: [],
      nonFunctionalReqs: [],
      apiContracts: [],
      schemaMemory: null,
      simulationRun: makeRun(),
      scenarioId: null,
    });

    const dlqFlag = debrief.flags.find((f) => f.toLowerCase().includes('dlq') || f.toLowerCase().includes('dead'));
    expect(dlqFlag).toBeDefined();
  });

  it('should compute performance score penalty for crashes', () => {
    const nodes = [makeNode('s', 'server')];
    const run = makeRun();
    // Run has crash in logs

    const debrief = generateDebrief({
      nodes,
      edges: [],
      functionalReqs: [],
      nonFunctionalReqs: [],
      apiContracts: [],
      schemaMemory: null,
      simulationRun: run,
      scenarioId: null,
    });

    // Performance should be penalized (baseline 80, -20 per crash)
    expect(debrief.scores.performance).toBeLessThan(80);
  });
});

describe('buildSimulationSummary', () => {
  it('should stay under 4K token budget', () => {
    const nodes = [
      makeNode('lb', 'load_balancer'),
      makeNode('s1', 'server'),
      makeNode('s2', 'server'),
      makeNode('db', 'database'),
      makeNode('cache', 'cache'),
      makeNode('q', 'queue'),
    ];
    const edges = [
      makeEdge('e1', 'lb', 's1'),
      makeEdge('e2', 'lb', 's2'),
      makeEdge('e3', 's1', 'db'),
      makeEdge('e4', 's2', 'cache'),
      makeEdge('e5', 'cache', 'q'),
    ];

    const summary = buildSimulationSummary(nodes, edges, makeRun());
    const estimatedTokens = summary.length / 4;
    expect(estimatedTokens).toBeLessThan(4000);
  });

  it('should include architecture and metrics sections', () => {
    const nodes = [makeNode('s', 'server')];
    const summary = buildSimulationSummary(nodes, [], makeRun());

    expect(summary).toContain('## Architecture');
    expect(summary).toContain('## Peak Metrics');
    expect(summary).toContain('## Failure Events');
    expect(summary).toContain('## Traffic');
  });
});

describe('generateDebriefHtml', () => {
  it('should produce valid HTML with all sections', () => {
    const nodes = [makeNode('s', 'server')];
    const run = makeRun();
    const debrief = generateDebrief({
      nodes,
      edges: [],
      functionalReqs: [],
      nonFunctionalReqs: [],
      apiContracts: [],
      schemaMemory: null,
      simulationRun: run,
      scenarioId: 'discord_notification_fanout',
    });

    const html = generateDebriefHtml({ debrief, run, nodes, edges: [], scenarioId: 'discord_notification_fanout' });

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('SystemSim');
    expect(html).toContain('sim-data');
    expect(html).toContain('Simulation Results');
    expect(html).toContain('No infrastructure was harmed');
  });

  it('should embed parseable JSON data', () => {
    const nodes = [makeNode('s', 'server')];
    const run = makeRun();
    const debrief = generateDebrief({
      nodes,
      edges: [],
      functionalReqs: [],
      nonFunctionalReqs: [],
      apiContracts: [],
      schemaMemory: null,
      simulationRun: run,
      scenarioId: null,
    });

    const html = generateDebriefHtml({ debrief, run, nodes, edges: [], scenarioId: null });

    // Extract JSON from script tag
    const match = html.match(/<script type="application\/json" id="sim-data">(.*?)<\/script>/s);
    expect(match).toBeTruthy();
    // The JSON is HTML-escaped, unescape it
    const jsonStr = match![1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
    const parsed = JSON.parse(jsonStr);
    expect(parsed.debrief).toBeDefined();
    expect(parsed.run).toBeDefined();
  });

  it('should escape HTML in user content', () => {
    const nodes = [makeNode('<script>alert(1)</script>', 'server')];
    const run = makeRun();
    const debrief = generateDebrief({
      nodes,
      edges: [],
      functionalReqs: [],
      nonFunctionalReqs: [],
      apiContracts: [],
      schemaMemory: null,
      simulationRun: run,
      scenarioId: null,
    });

    const html = generateDebriefHtml({ debrief, run, nodes, edges: [], scenarioId: null });
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
  });
});
