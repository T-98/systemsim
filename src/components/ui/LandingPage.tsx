import { useStore } from '../../store';
import { DISCORD_BRIEF, DISCORD_TRAFFIC_PROFILE, DISCORD_DEFAULT_FUNCTIONAL_REQS, DISCORD_DEFAULT_NFRS, DISCORD_SCENARIO_ID } from '../../scenarios/discord';

export default function LandingPage() {
  const setAppMode = useStore((s) => s.setAppMode);
  const setAppView = useStore((s) => s.setAppView);
  const setScenarioId = useStore((s) => s.setScenarioId);
  const setTrafficProfile = useStore((s) => s.setTrafficProfile);
  const setFunctionalReqs = useStore((s) => s.setFunctionalReqs);
  const setNonFunctionalReqs = useStore((s) => s.setNonFunctionalReqs);

  const startScenario = () => {
    setAppMode('scenario');
    setScenarioId(DISCORD_SCENARIO_ID);
    setTrafficProfile(DISCORD_TRAFFIC_PROFILE);
    setFunctionalReqs(DISCORD_DEFAULT_FUNCTIONAL_REQS);
    setNonFunctionalReqs(DISCORD_DEFAULT_NFRS);
    setAppView('design');
  };

  const startFreeform = () => {
    setAppMode('freeform');
    setScenarioId(null);
    setAppView('canvas');
  };

  const loadSession = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const session = JSON.parse(text);
        loadSessionFromJson(session);
      } catch {
        console.error('Failed to load session file');
      }
    };
    input.click();
  };

  return (
    <div className="min-h-screen bg-[#0F1117] flex items-center justify-center">
      <div className="max-w-2xl text-center px-4">
        <h1 className="text-3xl font-bold text-white mb-2 tracking-tight">SystemSim</h1>
        <p className="text-sm text-gray-500 mb-12">Distributed systems design simulator</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          {/* Scenario Card */}
          <div
            onClick={startScenario}
            className="bg-[#13151E] border border-[#1E2030] hover:border-blue-500/50 rounded-sm p-6 cursor-pointer transition-all text-left group"
          >
            <div className="text-[10px] uppercase tracking-wider text-blue-400 mb-2">Scenario</div>
            <h3 className="text-sm font-semibold text-white mb-2">{DISCORD_BRIEF.title}</h3>
            <p className="text-xs text-gray-400 leading-relaxed mb-4">{DISCORD_BRIEF.description}</p>
            <div className="text-[10px] text-gray-600">
              Fixed traffic profile &middot; AI-calibrated evaluation
            </div>
          </div>

          {/* Freeform Card */}
          <div
            onClick={startFreeform}
            className="bg-[#13151E] border border-[#1E2030] hover:border-blue-500/50 rounded-sm p-6 cursor-pointer transition-all text-left group"
          >
            <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">Freeform</div>
            <h3 className="text-sm font-semibold text-white mb-2">Blank Canvas</h3>
            <p className="text-xs text-gray-400 leading-relaxed mb-4">
              Build any system. Configure your own traffic profile. AI feedback evaluates coherence against your stated requirements.
            </p>
            <div className="text-[10px] text-gray-600">
              Configurable traffic &middot; Upload reference docs
            </div>
          </div>
        </div>

        <button
          onClick={loadSession}
          className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          Load session from file
        </button>
      </div>
    </div>
  );
}

function loadSessionFromJson(session: Record<string, unknown>) {
  const store = useStore.getState();
  const s = session as any;

  store.setAppMode(s.mode ?? 'freeform');
  store.setScenarioId(s.scenarioId ?? null);

  if (s.design?.requirements?.functional) store.setFunctionalReqs(s.design.requirements.functional);
  if (s.design?.requirements?.nonFunctional) store.setNonFunctionalReqs(s.design.requirements.nonFunctional);
  if (s.design?.apiContracts) store.setApiContracts(s.design.apiContracts);
  if (s.design?.schemaMemory) store.setSchemaMemory(s.design.schemaMemory);

  // Restore component graph
  if (s.componentGraph?.components) {
    for (const comp of s.componentGraph.components) {
      const id = store.addComponent(comp.type, comp.position);
      store.updateComponentLabel(id, comp.label);
      store.updateComponentConfig(id, comp.config);
    }
  }

  if (s.trafficProfile) store.setTrafficProfile(s.trafficProfile);

  store.setAppView('canvas');
}
