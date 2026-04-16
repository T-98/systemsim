/**
 * @file components/ui/ImagePreviewChip.tsx
 *
 * Compact chip shown after an image is attached to UnifiedInput: thumbnail +
 * filename + remove button.
 */

interface ImagePreviewChipProps {
  filename: string;
  bytes: number;
  onRemove: () => void;
  disabled?: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ImagePreviewChip({ filename, bytes, onRemove, disabled = false }: ImagePreviewChipProps) {
  return (
    <div
      className="inline-flex items-center gap-2 rounded-lg"
      style={{
        background: 'var(--bg-card-elevated)',
        border: '1px solid var(--border-color)',
        padding: '6px 10px 6px 8px',
        maxWidth: 'fit-content',
      }}
    >
      <span
        aria-hidden="true"
        className="inline-flex items-center justify-center"
        style={{
          width: 24,
          height: 24,
          background: 'var(--bg-hover)',
          borderRadius: 4,
          flexShrink: 0,
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-tertiary)' }}>
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
      </span>
      <span
        className="truncate"
        style={{
          fontSize: 13,
          color: 'var(--text-secondary)',
          letterSpacing: '-0.224px',
          maxWidth: 260,
        }}
      >
        {filename}
      </span>
      <span
        style={{
          fontSize: 12,
          color: 'var(--text-tertiary)',
          letterSpacing: '-0.12px',
        }}
      >
        · {formatBytes(bytes)}
      </span>
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove image"
        disabled={disabled}
        className="inline-flex items-center justify-center rounded transition-colors disabled:opacity-30"
        style={{
          width: 20,
          height: 20,
          background: 'transparent',
          color: 'var(--text-tertiary)',
          marginLeft: 2,
        }}
        onMouseEnter={(e) => {
          if (!disabled) e.currentTarget.style.color = 'var(--text-primary)';
        }}
        onMouseLeave={(e) => {
          if (!disabled) e.currentTarget.style.color = 'var(--text-tertiary)';
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}
