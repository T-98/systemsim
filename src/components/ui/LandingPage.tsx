import { useStore } from '../../store';
import { DISCORD_BRIEF, DISCORD_TRAFFIC_PROFILE, DISCORD_DEFAULT_FUNCTIONAL_REQS, DISCORD_DEFAULT_NFRS, DISCORD_SCENARIO_ID } from '../../scenarios/discord';
import TemplatePicker from './TemplatePicker';
import UnifiedInput from './UnifiedInput';
import type { ComponentType, CanonicalGraph } from '../../types';

const TEXT_TO_DIAGRAM_ENABLED = import.meta.env.VITE_ENABLE_TEXT_TO_DIAGRAM === 'true';

export default function LandingPage() {
  const setAppMode = useStore((s) => s.setAppMode);
  const setAppView = useStore((s) => s.setAppView);
  const setScenarioId = useStore((s) => s.setScenarioId);
  const setTrafficProfile = useStore((s) => s.setTrafficProfile);
  const setFunctionalReqs = useStore((s) => s.setFunctionalReqs);
  const setNonFunctionalReqs = useStore((s) => s.setNonFunctionalReqs);
  const toggleTheme = useStore((s) => s.toggleTheme);
  const replaceGraph = useStore((s) => s.replaceGraph);

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

      {/* Theme toggle */}
      <button
        onClick={toggleTheme}
        className="absolute top-6 right-6 z-20 w-9 h-9 rounded-full flex items-center justify-center transition-colors duration-200"
        style={{ background: 'var(--bg-card)', color: 'var(--text-tertiary)' }}
        title="Toggle theme"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="5" />
          <line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
          <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
        </svg>
      </button>

      <div className="relative z-10 max-w-[640px] w-full px-8">
        {/* Hero */}
        <div className="text-center mb-16 animate-fade-in">
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
            style={{ fontSize: '17px', color: 'var(--text-tertiary)', letterSpacing: '-0.374px' }}
          >
            Design distributed systems. Watch them break.<br />Learn why.
          </p>
        </div>

        {/* Text-to-diagram */}
        <div className="mb-10 animate-fade-in-1">
          {TEXT_TO_DIAGRAM_ENABLED ? (
            <UnifiedInput />
          ) : (
            <>
              <div className="flex items-center gap-2 mb-2">
                <span
                  className="font-semibold"
                  style={{ fontSize: '14px', color: 'var(--text-tertiary)', letterSpacing: '-0.224px' }}
                >
                  Describe your system
                </span>
                <span
                  className="rounded-full px-2 py-0.5"
                  style={{
                    fontSize: '10px',
                    fontWeight: 600,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase' as const,
                    background: 'rgba(0,113,227,0.15)',
                    color: 'var(--accent)',
                  }}
                >
                  Coming soon
                </span>
              </div>
              <textarea
                disabled
                placeholder="An API server behind a load balancer, connected to a Postgres database and Redis cache..."
                className="w-full rounded-lg resize-none"
                rows={3}
                style={{
                  background: 'var(--bg-card)',
                  color: 'var(--text-tertiary)',
                  fontSize: '14px',
                  letterSpacing: '-0.224px',
                  padding: '12px 16px',
                  border: '1px solid var(--border-color)',
                  opacity: 0.5,
                  cursor: 'not-allowed',
                }}
              />
            </>
          )}
        </div>

        {/* Templates (Phase 1 primary) */}
        <div className="mb-10 animate-fade-in-1">
          <h2
            className="mb-4 font-normal"
            style={{ fontSize: '14px', color: 'var(--text-tertiary)', letterSpacing: '-0.224px' }}
          >
            Or start from a template
          </h2>
          <TemplatePicker />
        </div>

        {/* Scenario card (existing) */}
        <div className="mb-6 animate-fade-in-2">
          <button
            onClick={startScenario}
            className="group text-left rounded-lg p-5 w-full transition-all duration-200"
            style={{ background: 'var(--bg-card)' }}
            onMouseEnter={(e) => { e.currentTarget.style.boxShadow = 'var(--shadow-elevated)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'none'; }}
          >
            <div className="flex items-center gap-2 mb-2">
              <div
                className="w-5 h-5 rounded flex items-center justify-center"
                style={{ background: 'var(--accent-ring)' }}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>
              </div>
              <span
                className="uppercase font-semibold"
                style={{ fontSize: '10px', letterSpacing: '0.15em', color: 'var(--accent)' }}
              >
                Guided Scenario
              </span>
            </div>
            <h3
              className="font-semibold mb-1"
              style={{ fontSize: '14px', color: 'var(--text-primary)', letterSpacing: '-0.224px' }}
            >
              {DISCORD_BRIEF.title}
            </h3>
            <p
              style={{ fontSize: '12px', color: 'var(--text-tertiary)', letterSpacing: '-0.12px' }}
            >
              {DISCORD_BRIEF.description}
            </p>
          </button>
        </div>

        {/* Tertiary links */}
        <div className="flex items-center justify-center gap-6 animate-fade-in-2">
          <button
            onClick={startFreeform}
            className="inline-flex items-center gap-1.5 transition-colors"
            style={{ fontSize: '13px', color: 'var(--text-tertiary)', letterSpacing: '-0.224px' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-link)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-tertiary)'; }}
          >
            Start from a blank canvas
          </button>
          <span style={{ color: 'var(--border-color)' }}>|</span>
          <button
            onClick={loadSession}
            className="inline-flex items-center gap-1.5 transition-colors"
            style={{ fontSize: '13px', color: 'var(--text-tertiary)', letterSpacing: '-0.224px' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-link)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-tertiary)'; }}
          >
            Load session from file
          </button>
        </div>

        <div className="mt-16 text-center animate-fade-in-3">
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
  store.setIntent(typeof s.intent === 'string' ? s.intent : null);
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

    const idByOriginal = new Map<string, number>();
    const canonicalNodes = components.map((comp, i) => {
      idByOriginal.set(comp.id, i);
      return {
        type: comp.type as ComponentType,
        label: comp.label,
        position: comp.position,
        config: comp.config,
      };
    });

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
