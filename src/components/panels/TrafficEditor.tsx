import { useState } from 'react';
import { useStore } from '../../store';
import type { TrafficPhase, TrafficProfile } from '../../types';

export default function TrafficEditor() {
  const trafficProfile = useStore((s) => s.trafficProfile);
  const setTrafficProfile = useStore((s) => s.setTrafficProfile);
  const appMode = useStore((s) => s.appMode);

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

  return (
    <div className="p-3 space-y-3 border-b border-[#1E2030]">
      <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Traffic Profile</div>

      <div className="flex gap-2">
        <div className="flex-1">
          <label className="block text-[10px] text-gray-500 mb-1">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-[#1A1D27] text-gray-300 text-xs px-2 py-1.5 rounded-sm border border-[#2A2D3A] focus:border-blue-500 focus:outline-none"
          />
        </div>
        <div className="w-20">
          <label className="block text-[10px] text-gray-500 mb-1">Duration (s)</label>
          <input
            type="number"
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            className="w-full bg-[#1A1D27] text-gray-300 text-xs px-2 py-1.5 rounded-sm border border-[#2A2D3A] focus:border-blue-500 focus:outline-none"
          />
        </div>
        <div className="w-16">
          <label className="block text-[10px] text-gray-500 mb-1">Jitter %</label>
          <input
            type="number"
            value={jitter}
            onChange={(e) => setJitter(Number(e.target.value))}
            className="w-full bg-[#1A1D27] text-gray-300 text-xs px-2 py-1.5 rounded-sm border border-[#2A2D3A] focus:border-blue-500 focus:outline-none"
          />
        </div>
      </div>

      <div className="space-y-1">
        {phases.map((phase, i) => (
          <div key={i} className="flex gap-1 items-center text-xs">
            <input type="number" value={phase.startS} onChange={(e) => updatePhase(i, { startS: Number(e.target.value) })}
              className="w-12 bg-[#1A1D27] text-gray-300 px-1 py-1 rounded-sm border border-[#2A2D3A] text-[10px]" placeholder="Start" />
            <span className="text-gray-600">-</span>
            <input type="number" value={phase.endS} onChange={(e) => updatePhase(i, { endS: Number(e.target.value) })}
              className="w-12 bg-[#1A1D27] text-gray-300 px-1 py-1 rounded-sm border border-[#2A2D3A] text-[10px]" placeholder="End" />
            <input type="number" value={phase.rps} onChange={(e) => updatePhase(i, { rps: Number(e.target.value) })}
              className="w-16 bg-[#1A1D27] text-gray-300 px-1 py-1 rounded-sm border border-[#2A2D3A] text-[10px]" placeholder="RPS" />
            <select value={phase.shape} onChange={(e) => updatePhase(i, { shape: e.target.value as TrafficPhase['shape'] })}
              className="bg-[#1A1D27] text-gray-300 px-1 py-1 rounded-sm border border-[#2A2D3A] text-[10px]">
              <option value="steady">Steady</option>
              <option value="spike">Spike</option>
              <option value="instant_spike">Instant</option>
              <option value="ramp_up">Ramp Up</option>
              <option value="ramp_down">Ramp Down</option>
            </select>
            <input value={phase.description} onChange={(e) => updatePhase(i, { description: e.target.value })}
              className="flex-1 bg-[#1A1D27] text-gray-300 px-1 py-1 rounded-sm border border-[#2A2D3A] text-[10px]" placeholder="Description" />
            <button onClick={() => setPhases(phases.filter((_, j) => j !== i))} className="text-gray-600 hover:text-red-400 text-[10px]">&times;</button>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => setPhases([...phases, { startS: phases.length ? phases[phases.length - 1].endS : 0, endS: duration, rps: 1000, shape: 'steady', description: '' }])}
          className="text-[10px] text-blue-400 hover:text-blue-300"
        >
          + Phase
        </button>
        <button onClick={save} className="px-2 py-1 text-[10px] bg-blue-600 hover:bg-blue-500 text-white rounded-sm ml-auto">
          Apply
        </button>
      </div>
    </div>
  );
}
