/**
 * @file components/ui/LearnSection.tsx
 *
 * Landing-page entry for drills (Decisions §72) — the learning wedge.
 * Cards load from /public/challenges/index.json; clicking one stages the
 * broken scenario on the canvas, auto-runs it, and arms the drill HUD.
 */

import { useEffect, useState } from 'react';
import { loadChallenge } from '../../challenges/loadChallenge';
import type { ChallengeIndexEntry } from '../../challenges/types';

const DIFFICULTY_COLOR: Record<string, string> = {
  intro: 'var(--success, #34c759)',
  intermediate: 'var(--warning)',
  hard: 'var(--destructive)',
};

export default function LearnSection() {
  const [drills, setDrills] = useState<ChallengeIndexEntry[]>([]);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/challenges/index.json')
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => { if (!cancelled && Array.isArray(data)) setDrills(data); })
      .catch(() => { /* section simply doesn't render */ });
    return () => { cancelled = true; };
  }, []);

  if (drills.length === 0) return null;

  const handleClick = async (id: string) => {
    if (loadingId) return;
    setLoadingId(id);
    const ok = await loadChallenge(id);
    if (!ok) setLoadingId(null); // success navigates away; only reset on failure
  };

  return (
    <div className="mb-10 animate-fade-in-2" data-testid="learn-section">
      <h2
        className="mb-1 font-medium uppercase"
        style={{ fontSize: '11px', color: 'var(--text-tertiary)', letterSpacing: '0.18em' }}
      >
        Learn — fix a production fire
      </h2>
      <p className="mb-4" style={{ fontSize: 13, color: 'var(--text-tertiary)', letterSpacing: '-0.12px' }}>
        Each drill drops you into a broken, running system. Read the symptoms, name the
        cause, change the design — the simulator checks your fix.
      </p>
      <div className="grid grid-cols-2 gap-3">
        {drills.map((d) => (
          <button
            key={d.id}
            data-testid={`drill-${d.id}`}
            onClick={() => handleClick(d.id)}
            disabled={loadingId !== null}
            className="group text-left rounded-lg p-5 transition-all duration-200"
            style={{
              background: 'var(--bg-card)',
              opacity: loadingId && loadingId !== d.id ? 0.5 : 1,
            }}
            onMouseEnter={(e) => { if (!loadingId) e.currentTarget.style.boxShadow = 'var(--shadow-elevated)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'none'; }}
          >
            <div className="flex items-center gap-2 mb-1.5">
              <h3 className="font-semibold" style={{ fontSize: '15px', color: 'var(--text-primary)', letterSpacing: '-0.224px' }}>
                {d.title}
                {loadingId === d.id && (
                  <span className="ml-2 inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                )}
              </h3>
            </div>
            <p className="mb-3" style={{ fontSize: '12px', color: 'var(--text-tertiary)', letterSpacing: '-0.12px', lineHeight: 1.5 }}>
              {d.tagline}
            </p>
            <div className="flex gap-1.5 flex-wrap items-center">
              <span
                className="rounded-md px-2 py-0.5"
                style={{ fontSize: '11px', background: 'var(--bg-hover)', color: DIFFICULTY_COLOR[d.difficulty] ?? 'var(--text-tertiary)', letterSpacing: '-0.12px' }}
              >
                {d.difficulty}
              </span>
              <span
                className="rounded-md px-2 py-0.5"
                style={{ fontSize: '11px', background: 'var(--bg-hover)', color: 'var(--text-tertiary)', letterSpacing: '-0.12px' }}
              >
                {d.kbRef}
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
