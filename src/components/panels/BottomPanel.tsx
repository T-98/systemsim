/**
 * @file components/panels/BottomPanel.tsx
 *
 * VS Code-style tabbed bottom panel. Lives below the canvas. Replaces the old
 * modal overlay debrief so users can flip between the live log and the
 * post-run debrief without losing either.
 *
 * Tabs:
 * - **Live Log** — streams LogEntry[] from the store (auto-scroll, severity colors)
 * - **Debrief** — appears after sim completion: stressed badge (if stressed),
 *   numeric score badges, per-component peak table, summary, questions, flags.
 *
 * See Decisions.md #21, #25, #26.
 */

import { useRef, useEffect } from 'react';
import { useStore } from '../../store';
import { downloadDebriefHtml } from '../../ai/generateDebriefHtml';
import type { PerComponentSummary, ComponentType } from '../../types';

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * The panel itself. Hidden when sim is idle and panel is closed; otherwise
 * visible with tabs for Live Log and Debrief.
 */
export default function BottomPanel() {
  const simulationStatus = useStore((s) => s.simulationStatus);
  const bottomPanelOpen = useStore((s) => s.bottomPanelOpen);
  const setBottomPanelOpen = useStore((s) => s.setBottomPanelOpen);
  const bottomPanelTab = useStore((s) => s.bottomPanelTab);
  const setBottomPanelTab = useStore((s) => s.setBottomPanelTab);
  const logPanelExpanded = useStore((s) => s.logPanelExpanded);
  const setLogPanelExpanded = useStore((s) => s.setLogPanelExpanded);
  const debrief = useStore((s) => s.debrief);
  const debriefVisible = useStore((s) => s.debriefVisible);

  const isActive = simulationStatus === 'running' || simulationStatus === 'paused' || simulationStatus === 'completed';

  if (!isActive && !bottomPanelOpen) return null;
  if (!bottomPanelOpen) return null;

  const hasDebrief = debrief && debriefVisible;
  const height = logPanelExpanded ? 360 : 180;

  return (
    <div
      data-testid="bottom-panel"
      className="transition-all duration-200 flex flex-col"
      style={{
        background: 'var(--bg-card)',
        borderTop: '1px solid var(--border-color)',
        height,
      }}
    >
      <div
        className="flex items-center justify-between shrink-0"
        style={{
          padding: '0 16px',
          borderBottom: '1px solid var(--border-color)',
          height: 36,
        }}
      >
        <div className="flex items-center gap-0.5">
          <TabButton
            label="Live Log"
            active={bottomPanelTab === 'log'}
            onClick={() => setBottomPanelTab('log')}
            badge={simulationStatus === 'running' ? 'LIVE' : undefined}
          />
          {hasDebrief && (
            <TabButton
              label="Debrief"
              active={bottomPanelTab === 'debrief'}
              onClick={() => setBottomPanelTab('debrief')}
            />
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setLogPanelExpanded(!logPanelExpanded)}
            className="transition-colors"
            style={{ fontSize: 12, color: 'var(--text-tertiary)', background: 'none', border: 'none', cursor: 'pointer' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-tertiary)'; }}
          >
            {logPanelExpanded ? 'Collapse' : 'Expand'}
          </button>
          <button
            onClick={() => setBottomPanelOpen(false)}
            className="transition-colors"
            style={{ fontSize: 14, color: 'var(--text-tertiary)', background: 'none', border: 'none', cursor: 'pointer' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-tertiary)'; }}
          >
            &times;
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {bottomPanelTab === 'log' && <LogContent />}
        {bottomPanelTab === 'debrief' && hasDebrief && <DebriefContent />}
      </div>
    </div>
  );
}

function TabButton({ label, active, onClick, badge }: { label: string; active: boolean; onClick: () => void; badge?: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '6px 12px',
        fontSize: 12,
        fontWeight: 500,
        letterSpacing: '-0.12px',
        color: active ? 'var(--text-primary)' : 'var(--text-tertiary)',
        background: 'none',
        border: 'none',
        borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
      }}
    >
      {label}
      {badge && (
        <span
          className="animate-pulse"
          style={{ fontSize: 9, fontWeight: 600, color: 'var(--accent)', letterSpacing: '0.05em' }}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

function LogContent() {
  const liveLog = useStore((s) => s.liveLog);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [liveLog.length]);

  const severityStyle: Record<string, React.CSSProperties> = {
    info: { color: 'var(--text-tertiary)' },
    warning: { color: 'var(--warning)' },
    critical: { color: 'var(--destructive)' },
  };

  return (
    <div
      style={{
        padding: '8px 16px',
        fontFamily: "'Geist Mono', monospace",
        fontSize: 12,
        letterSpacing: '-0.12px',
      }}
    >
      {liveLog.length === 0 ? (
        <div style={{ color: 'var(--text-tertiary)', opacity: 0.5, paddingTop: 8 }}>
          Waiting for simulation events...
        </div>
      ) : (
        liveLog.map((entry, i) => (
          <div key={i} style={severityStyle[entry.severity]}>
            <span className="mr-2 select-none" style={{ color: 'var(--text-tertiary)', opacity: 0.5 }}>
              [{formatTime(entry.time)}]
            </span>
            {entry.message}
          </div>
        ))
      )}
      <div ref={endRef} />
    </div>
  );
}

function DebriefContent() {
  const debrief = useStore((s) => s.debrief)!;
  const debriefLoading = useStore((s) => s.debriefLoading);
  const simulationRuns = useStore((s) => s.simulationRuns);
  const latestRun = simulationRuns[simulationRuns.length - 1];
  const isStressed = latestRun?.stressedMode === true;

  return (
    <div style={{ padding: '16px 16px 32px' }} className="max-w-3xl">
      {isStressed && (
        <div
          data-testid="stressed-badge"
          style={{
            marginBottom: 12,
            padding: '6px 10px',
            borderRadius: 6,
            background: 'rgba(255,159,10,0.08)',
            border: '1px solid rgba(255,159,10,0.3)',
            color: 'var(--warning)',
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: '-0.12px',
            display: 'inline-block',
          }}
        >
          Stressed run · peak RPS held + cold cache + wire p99
        </div>
      )}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex gap-2">
          <ScoreBadge label="Coherence" score={debrief.scores.coherence} />
          <ScoreBadge label="Security" score={debrief.scores.security} />
          <ScoreBadge label="Performance" score={debrief.scores.performance} />
        </div>
        <button
          onClick={() => {
            const state = useStore.getState();
            const latestRun = state.simulationRuns[state.simulationRuns.length - 1];
            if (latestRun && debrief) {
              downloadDebriefHtml({ debrief, run: latestRun, nodes: state.nodes, edges: state.edges, scenarioId: state.scenarioId });
            }
          }}
          className="rounded-lg font-medium transition-all duration-200"
          style={{ padding: '4px 12px', fontSize: 12, background: 'var(--accent)', color: 'white' }}
        >
          Download Report
        </button>
      </div>

      <div style={{ marginBottom: 20 }}>
        <h3
          className="uppercase font-medium"
          style={{ fontSize: 10, letterSpacing: '0.2em', color: 'var(--text-tertiary)', marginBottom: 8 }}
        >
          What Happened
        </h3>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', letterSpacing: '-0.224px', lineHeight: 1.5 }}>
          {debrief.summary}
        </p>
      </div>

      {debrief.componentSummary && debrief.componentSummary.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <h3
            className="uppercase font-medium"
            style={{ fontSize: 10, letterSpacing: '0.2em', color: 'var(--text-tertiary)', marginBottom: 8 }}
          >
            Per-Component Peaks
          </h3>
          <PerComponentTable rows={debrief.componentSummary} />
        </div>
      )}

      {(debrief.questions.length > 0 || (debrief.aiQuestions && debrief.aiQuestions.length > 0)) && (
        <div style={{ marginBottom: 20 }}>
          <h3
            className="uppercase font-medium"
            style={{ fontSize: 10, letterSpacing: '0.2em', color: 'var(--text-tertiary)', marginBottom: 8 }}
          >
            Questions for You
          </h3>
          <div className="space-y-2">
            {debrief.questions.map((q, i) => (
              <div key={`d-${i}`} style={{ paddingLeft: 14, borderLeft: '2px solid var(--accent)' }}>
                <p className="italic" style={{ fontSize: 13, color: 'var(--text-secondary)', letterSpacing: '-0.224px', lineHeight: 1.5 }}>{q}</p>
              </div>
            ))}
            {debrief.aiQuestions?.map((q, i) => (
              <div key={`ai-${i}`} style={{ paddingLeft: 14, borderLeft: '2px solid var(--accent)' }}>
                <p className="italic" style={{ fontSize: 13, color: 'var(--text-secondary)', letterSpacing: '-0.224px', lineHeight: 1.5 }}>
                  {q}
                  <span style={{ marginLeft: 6, fontSize: 10, padding: '1px 5px', borderRadius: 4, background: 'rgba(52,199,89,0.1)', color: 'var(--success)', fontStyle: 'normal', fontWeight: 500 }}>AI</span>
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {debriefLoading && (
        <div style={{ padding: '10px 14px', background: 'rgba(0,113,227,0.06)', borderRadius: 8, fontSize: 13, color: 'var(--accent)', marginBottom: 12 }}>
          Generating AI-powered questions...
        </div>
      )}
      {!debriefLoading && !debrief.aiAvailable && debrief.questions.length > 0 && (
        <div style={{ padding: '10px 14px', background: 'rgba(255,159,10,0.06)', borderRadius: 8, fontSize: 13, color: 'var(--warning)', marginBottom: 12 }}>
          AI debrief unavailable — showing rule-based analysis only
        </div>
      )}

      {debrief.flags.length > 0 && (
        <div>
          <h3
            className="uppercase font-medium"
            style={{ fontSize: 10, letterSpacing: '0.2em', color: 'var(--text-tertiary)', marginBottom: 8 }}
          >
            Patterns Detected
          </h3>
          <div className="space-y-1">
            {debrief.flags.map((flag, i) => (
              <div
                key={i}
                style={{ fontSize: 13, color: 'var(--warning)', fontFamily: "'Geist Mono', monospace", letterSpacing: '-0.224px' }}
              >
                {flag}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ScoreBadge({ label, score }: { label: string; score: number }) {
  // Color and displayed number must agree. Round once, then threshold the rounded value.
  const rounded = Math.round(score);
  const getStatus = () => {
    if (rounded > 70) return { bg: 'rgba(52,199,89,0.1)', text: 'var(--success)' };
    if (rounded >= 40) return { bg: 'rgba(255,159,10,0.1)', text: 'var(--warning)' };
    return { bg: 'rgba(255,59,48,0.1)', text: 'var(--destructive)' };
  };
  const status = getStatus();
  return (
    <div className="flex items-center gap-1.5" style={{ padding: '3px 8px', borderRadius: 6, background: status.bg }}>
      <span style={{ fontSize: 11, color: 'var(--text-tertiary)', letterSpacing: '-0.12px' }}>{label}</span>
      <span style={{ fontSize: 11, fontWeight: 600, color: status.text, fontFamily: "'Geist Mono', monospace" }}>{rounded}</span>
    </div>
  );
}

const P99_GREEN = 200;
const P99_AMBER = 500;
const RHO_GREEN = 0.7;
const RHO_AMBER = 0.9;
const ERR_GREEN = 0.01;
const ERR_AMBER = 0.05;

function severityColor(value: number | undefined, green: number, amber: number): string {
  if (value === undefined) return 'var(--text-tertiary)';
  if (value < green) return 'var(--success)';
  if (value < amber) return 'var(--warning)';
  return 'var(--destructive)';
}

function typeLabel(type: ComponentType): string {
  switch (type) {
    case 'load_balancer': return 'LB';
    case 'api_gateway': return 'API GW';
    case 'server': return 'Server';
    case 'cache': return 'Cache';
    case 'queue': return 'Queue';
    case 'database': return 'DB';
    case 'websocket_gateway': return 'WS';
    case 'fanout': return 'Fanout';
    case 'cdn': return 'CDN';
    case 'external': return 'External';
    case 'autoscaler': return 'Autoscaler';
  }
}

function PerComponentTable({ rows }: { rows: PerComponentSummary[] }) {
  const th: React.CSSProperties = {
    fontSize: 10,
    fontWeight: 500,
    color: 'var(--text-tertiary)',
    textTransform: 'uppercase',
    letterSpacing: '0.12em',
    padding: '6px 8px',
    textAlign: 'right',
    borderBottom: '1px solid var(--border-color)',
  };
  const thLeft: React.CSSProperties = { ...th, textAlign: 'left' };
  const td: React.CSSProperties = {
    fontSize: 12,
    fontFamily: "'Geist Mono', monospace",
    padding: '5px 8px',
    textAlign: 'right',
    letterSpacing: '-0.12px',
  };
  const tdLeft: React.CSSProperties = { ...td, textAlign: 'left', fontFamily: 'inherit' };

  return (
    <div style={{ border: '1px solid var(--border-color)', borderRadius: 8, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }} data-testid="per-component-table">
        <thead>
          <tr>
            <th style={thLeft}>Component</th>
            <th style={th}>p50</th>
            <th style={th}>p99</th>
            <th style={th}>ρ</th>
            <th style={th}>Errors</th>
            <th style={th}>Peak Queue</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const rhoPct = r.rho !== undefined ? r.rho * 100 : undefined;
            return (
              <tr key={r.id} data-component-id={r.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                <td style={tdLeft}>
                  <span style={{ color: 'var(--text-primary)' }}>{r.name}</span>
                  <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--text-tertiary)' }}>{typeLabel(r.type)}</span>
                </td>
                <td style={{ ...td, color: severityColor(r.p50, P99_GREEN, P99_AMBER) }}>{r.p50}ms</td>
                <td style={{ ...td, color: severityColor(r.p99, P99_GREEN, P99_AMBER) }}>{r.p99}ms</td>
                <td style={{ ...td, color: severityColor(r.rho, RHO_GREEN, RHO_AMBER) }}>
                  {rhoPct !== undefined ? `${rhoPct.toFixed(0)}%` : '—'}
                </td>
                <td style={{ ...td, color: severityColor(r.errorRate, ERR_GREEN, ERR_AMBER) }}>
                  {r.errorRate > 0 ? `${(r.errorRate * 100).toFixed(1)}%` : '—'}
                </td>
                <td style={{ ...td, color: 'var(--text-secondary)' }}>
                  {r.peakQueue !== undefined ? r.peakQueue.toLocaleString() : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
