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
    info: 'text-[#5A6078]',
    warning: 'text-amber-400',
    critical: 'text-red-400',
  };

  return (
    <div className={`bg-[#0A0B12] border-t border-[#14161F] transition-all duration-200 ${logPanelExpanded ? 'h-72' : 'h-28'}`}>
      <div className="flex items-center justify-between px-5 py-2.5 border-b border-[#14161F]">
        <span className="text-[10px] uppercase tracking-widest text-[#5A6078] font-medium">
          Live Log {simulationStatus === 'running' && <span className="text-blue-500 ml-1.5 animate-pulse font-semibold">LIVE</span>}
        </span>
        <button
          onClick={() => setLogPanelExpanded(!logPanelExpanded)}
          className="text-[#5A6078] hover:text-white text-xs transition-all duration-200"
        >
          {logPanelExpanded ? 'Collapse' : 'Expand'}
        </button>
      </div>
      <div className="overflow-y-auto h-full pb-8 px-5 py-2 font-['Geist_Mono',monospace] text-[11px] leading-relaxed">
        {liveLog.map((entry, i) => (
          <div key={i} className={`${severityColor[entry.severity]}`}>
            <span className="text-[#5A6078]/50 mr-2 select-none">[{formatTime(entry.time)}]</span>
            {entry.message}
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}
