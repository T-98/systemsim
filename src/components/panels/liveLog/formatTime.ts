/**
 * @file components/panels/liveLog/formatTime.ts
 *
 * Shared helper — `mm:ss` formatting for a LogEntry's time field.
 * Extracted from BottomPanel.tsx so LogGroupedRow can reuse it.
 */

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
