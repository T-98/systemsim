import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../../store';

const MAX_INTENT_CHARS = 800;

export default function IntentHeader() {
  const intent = useStore((s) => s.intent);
  const setIntent = useStore((s) => s.setIntent);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(intent ?? '');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!editing) setDraft(intent ?? '');
  }, [intent, editing]);

  useEffect(() => {
    if (!editing) return;
    const ta = textareaRef.current;
    if (!ta) return;
    ta.focus();
    ta.selectionStart = ta.value.length;
    ta.selectionEnd = ta.value.length;
    // Auto-size to content
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 180)}px`;
  }, [editing]);

  const startEdit = useCallback(() => {
    setDraft(intent ?? '');
    setEditing(true);
  }, [intent]);

  const commit = useCallback(() => {
    const trimmed = draft.trim();
    setIntent(trimmed || null);
    setEditing(false);
  }, [draft, setIntent]);

  const cancel = useCallback(() => {
    setDraft(intent ?? '');
    setEditing(false);
  }, [intent]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
        return;
      }
      const isMac = typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac');
      const submitModifier = isMac ? e.metaKey : e.ctrlKey;
      if (e.key === 'Enter' && (submitModifier || !e.shiftKey)) {
        e.preventDefault();
        commit();
      }
    },
    [cancel, commit]
  );

  const autoResize = useCallback((e: React.FormEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 180)}px`;
  }, []);

  const hasIntent = !!(intent && intent.trim().length > 0);

  if (editing) {
    return (
      <div
        className="w-full"
        style={{
          background: 'var(--bg-card)',
          borderBottom: '1px solid var(--border-color)',
          padding: '10px 16px',
        }}
      >
        <div className="flex items-start gap-3 max-w-5xl mx-auto">
          <span
            style={{
              fontSize: 12,
              color: 'var(--text-tertiary)',
              letterSpacing: '-0.12px',
              paddingTop: 6,
              flexShrink: 0,
              fontWeight: 500,
            }}
          >
            Building
          </span>
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onInput={autoResize}
            onKeyDown={handleKeyDown}
            onBlur={commit}
            placeholder="Describe what you're building."
            maxLength={MAX_INTENT_CHARS}
            aria-label="Edit intent"
            rows={1}
            style={{
              flex: 1,
              fontSize: 13,
              lineHeight: 1.5,
              letterSpacing: '-0.224px',
              padding: '4px 8px',
              border: '1px solid var(--accent)',
              borderRadius: 6,
              background: 'var(--bg-tertiary)',
              color: 'var(--text-primary)',
              resize: 'none',
              outline: 'none',
              fontFamily: 'inherit',
              boxShadow: '0 0 0 2px var(--accent-ring)',
            }}
          />
          <span
            style={{
              fontSize: 11,
              color: 'var(--text-tertiary)',
              letterSpacing: '-0.12px',
              paddingTop: 8,
              flexShrink: 0,
            }}
          >
            Enter to save · Esc to cancel
          </span>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={startEdit}
      aria-label={hasIntent ? `Edit intent: ${intent}` : 'Add intent'}
      className="w-full text-left transition-colors"
      style={{
        background: 'var(--bg-card)',
        borderBottom: '1px solid var(--border-color)',
        padding: '10px 16px',
        cursor: 'text',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--bg-hover)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'var(--bg-card)';
      }}
    >
      <div className="flex items-center gap-3 max-w-5xl mx-auto">
        <span
          style={{
            fontSize: 12,
            color: 'var(--text-tertiary)',
            letterSpacing: '-0.12px',
            flexShrink: 0,
            fontWeight: 500,
          }}
        >
          Building
        </span>
        <span
          className="truncate"
          style={{
            fontSize: 13,
            color: hasIntent ? 'var(--text-primary)' : 'var(--text-tertiary)',
            letterSpacing: '-0.224px',
            flex: 1,
            fontStyle: hasIntent ? 'normal' : 'italic',
          }}
        >
          {hasIntent ? intent : 'Add a one-line vision. Click to edit.'}
        </span>
        <span
          aria-hidden="true"
          style={{
            fontSize: 11,
            color: 'var(--text-tertiary)',
            letterSpacing: '-0.12px',
            opacity: 0.6,
            flexShrink: 0,
          }}
        >
          Edit
        </span>
      </div>
    </button>
  );
}
