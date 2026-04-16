/**
 * @file ai/generateDebriefHtml.ts
 *
 * Generates a standalone, self-contained HTML report of a simulation debrief.
 * All CSS inlined, simulation data embedded as JSON in a `<script>` tag so
 * reviewers can post-process if they want. No external dependencies.
 *
 * Used by the "Download Report" button in the BottomPanel debrief tab.
 */

import type { AIDebrief, SimulationRun, SimComponentData, WireConfig } from '../types';
import type { Node, Edge } from '@xyflow/react';

interface DebriefHtmlInput {
  debrief: AIDebrief;
  run: SimulationRun;
  nodes: Node<SimComponentData>[];
  edges: Edge<{ config: WireConfig }>[];
  scenarioId: string | null;
}

export function generateDebriefHtml(input: DebriefHtmlInput): string {
  const { debrief, run, nodes, edges, scenarioId } = input;
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  const time = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  const duration = run.trafficProfile.durationSeconds;
  const peakRps = Math.max(...run.trafficProfile.phases.map((p) => p.rps));
  const issueCount = debrief.flags.length;
  const title = scenarioId?.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) ?? 'Freeform Design';

  // Compute peak metrics
  let peakThroughput = 0;
  let worstP99 = 0;
  let worstError = 0;
  let firstFailureTime: number | null = null;
  for (const history of Object.values(run.metricsTimeSeries)) {
    if (!history) continue;
    for (const m of history) {
      if (m.rps > peakThroughput) peakThroughput = m.rps;
      if (m.p99 > worstP99) worstP99 = m.p99;
      if (m.errorRate > worstError) worstError = m.errorRate;
    }
  }
  for (const entry of run.log) {
    if ((entry.severity === 'critical' || entry.severity === 'warning') && firstFailureTime === null) {
      firstFailureTime = entry.time;
    }
  }

  // Build failure timeline data
  const timelineData = buildTimeline(nodes, run);

  // Build bottleneck chain
  const chain = buildBottleneckChain(run);

  // Architecture description
  const archDesc = nodes.map((n) => {
    const downs = edges.filter((e) => e.source === n.id).map((e) => nodes.find((nn) => nn.id === e.target)?.data.label ?? '?');
    return `${n.data.label} (${n.data.type})${downs.length ? ' → ' + downs.join(', ') : ''}`;
  }).join('\n');

  const scoreStatus = (score: number) => {
    const rounded = Math.round(score);
    if (rounded > 70) return { label: String(rounded), color: '#34c759' };
    if (rounded >= 40) return { label: String(rounded), color: '#ff9f0a' };
    return { label: String(rounded), color: '#ff453a' };
  };

  const coherence = scoreStatus(debrief.scores.coherence);
  const security = scoreStatus(debrief.scores.security);
  const performance = scoreStatus(debrief.scores.performance);

  const allQuestions = [...debrief.questions, ...(debrief.aiQuestions ?? [])];

  const simData = JSON.stringify({ debrief, run: { runId: run.runId, timestamp: run.timestamp } });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SystemSim Report — ${escHtml(title)}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'SF Pro Display','SF Pro Text','SF Pro Icons','Helvetica Neue',Helvetica,Arial,sans-serif;background:#000000;color:#ffffff;padding:32px;letter-spacing:-0.374px;max-width:900px;margin:0 auto;line-height:1.47}
