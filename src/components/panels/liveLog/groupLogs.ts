/**
 * @file components/panels/liveLog/groupLogs.ts
 *
 * Pure grouping function for the live log. Given a sequence of LogEntry
 * items, collapse runs of same-componentId + same-severity events inside
 * a short time window into a single row.
 *
 * Grouping is visual only — the underlying `liveLog` array is never
 * mutated. Expand state is panel-local in the consumer.
 *
 * Rules (configurable via opts, defaults match the Phase C plan):
 *   - A group forms from N or more consecutive entries sharing
 *     componentId + severity within a `windowSeconds` window.
 *   - `componentId` must be present on both entries. Entries without
 *     a componentId never group (they're plain text events).
 *   - Gaps break the group: as soon as one entry doesn't match the
 *     current group's key or falls outside the window, a new grouping
 *     attempt starts at that entry.
 */

import type { LogEntry } from '../../../types';

export interface GroupOptions {
  /** Minimum run length to collapse into a group. Default: 5. */
  minRun?: number;
  /** Max time span (seconds) from the first to the last entry in a group. Default: 2. */
  windowSeconds?: number;
}

export type GroupedRow =
  | { kind: 'single'; id: string; entry: LogEntry; originalIndex: number }
  | { kind: 'group'; id: string; entries: LogEntry[]; componentId: string; severity: LogEntry['severity']; firstIndex: number; lastIndex: number };

const DEFAULT_MIN_RUN = 5;
const DEFAULT_WINDOW = 2;

export function groupLogs(entries: LogEntry[], opts: GroupOptions = {}): GroupedRow[] {
  const minRun = opts.minRun ?? DEFAULT_MIN_RUN;
  const windowSeconds = opts.windowSeconds ?? DEFAULT_WINDOW;

  const out: GroupedRow[] = [];
  let i = 0;

  while (i < entries.length) {
    const head = entries[i];
    if (!head.componentId) {
      // No id → can't group. Emit as single.
      out.push({ kind: 'single', id: `e-${i}`, entry: head, originalIndex: i });
      i++;
      continue;
    }

    // Scan forward for a run of matching entries inside the time window.
    let j = i + 1;
    while (
      j < entries.length &&
      entries[j].componentId === head.componentId &&
      entries[j].severity === head.severity &&
      entries[j].time - head.time <= windowSeconds
    ) {
      j++;
    }
    const runLength = j - i;

    if (runLength >= minRun) {
      out.push({
        kind: 'group',
        id: `g-${i}-${head.componentId}-${head.severity}`,
        entries: entries.slice(i, j),
        componentId: head.componentId,
        severity: head.severity,
        firstIndex: i,
        lastIndex: j - 1,
      });
      i = j;
    } else {
      out.push({ kind: 'single', id: `e-${i}`, entry: head, originalIndex: i });
      i++;
    }
  }

  return out;
}
