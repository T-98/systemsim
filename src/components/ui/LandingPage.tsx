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
        loadSessionFromJson(JSON.parse(text));
      } catch {
        console.error('Failed to load session file');
      }
    };
    input.click();
  };

  return (
    <div className="min-h-screen bg-[#08090D] flex flex-col items-center justify-center relative overflow-hidden">
      {/* Atmospheric background */}
      <div className="absolute inset-0 opacity-[0.035]"
        style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, #3B82F6 0.5px, transparent 0)', backgroundSize: '48px 48px' }} />
      <div className="absolute top-[30%] left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[500px] rounded-full"
        style={{ background: 'radial-gradient(ellipse, rgba(59,130,246,0.06) 0%, transparent 70%)' }} />

      <div className="relative z-10 max-w-[680px] w-full px-8 animate-fade-in-up">
        {/* Logo */}
        <div className="text-center mb-20">
          <div className="inline-block mb-5">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shadow-lg shadow-blue-500/15 mx-auto">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
                <path d="M10 6.5h4M10 17.5h4M6.5 10v4M17.5 10v4" />
              </svg>
            </div>
          </div>
          <h1 className="text-[42px] font-bold text-white tracking-tight leading-none mb-4" style={{ fontFamily: "'Playfair Display', serif" }}>
            System<span className="text-blue-400">Sim</span>
          </h1>
          <p className="text-[15px] text-[#5A6078] leading-relaxed max-w-sm mx-auto">
            Design distributed systems. Watch them break.<br />Learn why.
          </p>
        </div>

        {/* Cards */}
        <div className="grid grid-cols-2 gap-5 mb-14 animate-fade-in-up-1">
          {/* Scenario */}
          <button onClick={startScenario} className="group text-left rounded-xl p-6 transition-all duration-300
            bg-[#0C0D14] border border-[#14161F] hover:border-blue-500/25
            hover:shadow-[0_0_40px_-8px_rgba(59,130,246,0.12)]">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-7 h-7 rounded-lg bg-blue-500/8 flex items-center justify-center">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>
              </div>
              <span className="text-[10px] uppercase tracking-[0.2em] text-blue-400/70 font-semibold">Scenario</span>
            </div>
            <h3 className="text-[15px] font-semibold text-white mb-2.5 tracking-tight">{DISCORD_BRIEF.title}</h3>
            <p className="text-[13px] text-[#5A6078] leading-relaxed mb-5">{DISCORD_BRIEF.description}</p>
            <div className="flex items-center justify-between">
              <div className="flex gap-4 text-[11px] text-[#3A3F55]">
                <span>Fixed traffic</span>
                <span>AI evaluation</span>
              </div>
              <svg className="w-4 h-4 text-[#2A2F42] group-hover:text-blue-400 group-hover:translate-x-0.5 transition-all" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </div>
          </button>

          {/* Freeform */}
          <button onClick={startFreeform} className="group text-left rounded-xl p-6 transition-all duration-300
            bg-[#0C0D14] border border-[#14161F] hover:border-[#2A2F42]
            hover:shadow-[0_0_40px_-8px_rgba(255,255,255,0.03)]">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-7 h-7 rounded-lg bg-[#14161F] flex items-center justify-center">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5A6078" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15.3 15.3 0 010 20 15.3 15.3 0 010-20" /></svg>
              </div>
              <span className="text-[10px] uppercase tracking-[0.2em] text-[#4A5068] font-semibold">Freeform</span>
            </div>
            <h3 className="text-[15px] font-semibold text-white mb-2.5 tracking-tight">Blank Canvas</h3>
            <p className="text-[13px] text-[#5A6078] leading-relaxed mb-5">
              Build any system. Configure your own traffic profile. AI evaluates coherence against your requirements.
            </p>
            <div className="flex items-center justify-between">
              <div className="flex gap-4 text-[11px] text-[#3A3F55]">
                <span>Custom traffic</span>
                <span>Upload docs</span>
              </div>
              <svg className="w-4 h-4 text-[#2A2F42] group-hover:text-[#6A7090] group-hover:translate-x-0.5 transition-all" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </div>
          </button>
        </div>

        {/* Load session */}
        <div className="text-center animate-fade-in-up-2">
          <button onClick={loadSession}
            className="text-[12px] text-[#3A3F55] hover:text-[#6A7090] transition-colors inline-flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>
            Load session from file
          </button>
        </div>

        <div className="mt-24 text-center animate-fade-in-up-3">
          <p className="text-[11px] text-[#1E2030] tracking-wide">
            Logisim for backend architecture
          </p>
        </div>
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
