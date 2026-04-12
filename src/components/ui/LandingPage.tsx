import { useStore } from '../../store';
import { DISCORD_BRIEF, DISCORD_TRAFFIC_PROFILE, DISCORD_DEFAULT_FUNCTIONAL_REQS, DISCORD_DEFAULT_NFRS, DISCORD_SCENARIO_ID } from '../../scenarios/discord';

export default function LandingPage() {
  const setAppMode = useStore((s) => s.setAppMode);
  const setAppView = useStore((s) => s.setAppView);
  const setScenarioId = useStore((s) => s.setScenarioId);
  const setTrafficProfile = useStore((s) => s.setTrafficProfile);
  const setFunctionalReqs = useStore((s) => s.setFunctionalReqs);
  const setNonFunctionalReqs = useStore((s) => s.setNonFunctionalReqs);
  const toggleTheme = useStore((s) => s.toggleTheme);

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
    <div
      className="min-h-screen flex flex-col items-center justify-center relative overflow-hidden"
      style={{ background: 'var(--bg-primary)' }}
    >
      {/* Atmospheric background */}
      <div
        className="absolute inset-0"
        style={{
          opacity: 0.035,
          backgroundImage: 'radial-gradient(circle at 1px 1px, var(--accent) 0.5px, transparent 0)',
          backgroundSize: '48px 48px',
        }}
      />
      <div
        className="absolute top-[30%] left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[500px] rounded-full"
        style={{ background: 'radial-gradient(ellipse, rgba(0,113,227,0.06) 0%, transparent 70%)' }}
      />

      {/* Theme toggle in top right */}
      <button
        onClick={toggleTheme}
        className="absolute top-6 right-6 z-20 w-9 h-9 rounded-full flex items-center justify-center transition-colors duration-200"
        style={{
          background: 'var(--bg-card)',
          color: 'var(--text-tertiary)',
        }}
        title="Toggle theme"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
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

      <div className="relative z-10 max-w-[680px] w-full px-8 animate-fade-in">
        {/* Logo */}
        <div className="text-center mb-20">
          <div className="inline-block mb-5">
            <div
              className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto"
              style={{
                background: 'linear-gradient(135deg, var(--accent), var(--accent-hover))',
                boxShadow: '0 4px 12px rgba(0,113,227,0.15)',
              }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
                <path d="M10 6.5h4M10 17.5h4M6.5 10v4M17.5 10v4" />
              </svg>
            </div>
          </div>
          <h1
            className="font-semibold tracking-tight leading-none mb-4"
            style={{
              fontSize: '56px',
              letterSpacing: '-0.374px',
              color: 'var(--text-primary)',
              fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
            }}
          >
            System<span style={{ color: 'var(--accent)' }}>Sim</span>
          </h1>
          <p
            className="leading-relaxed max-w-sm mx-auto"
            style={{
              fontSize: '17px',
              color: 'var(--text-tertiary)',
              letterSpacing: '-0.374px',
            }}
          >
            Design distributed systems. Watch them break.<br />Learn why.
          </p>
        </div>

        {/* Cards */}
        <div className="grid grid-cols-2 gap-5 mb-14 animate-fade-in-1">
          {/* Scenario */}
          <button
            onClick={startScenario}
            className="group text-left rounded-lg p-6 transition-all duration-300"
            style={{
              background: 'var(--bg-card)',
              boxShadow: 'var(--shadow-card)',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.boxShadow = 'var(--shadow-elevated)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'var(--shadow-card)'; }}
          >
            <div className="flex items-center gap-2.5 mb-4">
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center"
                style={{ background: 'var(--accent-ring)' }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>
              </div>
              <span
                className="uppercase font-semibold"
                style={{ fontSize: '10px', letterSpacing: '0.2em', color: 'var(--accent)' }}
              >
                Scenario
              </span>
            </div>
            <h3
              className="font-semibold mb-2.5 tracking-tight"
              style={{ fontSize: '15px', color: 'var(--text-primary)', letterSpacing: '-0.224px' }}
            >
              {DISCORD_BRIEF.title}
            </h3>
            <p
              className="leading-relaxed mb-5"
              style={{ fontSize: '14px', color: 'var(--text-tertiary)', letterSpacing: '-0.224px' }}
            >
              {DISCORD_BRIEF.description}
            </p>
            <div className="flex items-center justify-between">
              <div className="flex gap-4" style={{ fontSize: '12px', color: 'var(--text-tertiary)', letterSpacing: '-0.12px' }}>
                <span>Fixed traffic</span>
                <span>AI evaluation</span>
              </div>
              <svg
                className="w-4 h-4 group-hover:translate-x-0.5 transition-all"
                style={{ color: 'var(--text-tertiary)' }}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                viewBox="0 0 24 24"
              >
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </div>
          </button>

          {/* Freeform */}
          <button
            onClick={startFreeform}
            className="group text-left rounded-lg p-6 transition-all duration-300"
            style={{
              background: 'var(--bg-card)',
              boxShadow: 'var(--shadow-card)',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.boxShadow = 'var(--shadow-elevated)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'var(--shadow-card)'; }}
          >
            <div className="flex items-center gap-2.5 mb-4">
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center"
                style={{ background: 'var(--bg-hover)' }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15.3 15.3 0 010 20 15.3 15.3 0 010-20" /></svg>
              </div>
              <span
                className="uppercase font-semibold"
                style={{ fontSize: '10px', letterSpacing: '0.2em', color: 'var(--text-tertiary)' }}
              >
                Freeform
              </span>
            </div>
            <h3
              className="font-semibold mb-2.5 tracking-tight"
              style={{ fontSize: '15px', color: 'var(--text-primary)', letterSpacing: '-0.224px' }}
            >
              Blank Canvas
            </h3>
            <p
              className="leading-relaxed mb-5"
              style={{ fontSize: '14px', color: 'var(--text-tertiary)', letterSpacing: '-0.224px' }}
            >
              Build any system. Configure your own traffic profile. AI evaluates coherence against your requirements.
            </p>
            <div className="flex items-center justify-between">
              <div className="flex gap-4" style={{ fontSize: '12px', color: 'var(--text-tertiary)', letterSpacing: '-0.12px' }}>
                <span>Custom traffic</span>
                <span>Upload docs</span>
              </div>
              <svg
                className="w-4 h-4 group-hover:translate-x-0.5 transition-all"
                style={{ color: 'var(--text-tertiary)' }}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                viewBox="0 0 24 24"
              >
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </div>
          </button>
        </div>

        {/* Load session */}
        <div className="text-center animate-fade-in-2">
          <button
            onClick={loadSession}
            className="inline-flex items-center gap-2 transition-colors"
            style={{ fontSize: '14px', color: 'var(--text-tertiary)', letterSpacing: '-0.224px' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-link)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-tertiary)'; }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>
            Load session from file
          </button>
        </div>

        <div className="mt-24 text-center animate-fade-in-3">
          <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', letterSpacing: '-0.12px', opacity: 0.5 }}>
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
    const components = s.componentGraph.components as Array<{
      id: string; type: string; label: string;
      position: { x: number; y: number }; config: Record<string, unknown>;
    }>;
    const wires = (s.componentGraph.wires ?? []) as Array<{
      id: string;
      from: { componentId: string };
      to: { componentId: string };
      config?: { throughputRps?: number; latencyMs?: number; jitterMs?: number };
    }>;

    // Build canonical graph preserving original ids
    const idByOriginal = new Map<string, number>();
    const canonicalNodes = components.map((comp, i) => {
      idByOriginal.set(comp.id, i);
      return {
        type: comp.type as import('../../types').ComponentType,
        label: comp.label,
        position: comp.position,
        config: comp.config,
      };
    });

    // Map wire source/target from original ids to canonical ids (type-index format)
    const canonicalEdges = wires
      .filter((w) => idByOriginal.has(w.from.componentId) && idByOriginal.has(w.to.componentId))
      .map((w) => {
        const srcIdx = idByOriginal.get(w.from.componentId)!;
        const tgtIdx = idByOriginal.get(w.to.componentId)!;
        const srcNode = canonicalNodes[srcIdx];
        const tgtNode = canonicalNodes[tgtIdx];
        return {
          source: `${srcNode.type}-${srcIdx}`,
          target: `${tgtNode.type}-${tgtIdx}`,
          config: w.config,
        };
      });

    store.replaceGraph({ nodes: canonicalNodes, edges: canonicalEdges }, { layout: 'preserve' });
  }

  if (s.trafficProfile) store.setTrafficProfile(s.trafficProfile);
  store.setAppView('canvas');
}