.header{border-bottom:1px solid rgba(255,255,255,0.08);padding-bottom:24px;margin-bottom:32px}
.header h1{font-size:28px;font-weight:600;letter-spacing:0.196px;line-height:1.14;margin-bottom:4px}
.subtitle{color:rgba(255,255,255,0.56);font-size:14px;letter-spacing:-0.224px}
.meta{display:flex;gap:24px;margin-top:16px;font-size:12px;color:rgba(255,255,255,0.48);letter-spacing:-0.12px}
.badge{display:inline-block;padding:2px 10px;border-radius:980px;font-size:12px;font-weight:500;background:rgba(255,159,10,0.15);color:#ff9f0a}
.scores{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:32px}
.score-card{background:#272729;border-radius:8px;padding:20px;text-align:center}
.score-card .label{font-size:12px;color:rgba(255,255,255,0.48);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px}
.score-card .value{font-size:28px;font-weight:600;letter-spacing:0.196px;line-height:1.14}
.section{margin-bottom:32px}
.section h2{font-size:17px;font-weight:600;margin-bottom:16px;letter-spacing:-0.374px;line-height:1.24;color:#ffffff}
.stats-row{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:8px}
.stat{background:#272729;border-radius:8px;padding:14px}
.stat .stat-label{font-size:12px;color:rgba(255,255,255,0.48);margin-bottom:4px;letter-spacing:-0.12px}
.stat .stat-value{font-size:21px;font-weight:600;letter-spacing:0.231px}
.timeline{display:flex;flex-direction:column;gap:6px}
.timeline-row{display:flex;align-items:center;gap:12px}
.timeline-label{font-size:12px;color:rgba(255,255,255,0.48);width:140px;text-align:right;flex-shrink:0;letter-spacing:-0.12px}
.timeline-bar{flex:1;height:20px;border-radius:5px;display:flex;overflow:hidden;background:#242426}
.seg-h{background:rgba(52,199,89,0.3)}.seg-w{background:rgba(255,159,10,0.4)}.seg-c{background:rgba(255,69,58,0.4)}.seg-x{background:rgba(255,69,58,0.7)}
.chain{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:16px;background:#272729;border-radius:8px}
.chain-node{padding:6px 14px;border-radius:8px;font-size:14px;font-weight:400;background:#2a2a2d;letter-spacing:-0.224px}
.chain-arrow{color:#ff453a;font-size:16px}
.chain-node.root{color:#ff453a}
.q-card{background:rgba(0,113,227,0.06);border-left:2px solid #0071e3;border-radius:0;padding:16px 20px;margin-bottom:10px;font-size:14px;letter-spacing:-0.224px;line-height:1.43}
.flag{padding:10px 16px;background:#272729;border-radius:8px;font-size:14px;color:#ff9f0a;margin-bottom:8px;letter-spacing:-0.224px}
.arch-block{background:#272729;border-radius:8px;padding:16px;font-size:14px;white-space:pre-line;color:rgba(255,255,255,0.56);font-family:'SF Mono','Menlo','Courier New',monospace;letter-spacing:-0.224px}
.footer{border-top:1px solid rgba(255,255,255,0.08);padding-top:20px;margin-top:40px;font-size:12px;color:rgba(255,255,255,0.32);letter-spacing:-0.12px}
.red{color:#ff453a}.amber{color:#ff9f0a}.green{color:#34c759}
</style>
</head>
<body>
<script type="application/json" id="sim-data">${escHtml(simData)}</script>

<div class="header">
  <h1>${escHtml(title)}</h1>
  <div class="subtitle">Architecture Validation Report — SystemSim</div>
  <div class="meta">
    <span>Ran ${escHtml(date)} at ${escHtml(time)}</span>
    <span>${duration}s simulation · ${peakRps.toLocaleString()} RPS peak</span>
    <span class="badge">${issueCount} issue${issueCount !== 1 ? 's' : ''} found</span>
  </div>
</div>

<div class="scores">
  <div class="score-card">
    <div class="label">Design Coherence</div>
    <div class="value" style="color:${coherence.color}">${coherence.label}</div>
  </div>
  <div class="score-card">
    <div class="label">Security Posture</div>
    <div class="value" style="color:${security.color}">${security.label}</div>
  </div>
  <div class="score-card">
    <div class="label">Performance</div>
    <div class="value" style="color:${performance.color}">${performance.label}</div>
  </div>
</div>

<div class="section">
  <h2>Architecture Tested</h2>
  <div class="arch-block">${escHtml(archDesc)}</div>
  <div style="font-size:12px;color:#555;text-align:center;margin-top:8px">${nodes.length} components · ${edges.length} connections</div>
</div>

<div class="section">
  <h2>Simulation Results</h2>
  <div class="stats-row">
    <div class="stat"><div class="stat-label">Peak Throughput</div><div class="stat-value">${Math.round(peakThroughput).toLocaleString()} <span style="font-size:12px;color:#666">RPS</span></div></div>
    <div class="stat"><div class="stat-label">p99 Latency</div><div class="stat-value ${worstP99 > 1000 ? 'red' : ''}">${Math.round(worstP99).toLocaleString()} <span style="font-size:12px;color:#666">ms</span></div></div>
    <div class="stat"><div class="stat-label">Error Rate</div><div class="stat-value ${worstError > 0.05 ? 'red' : ''}">${(worstError * 100).toFixed(1)}<span style="font-size:12px;color:#666">%</span></div></div>
    <div class="stat"><div class="stat-label">First Failure</div><div class="stat-value amber">${firstFailureTime !== null ? 't=' + firstFailureTime + 's' : 'None'}</div></div>
  </div>
</div>

${timelineData.length > 0 ? `<div class="section">
  <h2>Failure Timeline</h2>
  <div class="timeline">
${timelineData.map((row) => `    <div class="timeline-row">
      <div class="timeline-label">${escHtml(row.label)}</div>
      <div class="timeline-bar">${row.segments.map((s) => `<div class="${s.cls}" style="flex:${s.flex}"></div>`).join('')}</div>
    </div>`).join('\n')}
  </div>
</div>` : ''}

${chain.length > 0 ? `<div class="section">
  <h2>Bottleneck Chain</h2>
  <div class="chain">
${chain.map((item, i) => i === 0 ? `    <div class="chain-node root">${escHtml(item)}</div>` : `    <div class="chain-arrow">→</div><div class="chain-node">${escHtml(item)}</div>`).join('\n')}
  </div>
</div>` : ''}

${allQuestions.length > 0 ? `<div class="section">
  <h2>Questions a Senior Engineer Would Ask</h2>
${allQuestions.map((q) => `  <div class="q-card">${escHtml(q)}</div>`).join('\n')}
</div>` : ''}

${debrief.flags.length > 0 ? `<div class="section">
  <h2>Patterns Detected</h2>
${debrief.flags.map((f) => `  <div class="flag">${escHtml(f)}</div>`).join('\n')}
</div>` : ''}

<div class="footer">
  <div>Generated by SystemSim · ${escHtml(run.runId)}</div>
  <div style="margin-top:4px">The diagram was the simulation. No infrastructure was harmed.</div>
</div>
</body>
</html>`;
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

interface TimelineRow {
  label: string;
  segments: { cls: string; flex: number }[];
}

function buildTimeline(nodes: Node<SimComponentData>[], run: SimulationRun): TimelineRow[] {
  const rows: TimelineRow[] = [];
  const duration = run.trafficProfile.durationSeconds;
  if (duration === 0) return rows;

  for (const node of nodes) {
    const history = run.metricsTimeSeries[node.id];
    if (!history || history.length === 0) continue;

    const buckets = 20;
    const bucketSize = duration / buckets;
    const segments: { cls: string; flex: number }[] = [];

    for (let b = 0; b < buckets; b++) {
      const idx = Math.min(Math.floor((b / buckets) * history.length), history.length - 1);
      const m = history[idx];
      const maxUtil = Math.max(m.cpuPercent, m.memoryPercent);
      let cls = 'seg-h';
      if (maxUtil > 95) cls = 'seg-x';
      else if (maxUtil > 70) cls = 'seg-c';
      else if (maxUtil > 50) cls = 'seg-w';
      segments.push({ cls, flex: 1 });
    }

    rows.push({ label: node.data.label, segments });
  }

  return rows;
}

function buildBottleneckChain(run: SimulationRun): string[] {
  const chain: string[] = [];
  const criticalLogs = run.log.filter((l) => l.severity === 'critical');
  if (criticalLogs.length === 0) return chain;

  // Sort by time, take first critical event as root cause
  const sorted = [...criticalLogs].sort((a, b) => a.time - b.time);
  const seen = new Set<string>();
  for (const log of sorted.slice(0, 5)) {
    const key = log.componentId ?? log.message.slice(0, 30);
    if (seen.has(key)) continue;
    seen.add(key);
    chain.push(log.message.split('.')[0].trim());
  }

  return chain;
}

export function downloadDebriefHtml(input: DebriefHtmlInput): void {
  const html = generateDebriefHtml(input);
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `systemsim-report-${Date.now()}.html`;
  a.click();
  URL.revokeObjectURL(url);
}
