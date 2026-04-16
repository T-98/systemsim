/**
 * @file components/ui/RemixInput.tsx
 *
 * Inline remix input that posts the current canvas + new prompt to
 * /api/generate-diagram with `mode: 'remix'`. The backend uses the current
 * graph as context so "change X" works. Destructive; confirmed via
 * ConfirmModal, undoable via UndoToast.
 */

import { useState, useRef, useEffect } from 'react';
import { useStore } from '../../store';
import { generateDiagram, type GenerateResult } from '../../ai/generateDiagram';

interface RemixInputProps {
  onClose: () => void;
  onSuccess: () => void;
}

export default function RemixInput({ onClose, onSuccess }: RemixInputProps) {
  const [text, setText] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const requestId = useRef(0);
  const replaceGraph = useStore((s) => s.replaceGraph);
  const nodes = useStore((s) => s.nodes);
  const edges = useStore((s) => s.edges);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const canApply = text.trim().length >= 5 && !generating;

  const handleApply = async () => {
    if (!canApply) return;

    const thisRequest = ++requestId.current;
    setGenerating(true);
    setError(null);

    const controller = new AbortController();
    abortRef.current = controller;

    const currentGraph = {
      nodes: nodes.map((n) => ({ type: n.data.type, label: n.data.label })),
      edges: edges.map((e) => ({ source: e.source, target: e.target })),
    };

    const result: GenerateResult = await generateDiagram({
      text: text.trim(),
      mode: 'remix',
      currentGraph,
      signal: controller.signal,
    });

    if (requestId.current !== thisRequest) return;

    abortRef.current = null;

    if (result.ok) {
      replaceGraph(result.graph, { layout: 'auto' });
      onSuccess();
      onClose();
    } else if (result.kind !== 'aborted') {
      setError(result.message);
    }

    setGenerating(false);
  };

  const handleCancel = () => {
    if (generating) {
      requestId.current++;
      abortRef.current?.abort();
      abortRef.current = null;
      setGenerating(false);
    }
    onClose();
  };

  return (
    <div
      className="flex items-center gap-3 px-5 transition-all duration-200"
      style={{
        height: '48px',
        background: 'var(--bg-card)',
        borderBottom: '1px solid var(--border-color)',
      }}
    >
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Add a read replica to the database..."
        autoFocus
        readOnly={generating}
        className="flex-1 rounded-lg transition-colors"
        style={{
          background: 'var(--bg-primary)',
          color: 'var(--text-primary)',
          fontSize: '13px',
          letterSpacing: '-0.224px',
          padding: '6px 12px',
          height: '32px',
          border: '1px solid var(--border-color)',
          outline: 'none',
        }}
        onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
        onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border-color)'; }}
        onKeyDown={(e) => { if (e.key === 'Enter' && canApply) handleApply(); if (e.key === 'Escape') handleCancel(); }}
      />

      {!generating ? (
        <button
          onClick={handleApply}
          disabled={!canApply}
          className="rounded-lg font-medium disabled:opacity-30 transition-all shrink-0"
          style={{
            padding: '6px 14px',
            fontSize: '12px',
            letterSpacing: '-0.12px',
            background: 'var(--accent)',
            color: 'var(--text-on-accent)',
          }}
        >
          Apply
        </button>
      ) : (
        <span className="flex items-center gap-2 shrink-0" style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
          <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
          Remixing...
        </span>
      )}

      <button
        onClick={handleCancel}
        className="transition-colors shrink-0"
        style={{ fontSize: '12px', color: 'var(--text-tertiary)', letterSpacing: '-0.12px' }}
        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-tertiary)'; }}
      >
        Cancel
      </button>

      {error && (
        <span style={{ fontSize: '12px', color: '#ff453a', letterSpacing: '-0.12px' }}>
          {error}
        </span>
      )}
    </div>
  );
}
