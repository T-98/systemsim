/**
 * @file components/panels/TrafficEditor.tsx
 *
 * Freeform-mode traffic profile editor. Lets the user define phases
 * (startS / endS / rps / shape / description), jitter %, and user
 * distribution. Scenario mode uses the scenario's hardcoded profile instead
 * and hides this tab.
 */

import { useState } from 'react';
import { useStore } from '../../store';
import type { TrafficPhase, TrafficProfile } from '../../types';
import InfoIcon from '../ui/InfoIcon';

export default function TrafficEditor() {
  const trafficProfile = useStore((s) => s.trafficProfile);
  const setTrafficProfile = useStore((s) => s.setTrafficProfile);
  const appMode = useStore((s) => s.appMode);
  const [collapsed, setCollapsed] = useState(true);

  const [name, setName] = useState(trafficProfile?.profileName ?? 'custom_profile');
  const [duration, setDuration] = useState(trafficProfile?.durationSeconds ?? 120);
  const [phases, setPhases] = useState<TrafficPhase[]>(
    trafficProfile?.phases ?? [
      { startS: 0, endS: 30, rps: 1000, shape: 'steady', description: 'Warm-up' },
      { startS: 30, endS: 35, rps: 10000, shape: 'spike', description: 'Spike' },
      { startS: 35, endS: 90, rps: 5000, shape: 'steady', description: 'Sustained' },
      { startS: 90, endS: 120, rps: 1000, shape: 'ramp_down', description: 'Cool down' },
    ]
  );
  const [jitter, setJitter] = useState(trafficProfile?.jitterPercent ?? 15);

  if (appMode !== 'freeform') return null;

  const save = () => {
    const profile: TrafficProfile = {
      profileName: name,
      durationSeconds: duration,
      phases,
      requestMix: { 'default': 1.0 },
      userDistribution: 'uniform',
      jitterPercent: jitter,
    };
    setTrafficProfile(profile);
  };

  const updatePhase = (idx: number, update: Partial<TrafficPhase>) => {
    const copy = [...phases];
    copy[idx] = { ...copy[idx], ...update };
    setPhases(copy);
  };

  const inputStyle: React.CSSProperties = {
    background: 'var(--bg-input)',
    color: 'var(--text-secondary)',
    fontSize: '14px',
    letterSpacing: '-0.224px',
    padding: '8px 12px',
    borderRadius: '8px',
    border: '1px solid var(--border-color)',
  };

  const compactInputStyle: React.CSSProperties = {
    background: 'var(--bg-input)',
    color: 'var(--text-secondary)',
    fontSize: '12px',
    letterSpacing: '-0.12px',
    padding: '6px 8px',
    borderRadius: '8px',
    border: '1px solid var(--border-color)',
  };

  return (
    <div style={{ borderBottom: '1px solid var(--border-color)' }}>
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between transition-colors duration-150"
        style={{ padding: '10px 16px' }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      >
        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <span
            className="uppercase font-medium"
            style={{ fontSize: '10px', letterSpacing: '0.2em', color: 'var(--text-tertiary)' }}
          >
            Traffic Profile
          </span>
          <InfoIcon topic="config.traffic.phases" side="bottom" />
        </div>
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          style={{ color: 'var(--text-tertiary)', transform: collapsed ? 'rotate(0deg)' : 'rotate(180deg)', transition: 'transform 0.2s' }}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {!collapsed && (
      <div className="space-y-3" style={{ padding: '0 16px 12px' }}>
      <div className="flex gap-2">
        <div className="flex-1">
          <label className="block font-medium" style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '4px', letterSpacing: '-0.12px' }}>Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full transition-all duration-200"
            style={inputStyle}
          />
        </div>
        <div className="w-20">
          <div className="flex items-center gap-1" style={{ marginBottom: '4px' }}>
            <label className="block font-medium" style={{ fontSize: '12px', color: 'var(--text-tertiary)', letterSpacing: '-0.12px' }}>Duration (s)</label>
            <InfoIcon topic="config.traffic.durationSeconds" side="bottom" />
          </div>
          <input
            type="number"
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            className="w-full transition-all duration-200"
            style={inputStyle}
          />
        </div>
        <div className="w-16">
          <div className="flex items-center gap-1" style={{ marginBottom: '4px' }}>
            <label className="block font-medium" style={{ fontSize: '12px', color: 'var(--text-tertiary)', letterSpacing: '-0.12px' }}>Jitter %</label>
            <InfoIcon topic="config.traffic.jitterPercent" side="bottom" />
          </div>
          <input
            type="number"
            value={jitter}
            onChange={(e) => setJitter(Number(e.target.value))}
            className="w-full transition-all duration-200"
            style={inputStyle}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        {phases.map((phase, i) => (
          <div key={i} className="flex gap-1.5 items-center">
            <input type="number" value={phase.startS} onChange={(e) => updatePhase(i, { startS: Number(e.target.value) })}
              className="w-12 transition-all duration-200" style={compactInputStyle} placeholder="Start" />
            <span style={{ color: 'var(--text-tertiary)', opacity: 0.5 }}>-</span>
            <input type="number" value={phase.endS} onChange={(e) => updatePhase(i, { endS: Number(e.target.value) })}
              className="w-12 transition-all duration-200" style={compactInputStyle} placeholder="End" />
            <input type="number" value={phase.rps} onChange={(e) => updatePhase(i, { rps: Number(e.target.value) })}
              className="w-16 transition-all duration-200" style={compactInputStyle} placeholder="RPS" />
            <select value={phase.shape} onChange={(e) => updatePhase(i, { shape: e.target.value as TrafficPhase['shape'] })}
              className="transition-all duration-200" style={compactInputStyle}>
              <option value="steady">Steady</option>
              <option value="spike">Spike</option>
              <option value="instant_spike">Instant</option>
              <option value="ramp_up">Ramp Up</option>
              <option value="ramp_down">Ramp Down</option>
            </select>
            <input value={phase.description} onChange={(e) => updatePhase(i, { description: e.target.value })}
              className="flex-1 transition-all duration-200" style={compactInputStyle} placeholder="Description" />
            <button
              onClick={() => setPhases(phases.filter((_, j) => j !== i))}
              className="transition-all duration-200"
              style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--destructive)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-tertiary)'; }}
            >
              &times;
            </button>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => setPhases([...phases, { startS: phases.length ? phases[phases.length - 1].endS : 0, endS: duration, rps: 1000, shape: 'steady', description: '' }])}
          className="transition-all duration-200"
          style={{ fontSize: '12px', color: 'var(--accent-link)', letterSpacing: '-0.12px' }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--accent-link)'; }}
        >
          + Phase
        </button>
        <button
          onClick={save}
          className="rounded-lg ml-auto transition-all duration-200"
          style={{
            padding: '6px 12px',
            fontSize: '12px',
            letterSpacing: '-0.12px',
            background: 'var(--accent)',
            color: 'var(--text-on-accent)',
          }}
        >
          Apply
        </button>
      </div>
      </div>
      )}
    </div>
  );
}
