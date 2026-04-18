/**
 * @file components/panels/liveLog/LogGroupedRow.tsx
 *
 * Renders a single log row OR a collapsed group row (with chevron to
 * expand). Shared message-rendering path `renderMessageSegments` turns
 * detected callout phrases into hoverable info-icon triggers so the user
 * can click "Learn more →" to deep-link the wiki on that topic.
 *
 * Click-to-pulse: clicking a row with a `componentId` sets `pulseTarget`
 * to that node for 600ms so the canvas flashes the node outline. Mirrors
 * the preflight-routing pattern in PreflightBanner.tsx.
 */

import { Fragment } from 'react';
import type { LogEntry } from '../../../types';
import type { GroupedRow } from './groupLogs';
import { segmentMessage } from './calloutPhrases';
import InfoIcon from '../../ui/InfoIcon';
import { formatTime } from './formatTime';

const SEVERITY_STYLE: Record<LogEntry['severity'], React.CSSProperties> = {
  info: { color: 'var(--text-tertiary)' },
  warning: { color: 'var(--warning)' },
  critical: { color: 'var(--destructive)' },
};

const SEVERITY_TOPIC: Record<LogEntry['severity'], string> = {
  info: 'severity.info',
  warning: 'severity.warning',
  critical: 'severity.critical',
};

export default function LogGroupedRow({
  row,
  expanded,
  onToggleExpand,
  onRowClick,
}: {
  row: GroupedRow;
  expanded: boolean;
  onToggleExpand: (id: string) => void;
  onRowClick: (componentId: string | undefined) => void;
}) {
  if (row.kind === 'single') {
    return <SingleRow entry={row.entry} onClick={() => onRowClick(row.entry.componentId)} />;
  }

  const first = row.entries[0];
  const countLabel = `${row.entries.length}× ${row.componentId} ${pluralize(row.severity, row.entries.length)}`;

  return (
    <div data-testid="log-group" data-group-id={row.id} data-expanded={expanded ? 'true' : 'false'}>
      <div
        data-testid="log-group-header"
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-label={`${expanded ? 'Collapse' : 'Expand'} ${countLabel}`}
        onClick={() => onToggleExpand(row.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggleExpand(row.id);
          }
        }}
        style={{
          ...SEVERITY_STYLE[row.severity],
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          cursor: 'pointer',
          padding: '1px 0',
        }}
      >
        <span data-testid="log-group-chevron" style={{ display: 'inline-block', width: 10, color: 'var(--text-tertiary)', transition: 'transform 150ms ease', transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>
          ▸
        </span>
        <span className="select-none" style={{ color: 'var(--text-tertiary)', opacity: 0.5 }}>
          [{formatTime(first.time)}]
        </span>
        <InfoIcon topic={SEVERITY_TOPIC[row.severity]} side="top" ariaLabel={`${row.severity} severity`} />
        <span>{countLabel}</span>
      </div>
      {expanded && (
        <div data-testid="log-group-entries" style={{ paddingLeft: 16 }}>
          {row.entries.map((entry, i) => (
            <SingleRow key={`${row.id}-${i}`} entry={entry} onClick={() => onRowClick(entry.componentId)} />
          ))}
        </div>
      )}
    </div>
  );
}

function SingleRow({ entry, onClick }: { entry: LogEntry; onClick: () => void }) {
  const hasComponent = !!entry.componentId;
  const segs = segmentMessage(entry.message);

  const handleClick = (e: React.MouseEvent) => {
    // If the click originated inside an info-icon trigger/popover, don't also fire the row click.
    const target = e.target as HTMLElement;
    if (target.closest('[data-testid="info-icon"]') || target.closest('[data-testid="info-popover"]')) return;
    onClick();
  };

  return (
    <div
      data-testid="log-row"
      data-component-id={entry.componentId ?? ''}
      role={hasComponent ? 'button' : undefined}
      tabIndex={hasComponent ? 0 : undefined}
      aria-label={hasComponent ? `Focus component ${entry.componentId}` : undefined}
      onClick={handleClick}
      onKeyDown={hasComponent ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          // Defer to the shared click handler. We synthesize a bare stub for
          // the stopPropagation check — Enter/Space has no DOM target we
          // care about relative to info-icon/popover.
          e.preventDefault();
          onClick();
        }
      } : undefined}
      style={{
        ...SEVERITY_STYLE[entry.severity],
        display: 'flex',
        alignItems: 'flex-start',
        gap: '6px',
        cursor: hasComponent ? 'pointer' : 'default',
        padding: '1px 0',
      }}
    >
      <span
        className="mr-1 select-none"
        data-testid="live-log-severity"
        data-severity={entry.severity}
        style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
      >
        <span style={{ color: 'var(--text-tertiary)', opacity: 0.5 }}>[{formatTime(entry.time)}]</span>
        <InfoIcon topic={SEVERITY_TOPIC[entry.severity]} side="top" ariaLabel={`${entry.severity} severity`} />
      </span>
      <span>
        {segs.map((seg, i) =>
          seg.kind === 'text' ? (
            <Fragment key={i}>{seg.text}</Fragment>
          ) : (
            <span
              key={i}
              data-testid="log-callout-phrase"
              data-topic={seg.topic}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
                textDecoration: 'underline',
                textDecorationStyle: 'dotted',
                textUnderlineOffset: '2px',
              }}
            >
              {seg.text}
              <InfoIcon topic={seg.topic ?? ''} side="top" ariaLabel={`About ${seg.text}`} />
            </span>
          )
        )}
      </span>
    </div>
  );
}

function pluralize(severity: LogEntry['severity'], count: number): string {
  const base = severity === 'critical' ? 'critical' : severity === 'warning' ? 'warning' : 'info';
  return count === 1 ? `${base}` : `${base}s`;
}
