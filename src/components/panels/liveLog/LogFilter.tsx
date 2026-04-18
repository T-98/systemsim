/**
 * @file components/panels/liveLog/LogFilter.tsx
 *
 * Filter row above the live log: severity chips (info / warning /
 * critical) + component dropdown + "N shown / M total" counter.
 * State is panel-local (the consumer owns it) — not in the Zustand store.
 *
 * Design:
 * - Severity is multi-select via chip toggles. Empty selection =
 *   show all (not "show none") — matches the Phase C plan.
 * - Component select is single-select with an "All components" option.
 * - Both dimensions AND together (severity AND componentId must match).
 */

import type { LogEntry } from '../../../types';

export interface LogFilterValue {
  severities: Set<LogEntry['severity']>;
  componentId: string | null;
}

export const EMPTY_FILTER: LogFilterValue = {
  severities: new Set(),
  componentId: null,
};

const SEVERITY_ORDER: LogEntry['severity'][] = ['info', 'warning', 'critical'];

const SEVERITY_STYLE: Record<LogEntry['severity'], string> = {
  info: 'var(--text-tertiary)',
  warning: 'var(--warning)',
  critical: 'var(--destructive)',
};

interface ComponentOption {
  id: string;
  label: string;
}

export default function LogFilter({
  value,
  onChange,
  components,
  shown,
  total,
}: {
  value: LogFilterValue;
  onChange: (next: LogFilterValue) => void;
  components: ComponentOption[];
  shown: number;
  total: number;
}) {
  const toggleSeverity = (sev: LogEntry['severity']) => {
    const next = new Set(value.severities);
    if (next.has(sev)) next.delete(sev);
    else next.add(sev);
    onChange({ ...value, severities: next });
  };

  const setComponent = (id: string) => {
    onChange({ ...value, componentId: id === '' ? null : id });
  };

  const reset = () => onChange(EMPTY_FILTER);
  const hasFilter = value.severities.size > 0 || value.componentId !== null;

  return (
    <div
      data-testid="log-filter"
      className="flex items-center gap-2"
      style={{
        padding: '6px 16px',
        borderBottom: '1px solid var(--border-color)',
        fontSize: 11,
        letterSpacing: '-0.12px',
      }}
    >
      <div className="flex items-center gap-1" data-testid="log-filter-severities">
        {SEVERITY_ORDER.map((sev) => {
          const active = value.severities.has(sev);
          return (
            <button
              key={sev}
              type="button"
              data-testid={`log-filter-severity-${sev}`}
              data-active={active ? 'true' : 'false'}
              onClick={() => toggleSeverity(sev)}
              style={{
                padding: '2px 8px',
                borderRadius: 10,
                background: active ? SEVERITY_STYLE[sev] : 'transparent',
                color: active ? 'var(--text-on-accent, white)' : SEVERITY_STYLE[sev],
                border: `1px solid ${SEVERITY_STYLE[sev]}`,
                cursor: 'pointer',
                fontSize: 11,
                textTransform: 'capitalize',
                lineHeight: 1.3,
              }}
            >
              {sev}
            </button>
          );
        })}
      </div>

      <select
        data-testid="log-filter-component"
        value={value.componentId ?? ''}
        onChange={(e) => setComponent(e.target.value)}
        style={{
          padding: '2px 6px',
          borderRadius: 4,
          background: 'var(--bg-input)',
          color: 'var(--text-secondary)',
          border: '1px solid var(--border-color)',
          fontSize: 11,
          letterSpacing: '-0.12px',
        }}
      >
        <option value="">All components</option>
        {components.map((c) => (
          <option key={c.id} value={c.id}>{c.label}</option>
        ))}
      </select>

      {hasFilter && (
        <button
          type="button"
          data-testid="log-filter-reset"
          onClick={reset}
          style={{
            padding: '2px 6px',
            background: 'transparent',
            color: 'var(--text-tertiary)',
            border: 'none',
            cursor: 'pointer',
            fontSize: 11,
            textDecoration: 'underline',
          }}
        >
          Reset
        </button>
      )}

      <span
        data-testid="log-filter-counter"
        className="ml-auto tabular-nums"
        style={{ color: 'var(--text-tertiary)', fontFamily: "'Geist Mono', monospace", fontSize: 11 }}
      >
        {shown} / {total} events
      </span>
    </div>
  );
}

/** Apply a filter to an array of log entries. Pure; used by consumers. */
export function applyLogFilter(entries: LogEntry[], filter: LogFilterValue): LogEntry[] {
  if (filter.severities.size === 0 && filter.componentId === null) return entries;
  return entries.filter((e) => {
    if (filter.severities.size > 0 && !filter.severities.has(e.severity)) return false;
    if (filter.componentId !== null && e.componentId !== filter.componentId) return false;
    return true;
  });
}
