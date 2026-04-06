import { useStore } from '../../store';

export default function HintCard() {
  const hints = useStore((s) => s.hints);
  const dismissHint = useStore((s) => s.dismissHint);

  const activeHints = hints.filter((h) => !h.dismissed);
  if (activeHints.length === 0) return null;

  return (
    <div className="absolute bottom-4 left-4 z-30 space-y-2 max-w-sm">
      {activeHints.map((hint) => (
        <div
          key={hint.id}
          className="bg-[#0C0D14] border border-[#14161F] border-l-2 border-l-blue-500/40 rounded-xl p-4 shadow-lg shadow-black/30"
        >
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs text-[#8890A8] italic leading-relaxed">{hint.message}</p>
            <button
              onClick={() => dismissHint(hint.id)}
              className="text-[#5A6078] hover:text-white text-xs shrink-0 transition-all duration-200"
            >
              &times;
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
