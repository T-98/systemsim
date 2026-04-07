import { useRef, useEffect } from 'react';
import { useStore } from '../../store';

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function LiveLog() {
  const liveLog = useStore((s) => s.liveLog);
  const simulationStatus = useStore((s) => s.simulationStatus);
  const logPanelExpanded = useStore((s) => s.logPanelExpanded);
  const setLogPanelExpanded = useStore((s) => s.setLogPanelExpanded);
  const endRef = useRef<HTMLDivElement>(null);

  const isActive = simulationStatus === 'running' || simulationStatus === 'paused' || simulationStatus === 'completed';

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [liveLog.length]);

  if (!isActive) return null;

  const severityStyle: Record<string, React.CSSProperties> = {
    info: { color: 'var(--text-tertiary)' },
    warning: { color: 'var(--warning)' },
    critical: { color: 'var(--destructive)' },
  };

  return (
    <div
      className="transition-all duration-200"
      style={{
        background: 'var(--bg-card)',
        borderTop: '1px solid var(--border-color)',
        height: logPanelExpanded ? '288px' : '112px',
      }}
    >
      <div
        className="flex items-center justify-between"
        style={{
          padding: '10px 20px',
          borderBottom: '1px solid var(--border-color)',
        }}
      >
        <span
          className="uppercase font-medium"
          style={{ fontSize: '10px', letterSpacing: '0.2em', color: 'var(--text-tertiary)' }}
        >
          Live Log {simulationStatus === 'running' && (
            <span className="animate-pulse font-semibold" style={{ color: 'var(--accent)', marginLeft: '6px' }}>LIVE</span>
          )}
        </span>
        <button
          onClick={() => setLogPanelExpanded(!logPanelExpanded)}
          className="transition-all duration-200"
          style={{ fontSize: '14px', color: 'var(--text-tertiary)' }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-tertiary)'; }}
        >
          {logPanelExpanded ? 'Collapse' : 'Expand'}
        </button>
      </div>
      <div
        className="overflow-y-auto h-full leading-relaxed"
        style={{
          paddingBottom: '32px',
          padding: '8px 20px 32px',
          fontFamily: "'Geist Mono', monospace",
          fontSize: '12px',
          letterSpacing: '-0.12px',
        }}
      >
        {liveLog.map((entry, i) => (
          <div key={i} style={severityStyle[entry.severity]}>
            <span className="mr-2 select-none" style={{ color: 'var(--text-tertiary)', opacity: 0.5 }}>[{formatTime(entry.time)}]</span>
            {entry.message}
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}
