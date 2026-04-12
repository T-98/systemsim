import { useEffect, useRef } from 'react';

interface ConfirmModalProps {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmModal({ title, body, confirmLabel, onConfirm, onCancel }: ConfirmModalProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)' }}
      onClick={onCancel}
    >
      <div
        className="rounded-lg"
        style={{ background: 'var(--bg-card)', maxWidth: '400px', width: '90%', padding: '24px' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <h3
          className="font-semibold mb-2"
          style={{ fontSize: '17px', color: 'var(--text-primary)', letterSpacing: '-0.374px' }}
        >
          {title}
        </h3>
        <p
          className="mb-6"
          style={{ fontSize: '14px', color: 'var(--text-tertiary)', letterSpacing: '-0.224px', lineHeight: 1.5 }}
        >
          {body}
        </p>
        <div className="flex justify-end gap-3">
          <button
            ref={cancelRef}
            onClick={onCancel}
            className="rounded-lg font-medium transition-all"
            style={{
              padding: '8px 16px',
              fontSize: '14px',
              letterSpacing: '-0.224px',
              background: 'var(--bg-hover)',
              color: 'var(--text-primary)',
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="rounded-lg font-medium transition-all"
            style={{
              padding: '8px 16px',
              fontSize: '14px',
              letterSpacing: '-0.224px',
              background: 'var(--accent)',
              color: 'var(--text-on-accent)',
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
