import { useState, useRef, useCallback } from 'react';
import { useStore } from '../../store';
import { generateDiagram, type GenerateResult } from '../../ai/generateDiagram';

const PROGRESS_MESSAGES = [
  'Reading your description...',
  'Identifying components...',
  'Wiring connections...',
  'Laying out your system...',
];

export default function TextToDiagram() {
  const [text, setText] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<{ message: string; kind: string } | null>(null);
  const [progressIdx, setProgressIdx] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const replaceGraph = useStore((s) => s.replaceGraph);
  const setAppMode = useStore((s) => s.setAppMode);
  const setAppView = useStore((s) => s.setAppView);
  const setScenarioId = useStore((s) => s.setScenarioId);

  const charCount = text.length;
  const showCharWarning = charCount > 10000;
  const canGenerate = text.trim().length >= 10 && !generating;

  const startProgressRotation = useCallback(() => {
    setProgressIdx(0);
    progressTimer.current = setInterval(() => {
      setProgressIdx((prev) => (prev + 1) % PROGRESS_MESSAGES.length);
    }, 1500);
  }, []);

  const stopProgressRotation = useCallback(() => {
    if (progressTimer.current) {
      clearInterval(progressTimer.current);
      progressTimer.current = null;
    }
  }, []);

  const requestId = useRef(0);

  const handleGenerate = async () => {
    if (!canGenerate) return;

    const thisRequest = ++requestId.current;
    setGenerating(true);
    setError(null);
    startProgressRotation();

    const controller = new AbortController();
    abortRef.current = controller;

    const result: GenerateResult = await generateDiagram({
      text: text.trim(),
      signal: controller.signal,
    });

    // Stale request guard: if another request started or cancel was pressed, drop this result
    if (requestId.current !== thisRequest) return;

    stopProgressRotation();
    abortRef.current = null;

    if (result.ok) {
      replaceGraph(result.graph, { layout: 'auto' });
      setAppMode('freeform');
      setScenarioId(null);
      setAppView('canvas');
    } else if (result.kind !== 'aborted') {
      setError({ message: result.message, kind: result.kind });
    }

    setGenerating(false);
  };

  const handleCancel = () => {
    requestId.current++;
    abortRef.current?.abort();
    abortRef.current = null;
    stopProgressRotation();
    setGenerating(false);
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <label
          htmlFor="system-description"
          className="font-semibold"
          style={{ fontSize: '14px', color: 'var(--text-primary)', letterSpacing: '-0.224px' }}
        >
          Describe your system
        </label>
      </div>

      <div className="relative">
        <textarea
          id="system-description"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="An API server behind a load balancer, connected to a Postgres database and Redis cache..."
          maxLength={30000}
          rows={5}
          readOnly={generating}
          aria-label="System description"
          className="w-full rounded-lg resize-none transition-colors"
          style={{
            background: 'var(--bg-card)',
            color: 'var(--text-primary)',
            fontSize: '14px',
            letterSpacing: '-0.224px',
            padding: '12px 16px',
            border: '1px solid var(--border-color)',
            outline: 'none',
            opacity: generating ? 0.6 : 1,
          }}
          onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.boxShadow = '0 0 0 2px rgba(0,113,227,0.2)'; }}
          onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border-color)'; e.currentTarget.style.boxShadow = 'none'; }}
        />
        {charCount > 5000 && (
          <span
            className="absolute bottom-2 right-3"
            style={{ fontSize: '11px', color: 'var(--text-tertiary)', letterSpacing: '-0.12px' }}
          >
            {charCount.toLocaleString()} / 30,000
          </span>
        )}
      </div>

      {showCharWarning && (
        <p style={{ fontSize: '12px', color: 'var(--warning)', letterSpacing: '-0.12px', marginTop: '4px' }}>
          Long document. The AI will focus on the core architecture.
        </p>
      )}

      <div className="flex items-center gap-3 mt-3">
        {!generating ? (
          <button
            onClick={handleGenerate}
            disabled={!canGenerate}
            className="rounded-lg font-medium disabled:opacity-30 transition-all"
            style={{
              padding: '8px 20px',
              fontSize: '14px',
              letterSpacing: '-0.224px',
              background: 'var(--accent)',
              color: 'var(--text-on-accent)',
            }}
          >
            Generate
          </button>
        ) : (
          <button
            onClick={handleCancel}
            className="rounded-lg font-medium transition-all"
            style={{
              padding: '8px 20px',
              fontSize: '14px',
              letterSpacing: '-0.224px',
              background: 'var(--bg-card)',
              color: 'var(--text-tertiary)',
              border: '1px solid var(--border-color)',
            }}
          >
            Cancel
          </button>
        )}

        {generating && (
          <span
            className="flex items-center gap-2"
            style={{ fontSize: '13px', color: 'var(--text-tertiary)', letterSpacing: '-0.224px' }}
            aria-live="polite"
          >
            <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
            {PROGRESS_MESSAGES[progressIdx]}
          </span>
        )}
      </div>

      {error && (
        <div
          className="mt-3 rounded-lg p-3"
          style={{ background: 'rgba(255,69,58,0.08)', border: '1px solid rgba(255,69,58,0.2)' }}
          role="alert"
        >
          <p style={{ fontSize: '13px', color: '#ff453a', letterSpacing: '-0.224px' }}>
            {error.message}
          </p>
          {error.kind === 'validation' && (
            <button
              onClick={() => setError(null)}
              className="mt-1 transition-colors"
              style={{ fontSize: '12px', color: 'var(--accent-link)', letterSpacing: '-0.12px' }}
              onMouseEnter={(e) => { e.currentTarget.style.textDecoration = 'underline'; }}
              onMouseLeave={(e) => { e.currentTarget.style.textDecoration = 'none'; }}
            >
              Try a template instead
            </button>
          )}
        </div>
      )}

      <p
        className="mt-2"
        style={{ fontSize: '12px', color: 'var(--text-tertiary)', letterSpacing: '-0.12px', opacity: 0.7 }}
      >
        Your description is sent to Anthropic's AI service. Don't include passwords, API keys, or confidential info.
      </p>
    </div>
  );
}
