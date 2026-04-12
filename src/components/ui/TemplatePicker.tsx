import { useState, useEffect } from 'react';
import { useStore } from '../../store';
import type { CanonicalGraph } from '../../types';

interface TemplateIndex {
  id: string;
  name: string;
  source: string;
  tags: string[];
  description: string;
}

interface TemplateFile {
  systemsimVersion: string;
  metadata: { name: string; source: string; sourceUrl?: string; tags: string[] };
  nodes: CanonicalGraph['nodes'];
  edges: CanonicalGraph['edges'];
}

export default function TemplatePicker() {
  const [templates, setTemplates] = useState<TemplateIndex[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const replaceGraph = useStore((s) => s.replaceGraph);
  const setAppMode = useStore((s) => s.setAppMode);
  const setAppView = useStore((s) => s.setAppView);
  const setScenarioId = useStore((s) => s.setScenarioId);

  useEffect(() => {
    fetch('/templates/index.json')
      .then((r) => r.json())
      .then((data) => { setTemplates(data); setLoading(false); })
      .catch(() => { setLoading(false); });
  }, []);

  const handleClick = async (id: string) => {
    if (loadingId) return;
    setLoadingId(id);
    setError(null);
    try {
      const res = await fetch(`/templates/${id}.json`);
      if (!res.ok) throw new Error('fetch failed');
      const tpl: TemplateFile = await res.json();
      replaceGraph({ nodes: tpl.nodes, edges: tpl.edges }, { layout: 'auto' });
      setAppMode('freeform');
      setScenarioId(null);
      setAppView('canvas');
    } catch {
      setError(`Couldn't load this template. Try another.`);
      setLoadingId(null);
    }
  };

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3">
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="rounded-lg animate-pulse"
            style={{ background: 'var(--bg-card)', height: '120px' }}
          />
        ))}
      </div>
    );
  }

  if (templates.length === 0) return null;

  return (
    <div>
      <div className="grid grid-cols-2 gap-3">
        {templates.map((tpl, i) => (
          <button
            key={tpl.id}
            onClick={() => handleClick(tpl.id)}
            disabled={loadingId !== null}
            className="group text-left rounded-lg p-5 transition-all duration-200"
            style={{
              background: 'var(--bg-card)',
              opacity: loadingId && loadingId !== tpl.id ? 0.5 : 1,
              animationDelay: `${i * 50}ms`,
            }}
            onMouseEnter={(e) => {
              if (!loadingId) e.currentTarget.style.boxShadow = 'var(--shadow-elevated)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            <h4
              className="font-semibold mb-1.5"
              style={{ fontSize: '15px', color: 'var(--text-primary)', letterSpacing: '-0.224px' }}
            >
              {tpl.name}
              {loadingId === tpl.id && (
                <span className="ml-2 inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
              )}
            </h4>
            <p
              className="mb-3"
              style={{ fontSize: '12px', color: 'var(--text-tertiary)', letterSpacing: '-0.12px' }}
            >
              {tpl.source}
            </p>
            <div className="flex gap-1.5 flex-wrap">
              {tpl.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-md px-2 py-0.5"
                  style={{
                    fontSize: '11px',
                    background: 'var(--bg-hover)',
                    color: 'var(--text-tertiary)',
                    letterSpacing: '-0.12px',
                  }}
                >
                  {tag}
                </span>
              ))}
            </div>
          </button>
        ))}
      </div>
      {error && (
        <p
          className="mt-3 text-center"
          style={{ fontSize: '13px', color: 'var(--warning)', letterSpacing: '-0.12px' }}
        >
          {error}
        </p>
      )}
    </div>
  );
}
