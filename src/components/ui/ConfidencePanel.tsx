/**
 * @file components/ui/ConfidencePanel.tsx
 *
 * Collapsible panel in ReviewMode that shows per-dimension confidence
 * (overall / intent / components / connections) returned by the LLM. Used
 * as a signal: low confidence → encourage the user to edit before deriving.
 */

import { useState } from 'react';
import type { ConfidenceItem, ConfidenceLevel } from '../../ai/describeIntentSchema';

interface ConfidencePanelProps {
  intentConfidence: ConfidenceLevel;
  items: ConfidenceItem[];
}

const LEVEL_COLOR: Record<ConfidenceLevel, string> = {
  low: '#ff9f0a',
  med: '#a2845e',
  high: '#34c759',
};

const LEVEL_LABEL: Record<ConfidenceLevel, string> = {
  low: 'low',
  med: 'medium',
  high: 'high',
};

export default function ConfidencePanel({ intentConfidence, items }: ConfidencePanelProps) {
  const [open, setOpen] = useState(false);

  const lowCount = items.filter((i) => i.confidence === 'low').length;
  const medCount = items.filter((i) => i.confidence === 'med').length;
  const highCount = items.filter((i) => i.confidence === 'high').length;

  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      style={{
        marginTop: 16,
        border: '1px solid var(--border-color)',
        borderRadius: 8,
        background: 'var(--bg-tertiary)',
        overflow: 'hidden',
      }}
    >
      <summary
        style={{
          padding: '10px 14px',
          cursor: 'pointer',
          listStyle: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: 13,
          color: 'var(--text-secondary)',
          letterSpacing: '-0.224px',
          userSelect: 'none',
        }}
      >
        <span className="flex items-center gap-2">
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
              transition: 'transform 150ms',
              color: 'var(--text-tertiary)',
            }}
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
          <span style={{ fontWeight: 500 }}>What did we see?</span>
          <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
            intent: {LEVEL_LABEL[intentConfidence]}
            {items.length > 0 && (
              <>
                {' · '}
                {items.length} item{items.length === 1 ? '' : 's'} flagged
              </>
            )}
          </span>
        </span>
        <span
          style={{
            fontSize: 11,
            color: 'var(--text-tertiary)',
            letterSpacing: '-0.12px',
            display: 'flex',
            gap: 8,
          }}
        >
          {lowCount > 0 && (
            <span style={{ color: LEVEL_COLOR.low }}>● {lowCount} low</span>
          )}
          {medCount > 0 && (
            <span style={{ color: LEVEL_COLOR.med }}>● {medCount} med</span>
          )}
          {highCount > 0 && (
            <span style={{ color: LEVEL_COLOR.high }}>● {highCount} high</span>
          )}
        </span>
      </summary>

      <div
        style={{
          padding: '4px 14px 14px',
          borderTop: '1px solid var(--border-color)',
        }}
      >
        {items.length === 0 ? (
          <p
            style={{
              fontSize: 12,
              color: 'var(--text-tertiary)',
              letterSpacing: '-0.12px',
              padding: '10px 0',
            }}
          >
            The AI didn't flag any individual items. {intentConfidence === 'high' ? 'Intent is high-confidence.' : `Overall intent confidence is ${LEVEL_LABEL[intentConfidence]}.`}
          </p>
        ) : (
          <ul style={{ marginTop: 10 }}>
            {items.map((item, i) => (
              <li
                key={i}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'auto 1fr',
                  gap: 10,
                  alignItems: 'baseline',
                  padding: '6px 0',
                  borderBottom: i < items.length - 1 ? '1px solid var(--border-color)' : 'none',
                }}
              >
                <span
                  aria-label={`${LEVEL_LABEL[item.confidence]} confidence`}
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: '0.3px',
                    textTransform: 'uppercase',
                    color: LEVEL_COLOR[item.confidence],
                    minWidth: 40,
                  }}
                >
                  {LEVEL_LABEL[item.confidence]}
                </span>
                <span>
                  <span
                    style={{
                      fontSize: 13,
                      color: 'var(--text-primary)',
                      letterSpacing: '-0.224px',
                      fontWeight: 500,
                    }}
                  >
                    {item.name}
                  </span>
                  {item.reasoning && (
                    <span
                      style={{
                        display: 'block',
                        fontSize: 12,
                        color: 'var(--text-tertiary)',
                        letterSpacing: '-0.12px',
                        marginTop: 2,
                        lineHeight: 1.4,
                      }}
                    >
                      {item.reasoning}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
