import { useStore } from '../../store';

export default function DebriefPanel() {
  const debrief = useStore((s) => s.debrief);
  const debriefVisible = useStore((s) => s.debriefVisible);
  const setDebriefVisible = useStore((s) => s.setDebriefVisible);

  if (!debrief || !debriefVisible) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 transition-transform">
      <div className="bg-[#0A0B12] border-t border-[#14161F] max-h-[60vh] overflow-y-auto shadow-2xl shadow-black/50">
        <div className="flex items-center justify-between px-8 py-4 border-b border-[#14161F] sticky top-0 bg-[#0A0B12]">
          <div className="flex items-center gap-4">
            <span className="text-sm font-semibold text-white font-['Playfair_Display',serif]">Post-Run Debrief</span>
            <div className="flex gap-3 text-xs">
              <ScoreBadge label="Coherence" score={debrief.scores.coherence} />
              <ScoreBadge label="Security" score={debrief.scores.security} />
              <ScoreBadge label="Performance" score={debrief.scores.performance} />
            </div>
          </div>
          <button onClick={() => setDebriefVisible(false)} className="text-[#5A6078] hover:text-white transition-all duration-200">&times;</button>
        </div>

        <div className="p-8 max-w-3xl">
          {/* Summary */}
          <div className="mb-8">
            <h3 className="text-[10px] uppercase tracking-widest text-[#5A6078] mb-3 font-medium">What Happened</h3>
            <p className="text-sm text-[#8890A8] leading-relaxed">{debrief.summary}</p>
          </div>

          {/* Questions */}
          {debrief.questions.length > 0 && (
            <div className="mb-8">
              <h3 className="text-[10px] uppercase tracking-widest text-[#5A6078] mb-3 font-medium">Questions for You</h3>
              <div className="space-y-3">
                {debrief.questions.map((q, i) => (
                  <div key={i} className="pl-4 border-l-2 border-blue-500/60">
                    <p className="text-sm text-[#8890A8] italic leading-relaxed">{q}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Flags */}
          {debrief.flags.length > 0 && (
            <div className="mb-8">
              <h3 className="text-[10px] uppercase tracking-widest text-[#5A6078] mb-3 font-medium">Patterns Detected</h3>
              <div className="space-y-1.5">
                {debrief.flags.map((flag, i) => (
                  <div key={i} className="text-xs text-amber-400 font-['Geist_Mono',monospace]">
                    {flag}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ScoreBadge({ label, score }: { label: string; score: number }) {
  const bg = score >= 80
    ? 'bg-emerald-500/10 text-emerald-400'
    : score >= 50
    ? 'bg-amber-500/10 text-amber-400'
    : 'bg-red-500/10 text-red-400';
  return (
    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg ${bg}`}>
      <span className="text-[#5A6078] text-[10px]">{label}</span>
      <span className="font-['Geist_Mono',monospace] font-bold text-[11px]">{score}</span>
    </div>
  );
}
