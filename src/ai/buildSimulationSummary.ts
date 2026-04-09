import type { SimulationRun, SimComponentData, WireConfig } from '../types';
import type { Node, Edge } from '@xyflow/react';

const MAX_TOKENS = 4000;

export function buildSimulationSummary(
  nodes: Node<SimComponentData>[],
  edges: Edge<{ config: WireConfig }>[],
  run: SimulationRun,
  schemaShardKey?: string,
): string {
  const sections: string[] = [];

  // 1. Component topology (compact)
  sections.push('## Architecture');
  for (const node of nodes) {
    const downstreams = edges
      .filter((e) => e.source === node.id)
      .map((e) => nodes.find((n) => n.id === e.target)?.data.label ?? e.target);
    sections.push(`- ${node.data.label} (${node.data.type})${downstreams.length ? ' → ' + downstreams.join(', ') : ''}`);
  }

  // 2. Peak metrics per component
  sections.push('\n## Peak Metrics');
  for (const [componentId, history] of Object.entries(run.metricsTimeSeries)) {
    if (!history || history.length === 0) continue;
    const node = nodes.find((n) => n.id === componentId);
    const label = node?.data.label ?? componentId;
    const peakRps = Math.max(...history.map((m) => m.rps));
    const peakP99 = Math.max(...history.map((m) => m.p99));
    const peakError = Math.max(...history.map((m) => m.errorRate));
    const peakCpu = Math.max(...history.map((m) => m.cpuPercent));
    sections.push(`- ${label}: peak ${Math.round(peakRps)} RPS, p99 ${Math.round(peakP99)}ms, err ${(peakError * 100).toFixed(1)}%, CPU ${Math.round(peakCpu)}%`);
  }

  // 3. Shard distribution (if any DB has hot shard)
  if (schemaShardKey) {
    sections.push(`\n## Shard Key: ${schemaShardKey}`);
    for (const [componentId, history] of Object.entries(run.metricsTimeSeries)) {
      if (!history || history.length === 0) continue;
      const last = history[history.length - 1];
      if (last.shardDistribution && last.shardDistribution.length > 1) {
        const total = last.shardDistribution.reduce((a, b) => a + b, 0);
        if (total > 0) {
          const maxShard = Math.max(...last.shardDistribution);
          const pct = ((maxShard / total) * 100).toFixed(1);
          const node = nodes.find((n) => n.id === componentId);
          sections.push(`- ${node?.data.label ?? componentId}: hottest shard has ${pct}% of load`);
        }
      }
    }
  }

  // 4. Critical/warning log entries (deduped, max 10)
  sections.push('\n## Failure Events');
  const seen = new Set<string>();
  let logCount = 0;
  for (const entry of run.log) {
    if (logCount >= 10) break;
    if (entry.severity !== 'critical' && entry.severity !== 'warning') continue;
    const key = entry.message.slice(0, 60);
    if (seen.has(key)) continue;
    seen.add(key);
    sections.push(`- [t=${entry.time}s ${entry.severity}] ${entry.message}`);
    logCount++;
  }

  if (logCount === 0) {
    sections.push('- No critical or warning events');
  }

  // 5. Traffic profile summary
  sections.push(`\n## Traffic: ${run.trafficProfile.phases.length} phases, ${run.trafficProfile.durationSeconds}s`);
  const peakPhase = run.trafficProfile.phases.reduce((a, b) => (a.rps > b.rps ? a : b));
  sections.push(`- Peak: ${peakPhase.rps} RPS at t=${peakPhase.startS}s (${peakPhase.shape})`);

  let text = sections.join('\n');

  // Token budget check — trim logs if over budget
  const estimatedTokens = text.length / 4;
  if (estimatedTokens > MAX_TOKENS) {
    // Remove some log entries to fit
    const lines = text.split('\n');
    while (lines.length > 10 && lines.join('\n').length / 4 > MAX_TOKENS) {
      // Remove from the failure events section (working backwards)
      const lastLogIdx = lines.findLastIndex((l) => l.startsWith('- [t='));
      if (lastLogIdx > 0) {
        lines.splice(lastLogIdx, 1);
      } else {
        break;
      }
    }
    text = lines.join('\n');
  }

  return text;
}
