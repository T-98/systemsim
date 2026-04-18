/**
 * @file wiki/components/CoverageDebugRoute.tsx
 *
 * Dev-only coverage route. Lists every topic key referenced by a rendered
 * InfoIcon (via `window.__SYSTEMSIM_TOPIC_REFS__`) and flags any that
 * don't resolve in the registry. Prevents drift between the InfoIcons
 * scattered across the app and `src/wiki/topics.ts`.
 *
 * Designed to be visited after navigating through the app so references
 * accumulate. Refresh button re-reads the set. For E2E use, tests can
 * call `page.evaluate(() => window.__SYSTEMSIM_TOPIC_REFS__)` directly.
 */

import { useEffect, useState } from 'react';
import { useStore } from '../../store';
import { lookupTopic, listTopicKeys } from '../topics';

function snapshotRefs(): string[] {
  const s = typeof window !== 'undefined' ? window.__SYSTEMSIM_TOPIC_REFS__ : undefined;
  return s ? [...s].sort() : [];
}

export default function CoverageDebugRoute() {
  const [refs, setRefs] = useState<string[]>([]);
  const [tick, setTick] = useState(0);
  const closeWiki = useStore((s) => s.closeWiki);
  const registry = listTopicKeys();

  useEffect(() => {
    setRefs(snapshotRefs());
  }, [tick]);

  const unresolved = refs.filter((r) => !lookupTopic(r).resolved);
  const declaredButUnused = registry.filter((k) => !refs.includes(k));

  return (
    <div
      className="h-screen flex flex-col"
      style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}
    >
      <header
        className="flex items-center justify-between"
        style={{ padding: '14px 20px', borderBottom: '1px solid var(--border-color)', background: 'var(--bg-sidebar)' }}
      >
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={closeWiki}
            data-testid="wiki-coverage-back"
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              background: 'transparent',
              border: '1px solid var(--border-color)',
              color: 'var(--text-secondary)',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            ← Back
          </button>
          <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-0.24px' }}>
            Wiki coverage (dev)
          </div>
        </div>
        <button
          type="button"
          onClick={() => setTick((t) => t + 1)}
          data-testid="wiki-coverage-refresh"
          style={{
            padding: '6px 12px',
            borderRadius: 6,
            background: 'var(--accent)',
            color: 'white',
            border: 'none',
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          Refresh
        </button>
      </header>

      <main className="flex-1 overflow-y-auto" style={{ padding: '24px 32px' }}>
        <section style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginBottom: 8 }}>
            Topic keys referenced by rendered InfoIcons this session:{' '}
            <strong data-testid="wiki-coverage-ref-count" style={{ color: 'var(--text-primary)' }}>{refs.length}</strong>
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginBottom: 8 }}>
            Topic keys declared in registry:{' '}
            <strong data-testid="wiki-coverage-registry-count" style={{ color: 'var(--text-primary)' }}>{registry.length}</strong>
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>
            Unresolved references (referenced but not declared):{' '}
            <strong
              data-testid="wiki-coverage-unresolved-count"
              style={{ color: unresolved.length === 0 ? 'var(--success, #2a7)' : 'var(--destructive)' }}
            >
              {unresolved.length}
            </strong>
          </div>
        </section>

        <Section title="Unresolved references" testId="wiki-coverage-unresolved" keys={unresolved} severity="error" emptyMessage="No unresolved references. Coverage is clean." />
        <Section title="Declared but unused" testId="wiki-coverage-unused" keys={declaredButUnused} severity="muted" emptyMessage="Every declared topic has at least one reference." />
        <Section title="All live references" testId="wiki-coverage-live" keys={refs} severity="muted" emptyMessage="No InfoIcons rendered this session. Navigate through the app and come back." />
      </main>
    </div>
  );
}

function Section({
  title,
  testId,
  keys,
  severity,
  emptyMessage,
}: {
  title: string;
  testId: string;
  keys: string[];
  severity: 'error' | 'muted';
  emptyMessage: string;
}) {
  return (
    <section style={{ marginBottom: 24 }}>
      <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 10, letterSpacing: '-0.12px' }}>
        {title}{keys.length > 0 ? ` (${keys.length})` : ''}
      </h2>
      {keys.length === 0 ? (
        <div data-testid={`${testId}-empty`} style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>
          {emptyMessage}
        </div>
      ) : (
        <ul data-testid={testId} style={{ margin: 0, padding: 0, listStyle: 'none', fontFamily: "'Geist Mono', monospace", fontSize: 12 }}>
          {keys.map((k) => (
            <li
              key={k}
              data-topic={k}
              style={{
                padding: '4px 0',
                color: severity === 'error' ? 'var(--destructive)' : 'var(--text-secondary)',
              }}
            >
              {k}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
