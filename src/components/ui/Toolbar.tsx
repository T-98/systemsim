/**
 * @file components/ui/Toolbar.tsx
 *
 * Top toolbar above the canvas. Owns all simulation controls (Run / Run
 * Stressed / Pause / Resume / Reset / Debrief), speed selector, view toggle,
 * remix, save, theme.
 *
 * Preflight gating: `runPreflight` is memoized on every store change; the
 * Run button is disabled when `preflight.errors.length > 0`. The tooltip on
 * hover reads "Resolve preflight items first."
 */

import { useState, useCallback, useMemo } from 'react';
import { useStore } from '../../store';
import { useSimulation } from '../../engine/useSimulation';
import { DISCORD_TRAFFIC_PROFILE, DISCORD_BRIEF } from '../../scenarios/discord';
import { generateDebrief, checkForHints } from '../../ai/debrief';
import { runPreflight } from '../../engine/preflight';
import RemixInput from './RemixInput';
import ConfirmModal from './ConfirmModal';
import InfoIcon from './InfoIcon';
import UndoToast from './UndoToast';

/**
 * The top toolbar. Pure view — all state lives in the Zustand store. Wires
 * simulation-control buttons to `useSimulation` and gates Run on preflight.
 */
export default function Toolbar() {
  const appMode = useStore((s) => s.appMode);
  const scenarioId = useStore((s) => s.scenarioId);
  const simulationStatus = useStore((s) => s.simulationStatus);
  const simulationTime = useStore((s) => s.simulationTime);
  const simulationSpeed = useStore((s) => s.simulationSpeed);
  const viewMode = useStore((s) => s.viewMode);
  const trafficProfile = useStore((s) => s.trafficProfile);
  const setSimulationSpeed = useStore((s) => s.setSimulationSpeed);
  const setViewMode = useStore((s) => s.setViewMode);
  const setAppView = useStore((s) => s.setAppView);
  const setDebrief = useStore((s) => s.setDebrief);
  const setDebriefVisible = useStore((s) => s.setDebriefVisible);
  const addHint = useStore((s) => s.addHint);
  const nodes = useStore((s) => s.nodes);
  const edges = useStore((s) => s.edges);
  const toggleTheme = useStore((s) => s.toggleTheme);
  const { startSimulation, pauseSimulation, resumeSimulation } = useSimulation();

  const [remixOpen, setRemixOpen] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const schemaMemory = useStore((s) => s.schemaMemory);
  const apiContracts = useStore((s) => s.apiContracts);
  const endpointRoutes = useStore((s) => s.endpointRoutes);

  const isRunning = simulationStatus === 'running';
  const isPaused = simulationStatus === 'paused';
  const isCompleted = simulationStatus === 'completed';
  const hasNodes = nodes.length > 0;

  const preflight = useMemo(
    () =>
      runPreflight({
        nodes: nodes.map((n) => ({ id: n.id, data: { type: n.data.type, label: n.data.label, config: n.data.config } })),
        edges: edges.map((e) => ({ source: e.source, target: e.target })),
        trafficProfile,
        schemaMemory,
        apiContracts,
        endpointRoutes,
      }),
    [nodes, edges, trafficProfile, schemaMemory, apiContracts, endpointRoutes],
  );
  const preflightClean = preflight.errors.length === 0;

  const canRemix = hasNodes && simulationStatus === 'idle' && !remixOpen;

  const handleRemixClick = useCallback(() => {
    if (!canRemix) return;
    if (hasNodes) {
      setShowConfirm(true);
    } else {
      setRemixOpen(true);
    }
  }, [canRemix, hasNodes]);

  const handleConfirmRemix = useCallback(() => {
    setShowConfirm(false);
    setRemixOpen(true);
  }, []);

  const handleRemixSuccess = useCallback(() => {
    setToastMsg('Remixed. ⌘Z to restore.');
  }, []);

  const handleToastDismiss = useCallback(() => {
    setToastMsg(null);
  }, []);

  const handleRun = () => {
    const hints = checkForHints(nodes, edges, scenarioId);
    hints.forEach((h) => addHint(h));
    const profile = scenarioId === 'discord_notification_fanout' ? DISCORD_TRAFFIC_PROFILE : trafficProfile;
    if (!profile) return;
    startSimulation(profile, false);
  };

  const handleRunStressed = () => {
    const hints = checkForHints(nodes, edges, scenarioId);
    hints.forEach((h) => addHint(h));
    const profile = scenarioId === 'discord_notification_fanout' ? DISCORD_TRAFFIC_PROFILE : trafficProfile;
    if (!profile) return;
    startSimulation(profile, true);
  };

  const handleStop = () => {
    const state = useStore.getState();
    const latestRun = state.simulationRuns[state.simulationRuns.length - 1];
    if (latestRun) {
      const debrief = generateDebrief({ nodes: state.nodes, edges: state.edges, functionalReqs: state.functionalReqs, nonFunctionalReqs: state.nonFunctionalReqs, apiContracts: state.apiContracts, schemaMemory: state.schemaMemory, simulationRun: latestRun, scenarioId: state.scenarioId });
      setDebrief(debrief);
      setDebriefVisible(true);
      useStore.getState().setBottomPanelOpen(true);
      useStore.getState().setBottomPanelTab('debrief');
    }
  };

  const scenarioTitle = scenarioId === 'discord_notification_fanout' ? DISCORD_BRIEF.title : 'Freeform Design';
  const formatTime = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const profileDuration = scenarioId === 'discord_notification_fanout' ? DISCORD_TRAFFIC_PROFILE.durationSeconds : trafficProfile?.durationSeconds ?? 0;
  const progress = profileDuration > 0 ? (simulationTime / profileDuration) * 100 : 0;

  return (
    <>
    <div
      className="flex items-center justify-between shrink-0"
      style={{
        height: '48px',
        paddingLeft: '20px',
        paddingRight: '20px',
        background: 'var(--bg-nav)',
        backdropFilter: 'saturate(180%) blur(20px)',
        WebkitBackdropFilter: 'saturate(180%) blur(20px)',
        borderBottom: '1px solid var(--border-color)',
      }}
    >
      {/* Left: Logo + breadcrumb */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2.5">
          <div
            className="w-6 h-6 rounded-lg flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-hover))' }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
              <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
          </div>
          <span
            className="font-semibold tracking-tight"
            style={{ fontSize: '14px', color: 'var(--text-primary)', letterSpacing: '-0.224px' }}
          >
            SystemSim
          </span>
        </div>
        <svg className="w-3 h-3" style={{ color: 'var(--text-tertiary)' }} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6" /></svg>
        <span style={{ fontSize: '12px', color: 'var(--text-tertiary)', letterSpacing: '-0.12px' }}>{scenarioTitle}</span>
        {appMode === 'scenario' && (
          <button
            onClick={() => setAppView('design')}
            className="transition-colors ml-1"
            style={{ fontSize: '12px', color: 'var(--accent-link)', letterSpacing: '-0.12px', opacity: 0.7 }}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.7'; }}
          >
            Design Flow
          </button>
        )}
      </div>

      {/* Right: Controls */}
      <div className="flex items-center gap-4">
        {/* Timer + Progress */}
        {(isRunning || isPaused || isCompleted) && (
          <div className="flex items-center gap-3">
            <span
              className="font-mono tabular-nums"
              style={{ fontSize: '12px', color: 'var(--text-tertiary)', letterSpacing: '-0.12px' }}
            >
              {formatTime(simulationTime)}
            </span>
            <div
              className="w-28 rounded-full overflow-hidden"
              style={{ height: '3px', background: 'var(--border-color)' }}
            >
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{ width: `${progress}%`, background: 'var(--accent)' }}
              />
            </div>
            <span
              className="font-mono tabular-nums"
              style={{ fontSize: '12px', color: 'var(--text-tertiary)', letterSpacing: '-0.12px', opacity: 0.6 }}
            >
              {formatTime(profileDuration)}
            </span>
          </div>
        )}

        {/* Speed */}
        <div
          className="flex items-center rounded-lg overflow-hidden"
          style={{ background: 'var(--bg-input)', border: '1px solid var(--border-color)' }}
        >
          {[1, 2, 5, 10].map((speed) => (
            <button
              key={speed}
              onClick={() => setSimulationSpeed(speed)}
              className="font-mono font-medium transition-all duration-200"
              style={{
                padding: '6px 10px',
                fontSize: '10px',
                letterSpacing: '-0.12px',
                background: simulationSpeed === speed ? 'var(--accent)' : 'transparent',
                color: simulationSpeed === speed ? 'var(--text-on-accent)' : 'var(--text-tertiary)',
              }}
            >
              {speed}x
            </button>
          ))}
        </div>

        {/* View toggle */}
        <button
          onClick={() => setViewMode(viewMode === 'particle' ? 'aggregate' : 'particle')}
          className="rounded-lg transition-all duration-200"
          style={{
            padding: '6px 12px',
            fontSize: '12px',
            letterSpacing: '-0.12px',
            color: 'var(--text-tertiary)',
            border: '1px solid var(--border-color)',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.borderColor = 'var(--border-strong)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-tertiary)'; e.currentTarget.style.borderColor = 'var(--border-color)'; }}
          title="Toggle view (V)"
        >
          {viewMode === 'particle' ? 'Particle' : 'Aggregate'}
        </button>

        {/* Sim controls */}
        {simulationStatus === 'idle' && (
          <>
            <div className="flex items-center gap-1.5">
              <button
                onClick={handleRun}
                disabled={!hasNodes || !preflightClean}
                className="rounded-lg font-medium transition-all"
                title={!preflightClean ? 'Resolve preflight items first' : undefined}
                style={{
                  padding: '6px 16px',
                  fontSize: '14px',
                  letterSpacing: '-0.224px',
                  background: hasNodes && preflightClean ? 'var(--accent)' : 'var(--bg-card)',
                  color: hasNodes && preflightClean ? 'var(--text-on-accent)' : 'var(--text-tertiary)',
                  border: hasNodes && preflightClean ? 'none' : '1px solid var(--border-color)',
                  cursor: hasNodes && preflightClean ? 'pointer' : 'not-allowed',
                  transform: hasNodes && preflightClean ? 'scale(1.02)' : 'scale(1)',
                  transition: 'all 100ms ease',
                }}
              >
                Run
              </button>
              <InfoIcon topic="concept.littlesLaw" side="bottom" ariaLabel="About the simulation runtime" />
            </div>
            <button
              onClick={handleRunStressed}
              disabled={!hasNodes || !preflightClean}
              className="rounded-lg font-medium transition-all"
              title="Peak RPS held + cold cache + wire p99. Worst-case stress test."
              style={{
                padding: '6px 14px',
                fontSize: '12px',
                letterSpacing: '-0.12px',
                background: 'transparent',
                color: hasNodes && preflightClean ? 'var(--warning)' : 'var(--text-tertiary)',
                border: `1px solid ${hasNodes && preflightClean ? 'var(--warning)' : 'var(--border-color)'}`,
                cursor: hasNodes && preflightClean ? 'pointer' : 'not-allowed',
              }}
            >
              Run Stressed
            </button>
          </>
        )}
        {isRunning && (
          <button
            onClick={pauseSimulation}
            className="rounded-lg font-medium transition-all"
            style={{
              padding: '6px 16px',
              fontSize: '14px',
              letterSpacing: '-0.224px',
              background: 'var(--warning)',
              color: '#fff',
            }}
          >
            Pause
          </button>
        )}
        {isPaused && (
          <button
            onClick={resumeSimulation}
            className="rounded-lg font-medium transition-all"
            style={{
              padding: '6px 16px',
              fontSize: '14px',
              letterSpacing: '-0.224px',
              background: 'var(--accent)',
              color: 'var(--text-on-accent)',
            }}
          >
            Resume
          </button>
        )}
        {isCompleted && (
          <>
            <button
              onClick={handleStop}
              className="rounded-lg font-medium transition-all"
              style={{
                padding: '6px 16px',
                fontSize: '14px',
                letterSpacing: '-0.224px',
                background: 'var(--success)',
                color: '#fff',
              }}
            >
              Debrief
            </button>
            <button
              onClick={() => useStore.getState().resetSimulationState()}
              className="rounded-lg transition-all"
              style={{
                padding: '6px 12px',
                fontSize: '12px',
                letterSpacing: '-0.12px',
                color: 'var(--text-tertiary)',
                border: '1px solid var(--border-color)',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.borderColor = 'var(--border-strong)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-tertiary)'; e.currentTarget.style.borderColor = 'var(--border-color)'; }}
            >
              Reset
            </button>
          </>
        )}

        {/* Remix */}
        {hasNodes && (
          <button
            onClick={handleRemixClick}
            disabled={!canRemix}
            className="rounded-lg transition-all disabled:opacity-30"
            style={{
              padding: '6px 14px',
              fontSize: '12px',
              letterSpacing: '-0.12px',
              color: 'var(--accent)',
              border: '1px solid var(--accent)',
            }}
            title={simulationStatus !== 'idle' ? 'Stop the simulation to remix' : 'Remix this diagram'}
          >
            Remix
          </button>
        )}

        {/* Save */}
        <button
          onClick={handleSave}
          className="rounded-lg transition-all"
          style={{
            padding: '6px 12px',
            fontSize: '12px',
            letterSpacing: '-0.12px',
            color: 'var(--text-tertiary)',
            border: '1px solid var(--border-color)',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.borderColor = 'var(--border-strong)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-tertiary)'; e.currentTarget.style.borderColor = 'var(--border-color)'; }}
        >
          Save
        </button>

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          className="rounded-lg transition-all duration-200 flex items-center justify-center"
          style={{
            width: '32px',
            height: '32px',
            color: 'var(--text-tertiary)',
            border: '1px solid var(--border-color)',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.borderColor = 'var(--border-strong)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-tertiary)'; e.currentTarget.style.borderColor = 'var(--border-color)'; }}
          title="Toggle theme"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="5" />
            <line x1="12" y1="1" x2="12" y2="3" />
            <line x1="12" y1="21" x2="12" y2="23" />
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
            <line x1="1" y1="12" x2="3" y2="12" />
            <line x1="21" y1="12" x2="23" y2="12" />
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
          </svg>
        </button>
      </div>
    </div>

    {remixOpen && (
      <RemixInput
        onClose={() => setRemixOpen(false)}
        onSuccess={handleRemixSuccess}
      />
    )}

    {showConfirm && (
      <ConfirmModal
        title="Replace current canvas?"
        body="This will replace your current design. You can undo with ⌘Z."
        confirmLabel="Replace"
        onConfirm={handleConfirmRemix}
        onCancel={() => setShowConfirm(false)}
      />
    )}

    {toastMsg && (
      <UndoToast
        message={toastMsg}
        onDismiss={handleToastDismiss}
      />
    )}
    </>
  );
}

function handleSave() {
  const state = useStore.getState();
  const session = {
    systemsimVersion: '1.0', mode: state.appMode, scenarioId: state.scenarioId, intent: state.intent ?? null,
    session: { createdAt: new Date().toISOString(), lastModified: new Date().toISOString() },
    design: { requirements: { functional: state.functionalReqs, nonFunctional: state.nonFunctionalReqs }, apiContracts: state.apiContracts, endpointRoutes: state.endpointRoutes, schemaMemory: state.schemaMemory, schemaHistory: state.schemaHistory },
    componentGraph: { components: state.nodes.map((n) => ({ id: n.id, type: n.data.type, label: n.data.label, position: n.position, config: n.data.config })), wires: state.edges.map((e) => ({ id: e.id, from: { componentId: e.source, port: 'output' }, to: { componentId: e.target, port: 'input' }, config: e.data?.config })) },
    simulationRuns: state.simulationRuns,
  };
  const blob = new Blob([JSON.stringify(session, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `systemsim-${state.scenarioId ?? 'freeform'}-${Date.now()}.json`; a.click();
  URL.revokeObjectURL(url);
}
