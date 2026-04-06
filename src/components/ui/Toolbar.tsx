import { useStore } from '../../store';
import { useSimulation } from '../../engine/useSimulation';
import { DISCORD_TRAFFIC_PROFILE, DISCORD_BRIEF } from '../../scenarios/discord';
import { generateDebrief, checkForHints } from '../../ai/debrief';

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
  const { startSimulation, pauseSimulation, resumeSimulation } = useSimulation();

  const isRunning = simulationStatus === 'running';
  const isPaused = simulationStatus === 'paused';
  const isCompleted = simulationStatus === 'completed';

  const handleRun = () => {
    const hints = checkForHints(nodes, edges, scenarioId);
    hints.forEach((h) => addHint(h));
    const profile = scenarioId === 'discord_notification_fanout' ? DISCORD_TRAFFIC_PROFILE : trafficProfile;
    if (!profile) return;
    startSimulation(profile);
  };

  const handleStop = () => {
    const state = useStore.getState();
    const latestRun = state.simulationRuns[state.simulationRuns.length - 1];
    if (latestRun) {
      const debrief = generateDebrief({ nodes: state.nodes, edges: state.edges, functionalReqs: state.functionalReqs, nonFunctionalReqs: state.nonFunctionalReqs, apiContracts: state.apiContracts, schemaMemory: state.schemaMemory, simulationRun: latestRun, scenarioId: state.scenarioId });
      setDebrief(debrief);
      setDebriefVisible(true);
    }
  };

  const scenarioTitle = scenarioId === 'discord_notification_fanout' ? DISCORD_BRIEF.title : 'Freeform Design';
  const formatTime = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const profileDuration = scenarioId === 'discord_notification_fanout' ? DISCORD_TRAFFIC_PROFILE.durationSeconds : trafficProfile?.durationSeconds ?? 0;
  const progress = profileDuration > 0 ? (simulationTime / profileDuration) * 100 : 0;

  return (
    <div className="h-12 bg-[#0A0B12] border-b border-[#14161F] flex items-center justify-between px-5 shrink-0">
      {/* Left: Logo + breadcrumb */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
              <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
          </div>
          <span className="text-[13px] font-semibold text-white tracking-tight">SystemSim</span>
        </div>
        <svg className="w-3 h-3 text-[#2A2F42]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6" /></svg>
        <span className="text-[12px] text-[#5A6078]">{scenarioTitle}</span>
        {appMode === 'scenario' && (
          <button onClick={() => setAppView('design')} className="text-[11px] text-blue-400/60 hover:text-blue-400 transition-colors ml-1">
            Design Flow
          </button>
        )}
      </div>

      {/* Right: Controls */}
      <div className="flex items-center gap-4">
        {/* Timer + Progress */}
        {(isRunning || isPaused || isCompleted) && (
          <div className="flex items-center gap-3">
            <span className="text-[12px] font-mono text-[#6A7090] tabular-nums">{formatTime(simulationTime)}</span>
            <div className="w-28 h-[3px] bg-[#14161F] rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-blue-500 to-blue-400 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
            </div>
            <span className="text-[12px] font-mono text-[#3A3F55] tabular-nums">{formatTime(profileDuration)}</span>
          </div>
        )}

        {/* Speed */}
        <div className="flex items-center bg-[#0C0D14] rounded-lg border border-[#14161F] overflow-hidden">
          {[1, 2, 5, 10].map((speed) => (
            <button key={speed} onClick={() => setSimulationSpeed(speed)}
              className={`px-2.5 py-1.5 text-[10px] font-mono font-medium transition-all duration-200
                ${simulationSpeed === speed ? 'bg-blue-600 text-white shadow-inner' : 'text-[#4A5068] hover:text-[#8890A8]'}`}>
              {speed}x
            </button>
          ))}
        </div>

        {/* View toggle */}
        <button onClick={() => setViewMode(viewMode === 'particle' ? 'aggregate' : 'particle')}
          className="px-3 py-1.5 text-[11px] text-[#5A6078] hover:text-white border border-[#14161F] hover:border-[#2A2F42] rounded-lg transition-all duration-200"
          title="Toggle view (V)">
          {viewMode === 'particle' ? 'Particle' : 'Aggregate'}
        </button>

        {/* Sim controls */}
        {simulationStatus === 'idle' && (
          <button onClick={handleRun} disabled={nodes.length === 0}
            className="px-4 py-1.5 text-[12px] font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg disabled:opacity-25 transition-all shadow-lg shadow-blue-500/15 hover:shadow-blue-500/25">
            Run
          </button>
        )}
        {isRunning && (
          <button onClick={pauseSimulation}
            className="px-4 py-1.5 text-[12px] font-medium bg-amber-600 hover:bg-amber-500 text-white rounded-lg transition-all">
            Pause
          </button>
        )}
        {isPaused && (
          <button onClick={resumeSimulation}
            className="px-4 py-1.5 text-[12px] font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-all">
            Resume
          </button>
        )}
        {isCompleted && (
          <>
            <button onClick={handleStop}
              className="px-4 py-1.5 text-[12px] font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-all">
              Debrief
            </button>
            <button onClick={() => useStore.getState().resetSimulationState()}
              className="px-3 py-1.5 text-[12px] text-[#6A7090] border border-[#14161F] hover:border-[#2A2F42] hover:text-white rounded-lg transition-all">
              Reset
            </button>
          </>
        )}

        {/* Save */}
        <button onClick={handleSave}
          className="px-3 py-1.5 text-[11px] text-[#4A5068] hover:text-[#8890A8] border border-[#14161F] hover:border-[#2A2F42] rounded-lg transition-all">
          Save
        </button>
      </div>
    </div>
  );
}

function handleSave() {
  const state = useStore.getState();
  const session = {
    systemsimVersion: '1.0', mode: state.appMode, scenarioId: state.scenarioId,
    session: { createdAt: new Date().toISOString(), lastModified: new Date().toISOString() },
    design: { requirements: { functional: state.functionalReqs, nonFunctional: state.nonFunctionalReqs }, apiContracts: state.apiContracts, schemaMemory: state.schemaMemory, schemaHistory: state.schemaHistory },
    componentGraph: { components: state.nodes.map((n) => ({ id: n.id, type: n.data.type, label: n.data.label, position: n.position, config: n.data.config })), wires: state.edges.map((e) => ({ id: e.id, from: { componentId: e.source, port: 'output' }, to: { componentId: e.target, port: 'input' }, config: e.data?.config })) },
    simulationRuns: state.simulationRuns,
  };
  const blob = new Blob([JSON.stringify(session, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `systemsim-${state.scenarioId ?? 'freeform'}-${Date.now()}.json`; a.click();
  URL.revokeObjectURL(url);
}
