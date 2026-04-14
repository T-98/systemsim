import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStore } from '../../store';
import { aggregateConfidence } from '../../ai/describeIntentSchema';
import { describeIntent } from '../../ai/describeIntent';
import { parseConnections, buildCanonicalGraph } from '../../ai/parseConnections';
import ConfidencePanel from './ConfidencePanel';

const COMPONENT_TYPE_LABELS: Record<string, string> = {
  load_balancer: 'load balancer',
  server: 'server',
  database: 'database',
  cache: 'cache',
  queue: 'queue',
  fanout: 'fanout',
};

export default function ReviewMode() {
  const reviewState = useStore((s) => s.reviewState);
  const setReviewState = useStore((s) => s.setReviewState);
  const setAppView = useStore((s) => s.setAppView);
  const replaceGraph = useStore((s) => s.replaceGraph);
  const persistIntent = useStore((s) => s.setIntent);

  const [intent, setIntent] = useState(reviewState?.data.intent ?? '');
  const [connections, setConnections] = useState(reviewState?.data.connections ?? '');
  const [rederiving, setRederiving] = useState(false);
  const [rederiveError, setRederiveError] = useState<string | null>(null);

  const source = useMemo(() => {
    if (!reviewState) return null;
    if (reviewState.sourceInput.image) {
      return { kind: 'image' as const, filename: reviewState.sourceInput.image.filename };
    }
    if (reviewState.sourceInput.text) {
      return { kind: 'text' as const, preview: reviewState.sourceInput.text.trim() };
    }
    return null;
  }, [reviewState]);

  const confidence = useMemo(
    () => (reviewState ? aggregateConfidence(reviewState.data) : 'high'),
    [reviewState]
  );

  const parseResult = useMemo(() => {
    if (!reviewState) return null;
    return parseConnections(connections, reviewState.data.components);
  }, [connections, reviewState]);

  const hasBlockingErrors = !!parseResult?.errors.some(
    (e) => e.reason !== 'self_loop'
  );
  const canGenerate =
    !!reviewState &&
    !!parseResult &&
    parseResult.edges.length > 0 &&
    !hasBlockingErrors;

  const handleBack = useCallback(() => {
    setAppView('landing');
  }, [setAppView]);

  const handleGenerate = useCallback(() => {
    if (!canGenerate || !reviewState || !parseResult) return;
    const graph = buildCanonicalGraph(reviewState.data.components, parseResult.edges);
    replaceGraph(graph, { layout: 'auto' });
    persistIntent(intent.trim() || null);
    setReviewState(null);
    setAppView('canvas');
  }, [canGenerate, reviewState, parseResult, replaceGraph, persistIntent, intent, setReviewState, setAppView]);

  const handleRederive = useCallback(async () => {
    const trimmed = intent.trim();
    if (trimmed.length < 15 || !reviewState) return;
    setRederiving(true);
    setRederiveError(null);
    const result = await describeIntent({ text: trimmed });
    setRederiving(false);
    if (result.ok) {
      setReviewState({
        data: result.data,
        sourceInput: { text: trimmed },
      });
      setIntent(result.data.intent);
      setConnections(result.data.connections);
    } else if (result.kind !== 'aborted') {
      setRederiveError(
        result.kind === 'rate_limit'
          ? 'Rate limited. Wait a moment and try again.'
          : result.kind === 'network'
            ? "Can't reach the service. Check your connection."
            : result.kind === 'validation'
              ? result.message
              : "Couldn't re-derive. Try editing the intent further and try again."
      );
    }
  }, [intent, reviewState, setReviewState]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleBack();
        return;
      }
      const isMac = typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac');
      const submitModifier = isMac ? e.metaKey : e.ctrlKey;
      if (submitModifier && e.key === 'Enter' && canGenerate) {
        e.preventDefault();
        handleGenerate();
      }
    },
    [canGenerate, handleBack, handleGenerate]
  );

  useEffect(() => {
    if (!reviewState) return;
    setIntent(reviewState.data.intent);
    setConnections(reviewState.data.connections);
  }, [reviewState]);

  if (!reviewState) {
    return (
      <div
        className="flex items-center justify-center w-screen h-screen"
        style={{ background: 'var(--bg-secondary)' }}
      >
        <p style={{ color: 'var(--text-tertiary)', fontSize: 14 }}>Loading review…</p>
      </div>
    );
  }

  return (
    <div
      className="w-screen h-screen overflow-y-auto"
      style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
    >
      <div
        className="sticky top-0 z-10 flex items-center justify-between"
        style={{
          background: 'var(--bg-nav)',
          borderBottom: '1px solid var(--border-color)',
          padding: '12px 24px',
          backdropFilter: 'saturate(180%) blur(20px)',
          WebkitBackdropFilter: 'saturate(180%) blur(20px)',
        }}
      >
        <button
          type="button"
          onClick={handleBack}
          className="transition-colors"
          style={{
            color: 'var(--accent-link)',
            fontSize: 14,
            letterSpacing: '-0.224px',
            background: 'transparent',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.textDecoration = 'underline';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.textDecoration = 'none';
          }}
        >
          ← Back
        </button>
        <span
          style={{
            fontSize: 15,
            fontWeight: 600,
            letterSpacing: '-0.32px',
            color: 'var(--text-primary)',
          }}
        >
          SystemSim
        </span>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={!canGenerate}
          title={
            !canGenerate
              ? hasBlockingErrors
                ? 'Fix connection errors before generating'
                : 'Add at least one connection to generate'
              : undefined
          }
          className="rounded-lg font-medium transition-all"
          style={{
            padding: '8px 16px',
            fontSize: 14,
            letterSpacing: '-0.224px',
            background: canGenerate ? 'var(--accent)' : 'var(--bg-card)',
            color: canGenerate ? 'var(--text-on-accent)' : 'var(--text-tertiary)',
            border: canGenerate ? 'none' : '1px solid var(--border-color)',
            cursor: canGenerate ? 'pointer' : 'not-allowed',
          }}
        >
          Generate diagram
        </button>
      </div>

      <main
        className="mx-auto"
        style={{
          maxWidth: 720,
          padding: '48px 24px 64px',
        }}
      >
        {source && (
          <div
            className="inline-flex items-center gap-2 rounded"
            style={{
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-color)',
              padding: '5px 10px',
              marginBottom: 24,
              maxWidth: '100%',
            }}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ color: 'var(--text-tertiary)', flexShrink: 0 }}
              aria-hidden="true"
            >
              {source.kind === 'image' ? (
                <>
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <polyline points="21 15 16 10 5 21" />
                </>
              ) : (
                <>
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="9" y1="13" x2="15" y2="13" />
                  <line x1="9" y1="17" x2="13" y2="17" />
                </>
              )}
            </svg>
            <span
              style={{
                fontSize: 12,
                color: 'var(--text-tertiary)',
                letterSpacing: '-0.12px',
                textTransform: 'uppercase',
                fontWeight: 500,
              }}
            >
              from
            </span>
            <span
              className="truncate"
              style={{
                fontSize: 13,
                color: 'var(--text-secondary)',
                letterSpacing: '-0.224px',
                fontFamily: source.kind === 'image' ? 'SF Mono, Menlo, monospace' : 'inherit',
                maxWidth: 480,
              }}
              title={source.kind === 'image' ? source.filename : source.preview}
            >
              {source.kind === 'image'
                ? source.filename
                : source.preview.length > 80
                  ? source.preview.slice(0, 80) + '…'
                  : source.preview || 'your description'}
            </span>
          </div>
        )}

        <section>
          <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
            <h2
              style={{
                fontSize: 24,
                fontWeight: 600,
                letterSpacing: '-0.5px',
                color: 'var(--text-primary)',
              }}
            >
              What you are building
            </h2>
            <button
              type="button"
              onClick={handleRederive}
              disabled={rederiving || intent.trim().length < 15 || !reviewState}
              title={
                rederiving
                  ? 'Re-reading your intent'
                  : intent.trim().length < 15
                    ? 'Add more detail before re-deriving'
                    : 'Re-derive components and connections from this intent'
              }
              className="transition-colors disabled:opacity-40"
              style={{
                fontSize: 13,
                letterSpacing: '-0.224px',
                color: 'var(--accent-link)',
                background: 'transparent',
                padding: '4px 8px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
              onMouseEnter={(e) => {
                if (!rederiving && intent.trim().length >= 15) {
                  e.currentTarget.style.textDecoration = 'underline';
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.textDecoration = 'none';
              }}
            >
              {rederiving && (
                <span
                  className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin"
                  aria-hidden="true"
                />
              )}
              {rederiving ? 'Re-reading…' : 'Re-derive from intent'}
            </button>
          </div>
          {rederiveError && (
            <div
              role="alert"
              className="mb-3 rounded-lg"
              style={{
                background: 'rgba(255,69,58,0.08)',
                border: '1px solid rgba(255,69,58,0.2)',
                padding: '10px 12px',
                fontSize: 13,
                color: '#ff453a',
                letterSpacing: '-0.224px',
              }}
            >
              {rederiveError}
            </div>
          )}
          <textarea
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            onKeyDown={handleKeyDown}
            aria-label="What you are building"
            placeholder="Describe what you're building."
            rows={4}
            style={{
              width: '100%',
              fontSize: 14,
              lineHeight: 1.5,
              letterSpacing: '-0.224px',
              padding: '14px 16px',
              borderRadius: 8,
              border: '1px solid var(--border-color)',
              background: 'var(--bg-tertiary)',
              color: 'var(--text-primary)',
              resize: 'vertical',
              outline: 'none',
              fontFamily: 'inherit',
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = 'var(--accent)';
              e.currentTarget.style.boxShadow = '0 0 0 2px var(--accent-ring)';
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = 'var(--border-color)';
              e.currentTarget.style.boxShadow = 'none';
            }}
          />
        </section>

        <section style={{ marginTop: 32 }}>
          <h2
            style={{
              fontSize: 24,
              fontWeight: 600,
              letterSpacing: '-0.5px',
              color: 'var(--text-primary)',
              marginBottom: 10,
            }}
          >
            Components detected
          </h2>
          <p
            style={{
              fontSize: 13,
              color: 'var(--text-tertiary)',
              letterSpacing: '-0.224px',
              marginBottom: 12,
            }}
          >
            {reviewState.data.components.length} component{reviewState.data.components.length === 1 ? '' : 's'} read from your {reviewState.sourceInput.image ? 'diagram' : 'description'}.
          </p>
          <div className="flex flex-wrap gap-2">
            {reviewState.data.components.map((c, i) => {
              const unused = parseResult?.unusedComponents.some(
                (u) => u.label === c.label && u.type === c.type
              );
              return (
                <div
                  key={`${c.type}-${i}`}
                  className="inline-flex items-baseline gap-1.5 rounded"
                  title={unused ? 'Not referenced in any connection below' : undefined}
                  style={{
                    background: 'var(--bg-tertiary)',
                    border: `1px solid ${unused ? 'rgba(255,159,10,0.35)' : 'var(--border-color)'}`,
                    padding: '6px 10px',
                    borderRadius: 6,
                  }}
                >
                  <span
                    style={{
                      fontSize: 13,
                      color: 'var(--text-primary)',
                      letterSpacing: '-0.224px',
                      fontWeight: 500,
                    }}
                  >
                    {c.label}
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      color: 'var(--text-tertiary)',
                      letterSpacing: '-0.12px',
                    }}
                  >
                    {COMPONENT_TYPE_LABELS[c.type] ?? c.type}
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        <section style={{ marginTop: 32 }}>
          <h2
            style={{
              fontSize: 24,
              fontWeight: 600,
              letterSpacing: '-0.5px',
              color: 'var(--text-primary)',
              marginBottom: 6,
            }}
          >
            Connections
          </h2>
          <p
            style={{
              fontSize: 13,
              color: 'var(--text-tertiary)',
              letterSpacing: '-0.224px',
              marginBottom: 10,
            }}
          >
            One per line. Format:{' '}
            <code style={{ fontSize: 12, fontFamily: 'SF Mono, Menlo, monospace', color: 'var(--text-secondary)' }}>
              source --&gt; target
            </code>{' '}
            or{' '}
            <code style={{ fontSize: 12, fontFamily: 'SF Mono, Menlo, monospace', color: 'var(--text-secondary)' }}>
              source --label--&gt; target
            </code>
            . Fix any wrong arrows before generating.
          </p>
          <textarea
            value={connections}
            onChange={(e) => setConnections(e.target.value)}
            onKeyDown={handleKeyDown}
            aria-label="Connections"
            placeholder="user uploads video --> raw video
raw video --extracted audio--> STT"
            rows={12}
            spellCheck={false}
            style={{
              width: '100%',
              fontSize: 13,
              lineHeight: 1.65,
              letterSpacing: '-0.12px',
              padding: '14px 16px',
              borderRadius: 8,
              border: '1px solid var(--border-color)',
              background: 'var(--bg-tertiary)',
              color: 'var(--text-primary)',
              resize: 'vertical',
              outline: 'none',
              fontFamily: 'SF Mono, Menlo, Consolas, monospace',
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = 'var(--accent)';
              e.currentTarget.style.boxShadow = '0 0 0 2px var(--accent-ring)';
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = 'var(--border-color)';
              e.currentTarget.style.boxShadow = 'none';
            }}
          />
          <div
            aria-live="polite"
            style={{
              fontSize: 12,
              color: 'var(--text-tertiary)',
              letterSpacing: '-0.12px',
              marginTop: 8,
            }}
          >
            {parseResult && (
              <>
                {parseResult.edges.length} connection{parseResult.edges.length === 1 ? '' : 's'} ready
                {parseResult.unusedComponents.length > 0 && (
                  <>
                    {' · '}
                    {parseResult.unusedComponents.length} component
                    {parseResult.unusedComponents.length === 1 ? '' : 's'} unreferenced
                  </>
                )}
              </>
            )}
          </div>

          {parseResult && parseResult.errors.length > 0 && (
            <div
              role="alert"
              className="mt-3 rounded-lg"
              style={{
                background: 'rgba(255,69,58,0.08)',
                border: '1px solid rgba(255,69,58,0.2)',
                padding: '12px 14px',
              }}
            >
              <p
                style={{
                  fontSize: 13,
                  color: '#ff453a',
                  letterSpacing: '-0.224px',
                  fontWeight: 500,
                  marginBottom: 6,
                }}
              >
                {parseResult.errors.length} connection{parseResult.errors.length === 1 ? ' needs' : 's need'} fixing
              </p>
              <ul style={{ fontSize: 12, color: 'var(--text-secondary)', letterSpacing: '-0.12px', lineHeight: 1.55 }}>
                {parseResult.errors.slice(0, 6).map((err, i) => (
                  <li key={i}>
                    <strong>Line {err.lineNumber}:</strong> {err.hint ?? err.reason}
                    {err.line && (
                      <>
                        {' — '}
                        <code
                          style={{
                            fontFamily: 'SF Mono, Menlo, monospace',
                            fontSize: 11,
                            color: 'var(--text-tertiary)',
                          }}
                        >
                          {err.line}
                        </code>
                      </>
                    )}
                  </li>
                ))}
                {parseResult.errors.length > 6 && (
                  <li>…and {parseResult.errors.length - 6} more.</li>
                )}
              </ul>
            </div>
          )}
        </section>

        <ConfidencePanel
          intentConfidence={reviewState.data.confidence.intent}
          items={reviewState.data.confidence.items}
        />

        {confidence === 'low' && (
          <div
            className="mt-4 rounded-lg"
            role="alert"
            style={{
              background: 'rgba(255,159,10,0.08)',
              border: '1px solid rgba(255,159,10,0.2)',
              padding: '12px 14px',
              display: 'flex',
              gap: 10,
              alignItems: 'flex-start',
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 2 }}
            >
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', letterSpacing: '-0.224px', lineHeight: 1.5 }}>
              Some parts of your diagram were unclear. Review carefully before generating.
            </p>
          </div>
        )}

        <p
          style={{
            fontSize: 13,
            color: 'var(--text-tertiary)',
            letterSpacing: '-0.224px',
            marginTop: 16,
          }}
        >
          Make any final changes before generating the diagram. {navigatorIsMac() ? 'Cmd' : 'Ctrl'}+Enter to generate.
        </p>
      </main>
    </div>
  );
}

function navigatorIsMac(): boolean {
  if (typeof navigator === 'undefined') return true;
  return navigator.platform.toLowerCase().includes('mac');
}
