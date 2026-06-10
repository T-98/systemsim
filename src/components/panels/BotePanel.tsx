/**
 * @file components/panels/BotePanel.tsx
 *
 * Back-of-the-envelope capacity estimator (SIMFID Phase 8a.1). Renders in
 * the right inspector dock when no node or wire is selected. Pure UI over
 * `util/bote.ts` — no engine coupling. Inputs live in the store
 * (`boteInputs`) so they survive the panel unmounting on node selection.
 *
 * "Apply to traffic profile" projects the estimates into a two-phase
 * TrafficProfile (steady baseline at avg QPS, then a spike to peak QPS)
 * and switches the sidebar to the Traffic tab so the result is visible.
 */

import { useStore } from '../../store';
import InfoIcon from '../ui/InfoIcon';
import {
  computeBote,
  toTwoPhaseProfile,
  formatBytes,
  formatCount,
  type BoteInputs,
} from '../../util/bote';

export default function BotePanel({ onClose }: { onClose: () => void }) {
  const boteInputs = useStore((s) => s.boteInputs);
  const setBoteInputs = useStore((s) => s.setBoteInputs);
  const trafficProfile = useStore((s) => s.trafficProfile);
  const setTrafficProfile = useStore((s) => s.setTrafficProfile);
  const appMode = useStore((s) => s.appMode);
  const setSidebarTab = useStore((s) => s.setSidebarTab);
  const simulationStatus = useStore((s) => s.simulationStatus);
  // Mid-run apply would mutate the profile the already-constructed engine
  // ignores (useSimulation snapshots at start) while the traffic editor
  // re-seeds — it would LOOK applied without being applied.
  const isRunning = simulationStatus === 'running' || simulationStatus === 'paused';

  const estimates = computeBote(boteInputs);

  const apply = () => {
    if (isRunning) return;
    setTrafficProfile(toTwoPhaseProfile(estimates, trafficProfile));
    if (appMode === 'freeform') setSidebarTab('traffic');
  };

  return (
    <div
      data-testid="bote-panel"
      className="w-80 flex flex-col h-full overflow-y-auto"
      style={{
        background: 'var(--bg-sidebar)',
        borderLeft: '1px solid var(--border-color)',
      }}
    >
      <div
        className="flex items-center justify-between"
        style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-color)' }}
      >
        <span
          className="font-semibold tracking-wide"
          style={{ fontSize: '14px', color: 'var(--text-secondary)', letterSpacing: '-0.224px' }}
        >
          Capacity Estimator
        </span>
        <button
          onClick={onClose}
          aria-label="Close capacity estimator"
          className="transition-all duration-200"
          style={{ fontSize: '17px', color: 'var(--text-tertiary)', background: 'transparent', border: 'none', cursor: 'pointer' }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-tertiary)'; }}
        >
          &times;
        </button>
      </div>

      <div style={{ padding: '20px' }} className="space-y-5">
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', letterSpacing: '-0.12px', lineHeight: 1.5 }}>
          Back-of-the-envelope math: daily users in, QPS / storage / connections out.
          Numbers update as you type.
        </div>

        <NumField label="Daily active users" field="dau" value={boteInputs.dau} onPatch={setBoteInputs} topic="config.bote.dau" />
        <NumField label="Actions per user per day" field="actionsPerUserPerDay" value={boteInputs.actionsPerUserPerDay} onPatch={setBoteInputs} topic="config.bote.actionsPerUserPerDay" />
        <NumField
          label="Read share (0–1)" field="readRatio" value={boteInputs.readRatio} onPatch={setBoteInputs}
          step={0.05} hint="0.8 = 80% reads, 20% writes" topic="config.bote.readRatio"
        />
        <NumField label="Payload per write (bytes)" field="payloadBytes" value={boteInputs.payloadBytes} onPatch={setBoteInputs} topic="config.bote.payloadBytes" />
        <NumField label="Retention (days)" field="retentionDays" value={boteInputs.retentionDays} onPatch={setBoteInputs} topic="config.bote.retentionDays" />
        <NumField
          label="Peak-to-average multiplier" field="peakMultiplier" value={boteInputs.peakMultiplier} onPatch={setBoteInputs}
          step={0.5} hint="Peak traffic as a multiple of the daily average. 3× is a common default."
          topic="config.bote.peakMultiplier"
        />
        <NumField
          label="Avg response time (ms)" field="avgResponseTimeMs" value={boteInputs.avgResponseTimeMs} onPatch={setBoteInputs}
          hint="The W in Little's Law: connections = QPS × W"
          topic="config.bote.avgResponseTimeMs"
        />

        <div
          style={{
            borderTop: '1px solid var(--border-color)',
            paddingTop: 16,
          }}
          className="space-y-2"
        >
          <div
            className="uppercase font-medium"
            style={{ fontSize: '10px', letterSpacing: '0.2em', color: 'var(--text-tertiary)', marginBottom: 8 }}
          >
            Estimates
          </div>
          <OutRow testid="bote-out-avg-qps" label="Average QPS" value={formatCount(estimates.avgQps)} />
          <OutRow testid="bote-out-peak-qps" label="Peak QPS" value={formatCount(estimates.peakQps)} />
          <OutRow testid="bote-out-read-qps" label="Read QPS" value={formatCount(estimates.readQps)} />
          <OutRow testid="bote-out-write-qps" label="Write QPS" value={formatCount(estimates.writeQps)} />
          <OutRow testid="bote-out-storage-month" label="Storage growth / month" value={formatBytes(estimates.storageBytesPerMonth)} />
          <OutRow testid="bote-out-storage-retention" label={`Storage at ${boteInputs.retentionDays}-day retention`} value={formatBytes(estimates.storageBytesAtRetention)} />
          <OutRow testid="bote-out-conns-avg" label="Concurrent requests (avg)" value={formatCount(estimates.avgConcurrentConnections)} />
          <OutRow testid="bote-out-conns-peak" label="Concurrent requests (peak)" value={formatCount(estimates.peakConcurrentConnections)} />
        </div>

        <button
          type="button"
          data-testid="bote-apply"
          onClick={apply}
          disabled={isRunning}
          className="w-full rounded-lg transition-all duration-200 disabled:opacity-30"
          style={{
            padding: '10px 16px',
            fontSize: '14px',
            letterSpacing: '-0.224px',
            background: 'var(--accent)',
            color: 'var(--text-on-accent)',
            border: 'none',
            cursor: isRunning ? 'default' : 'pointer',
          }}
        >
          Apply to traffic profile
        </button>
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', letterSpacing: '-0.12px', marginTop: -8, lineHeight: 1.5 }}>
          Replaces the traffic phases with a steady baseline at average QPS and a
          spike to peak QPS. Duration, request mix, and distribution are kept.
        </div>
      </div>
    </div>
  );
}

