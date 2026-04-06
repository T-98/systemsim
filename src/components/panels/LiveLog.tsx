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

  const severityColor = {
    info: 'text-gray-400',
    warning: 'text-amber-400',
    critical: 'text-red-400',
  };

  return (
    <div className={`bg-[#0D0F17] border-t border-[#1E2030] transition-all ${logPanelExpanded ? 'h-64' : 'h-32'}`}>
      <div className="flex items-center justify-between px-3 py-1 border-b border-[#1E2030]">
        <span className="text-[10px] uppercase tracking-wider text-gray-500">
          Live Log {simulationStatus === 'running' && <span className="text-blue-400 ml-1 animate-pulse">LIVE</span>}
        </span>
        <button
          onClick={() => setLogPanelExpanded(!logPanelExpanded)}
          className="text-gray-500 hover:text-gray-300 text-xs"
        >
          {logPanelExpanded ? 'Collapse' : 'Expand'}
        </button>
      </div>
      <div className="overflow-y-auto h-full pb-8 px-3 py-1 font-mono text-[11px] leading-relaxed">
        {liveLog.map((entry, i) => (
          <div key={i} className={`${severityColor[entry.severity]}`}>
            <span className="text-gray-600 mr-2">[{formatTime(entry.time)}]</span>
            {entry.message}
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}
