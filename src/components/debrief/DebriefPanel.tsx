import { useStore } from '../../store';

export default function DebriefPanel() {
  const debrief = useStore((s) => s.debrief);
  const debriefVisible = useStore((s) => s.debriefVisible);
  const setDebriefVisible = useStore((s) => s.setDebriefVisible);

  if (!debrief || !debriefVisible) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 transition-transform">
      <div className="bg-[#13151E] border-t border-[#1E2030] max-h-[60vh] overflow-y-auto shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#1E2030] sticky top-0 bg-[#13151E]">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-white">Post-Run Debrief</span>
            <div className="flex gap-3 text-xs">
              <ScoreBadge label="Coherence" score={debrief.scores.coherence} />
              <ScoreBadge label="Security" score={debrief.scores.security} />
              <ScoreBadge label="Performance" score={debrief.scores.performance} />
            </div>
          </div>
          <button onClick={() => setDebriefVisible(false)} className="text-gray-500 hover:text-gray-300">&times;</button>
        </div>

        <div className="p-6 max-w-3xl">
          {/* Summary */}
          <div className="mb-6">
            <h3 className="text-xs uppercase tracking-wider text-gray-500 mb-2">What Happened</h3>
            <p className="text-sm text-gray-300 leading-relaxed">{debrief.summary}</p>
          </div>

          {/* Questions */}
          {debrief.questions.length > 0 && (
            <div className="mb-6">
              <h3 className="text-xs uppercase tracking-wider text-gray-500 mb-2">Questions for You</h3>
              <div className="space-y-3">
                {debrief.questions.map((q, i) => (
                  <div key={i} className="pl-3 border-l-2 border-blue-500">
                    <p className="text-sm text-gray-300 italic">{q}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Flags */}
          {debrief.flags.length > 0 && (
            <div className="mb-6">
              <h3 className="text-xs uppercase tracking-wider text-gray-500 mb-2">Patterns Detected</h3>
              <div className="space-y-1">
                {debrief.flags.map((flag, i) => (
                  <div key={i} className="text-xs text-amber-400 font-mono">
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
  const color = score >= 80 ? 'text-emerald-400' : score >= 50 ? 'text-amber-400' : 'text-red-400';
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-gray-500">{label}</span>
      <span className={`font-mono font-bold ${color}`}>{score}</span>
    </div>
  );
}