function NumField({ label, field, value, onPatch, step, hint, topic }: {
  label: string;
  field: keyof BoteInputs;
  value: number;
  onPatch: (patch: Partial<BoteInputs>) => void;
  step?: number;
  hint?: string;
  topic?: string;
}) {
  return (
    <div>
      <div
        className="flex items-center gap-2"
        style={{ marginBottom: '6px' }}
      >
        <label
          className="block font-medium"
          style={{ fontSize: '12px', color: 'var(--text-tertiary)', letterSpacing: '-0.12px' }}
        >
          {label}
        </label>
        {topic && <InfoIcon topic={topic} side="left" />}
      </div>
      <input
        type="number"
        data-testid={`bote-input-${field}`}
        value={Number.isFinite(value) ? value : ''}
        step={step}
        min={0}
        onChange={(e) => onPatch({ [field]: e.target.valueAsNumber } as Partial<BoteInputs>)}
        className="w-full transition-all duration-200"
        style={{
          background: 'var(--bg-input)',
          color: 'var(--text-secondary)',
          fontSize: '14px',
          letterSpacing: '-0.224px',
          padding: '10px 14px',
          borderRadius: '8px',
          border: '1px solid var(--border-color)',
          fontFamily: "'Geist Mono', monospace",
        }}
      />
      {hint && (
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', letterSpacing: '-0.12px', marginTop: 4 }}>
          {hint}
        </div>
      )}
    </div>
  );
}

function OutRow({ label, value, testid }: { label: string; value: string; testid: string }) {
  return (
    <div className="flex items-center justify-between">
      <span style={{ fontSize: '13px', color: 'var(--text-secondary)', letterSpacing: '-0.12px' }}>
        {label}
      </span>
      <span
        data-testid={testid}
        style={{
          fontSize: '13px',
          color: 'var(--text-primary)',
          fontFamily: "'Geist Mono', monospace",
          letterSpacing: '-0.12px',
        }}
      >
        {value}
      </span>
    </div>
  );
}
