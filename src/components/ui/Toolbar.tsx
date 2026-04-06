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
    // Check for hints before running
    const hints = checkForHints(nodes, edges, scenarioId);
    hints.forEach((h) => addHint(h));

    const profile = scenarioId === 'discord_notification_fanout'
      ? DISCORD_TRAFFIC_PROFILE
      : trafficProfile;

    if (!profile) return;
    startSimulation(profile);
  };

  const handleStop = () => {
    // Generate debrief
    const state = useStore.getState();
    const latestRun = state.simulationRuns[state.simulationRuns.length - 1];
    if (latestRun) {
      const debrief = generateDebrief({
        nodes: state.nodes,
        edges: state.edges,
        functionalReqs: state.functionalReqs,
        nonFunctionalReqs: state.nonFunctionalReqs,
        apiContracts: state.apiContracts,
        schemaMemory: state.schemaMemory,
        simulationRun: latestRun,
        scenarioId: state.scenarioId,
      });
      setDebrief(debrief);
      setDebriefVisible(true);
    }
  };

  const scenarioTitle = scenarioId === 'discord_notification_fanout' ? DISCORD_BRIEF.title : 'Freeform Design';

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  };

  const profileDuration = scenarioId === 'discord_notification_fanout'
    ? DISCORD_TRAFFIC_PROFILE.durationSeconds
    : trafficProfile?.durationSeconds ?? 0;

  return (
    <div className="h-11 bg-[#0D0F17] border-b border-[#1E2030] flex items-center justify-between px-4 shrink-0">
      <div className="flex items-center gap-3">
        <span className="text-sm font-bold text-white tracking-tight">SystemSim</span>
        <span className="text-[10px] text-gray-500">|</span>
        <span className="text-xs text-gray-400">{scenarioTitle}</span>
        {appMode === 'scenario' && (
          <button
            onClick={() => setAppView('design')}
            className="text-[10px] text-blue-400 hover:text-blue-300 ml-2"
          >
            Design Flow
          </button>
        )}
      </div>

      <div className="flex items-center gap-3">
        {/* Simulation time */}
        {(isRunning || isPaused || isCompleted) && (
          <div className="flex items-center gap-2 text-xs font-mono text-gray-400">
            <span>{formatTime(simulationTime)}</span>
            <span className="text-gray-600">/</span>
            <span>{formatTime(profileDuration)}</span>
            {/* Progress bar */}
            <div className="w-24 h-1 bg-[#1E2030] rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-all"
                style={{ width: `${profileDuration > 0 ? (simulationTime / profileDuration) * 100 : 0}%` }}
              />
            </div>
          </div>
        )}

        {/* Speed control */}
        <div className="flex items-center gap-1">
          {[1, 2, 5, 10].map((speed) => (
            <button
              key={speed}
              onClick={() => setSimulationSpeed(speed)}
              className={`px-1.5 py-0.5 text-[10px] rounded-sm ${
                simulationSpeed === speed ? 'bg-blue-600 text-white' : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {speed}x
            </button>
          ))}
        </div>

        {/* View toggle */}
        <button
          onClick={() => setViewMode(viewMode === 'particle' ? 'aggregate' : 'particle')}
          className="px-2 py-1 text-[10px] text-gray-400 hover:text-gray-200 border border-[#2A2D3A] rounded-sm"
          title="Toggle view (V)"
        >
          {viewMode === 'particle' ? 'Particle' : 'Aggregate'}
        </button>

        {/* Run/Pause controls */}
        {simulationStatus === 'idle' && (
          <button
            onClick={handleRun}
            disabled={nodes.length === 0}
            className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded-sm disabled:opacity-40 font-medium"
          >
            Run
          </button>
        )}
        {isRunning && (
          <button
            onClick={pauseSimulation}
            className="px-3 py-1.5 text-xs bg-amber-600 hover:bg-amber-500 text-white rounded-sm font-medium"
          >
            Pause
          </button>
        )}
        {isPaused && (
          <button
            onClick={resumeSimulation}
            className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded-sm font-medium"
          >
            Resume
          </button>
        )}
        {isCompleted && (
          <>
            <button
              onClick={handleStop}
              className="px-3 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-500 text-white rounded-sm font-medium"
            >
              Debrief
            </button>
            <button
              onClick={() => {
                useStore.getState().resetSimulationState();
              }}
              className="px-3 py-1.5 text-xs bg-[#1A1D27] hover:bg-[#252838] text-gray-300 rounded-sm border border-[#2A2D3A]"
            >
              Reset
            </button>
          </>
        )}

        {/* Save */}
        <button
          onClick={handleSave}
          className="px-2 py-1 text-[10px] text-gray-400 hover:text-gray-200 border border-[#2A2D3A] rounded-sm"
        >
          Save
        </button>
      </div>
    </div>
  );
}

function handleSave() {
  const state = useStore.getState();
  const session = {
    systemsimVersion: '1.0',
    mode: state.appMode,
    scenarioId: state.scenarioId,
    session: {
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
    },
    design: {
      requirements: {
        functional: state.functionalReqs,
        nonFunctional: state.nonFunctionalReqs,
      },
      apiContracts: state.apiContracts,
      schemaMemory: state.schemaMemory,
      schemaHistory: state.schemaHistory,
    },
    componentGraph: {
      components: state.nodes.map((n) => ({
        id: n.id,
        type: n.data.type,
        label: n.data.label,
        position: n.position,
        config: n.data.config,
      })),
      wires: state.edges.map((e) => ({
        id: e.id,
        from: { componentId: e.source, port: 'output' },
        to: { componentId: e.target, port: 'input' },
        config: e.data?.config,
      })),
    },
    simulationRuns: state.simulationRuns,
  };

  const blob = new Blob([JSON.stringify(session, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `systemsim-${state.scenarioId ?? 'freeform'}-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
