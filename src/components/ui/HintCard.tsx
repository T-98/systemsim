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
          className="bg-[#1A1D27] border border-[#2A2D3A] rounded-sm p-3 shadow-lg"
        >
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs text-gray-300 italic leading-relaxed">{hint.message}</p>
            <button
              onClick={() => dismissHint(hint.id)}
              className="text-gray-500 hover:text-gray-300 text-xs shrink-0"
            >
              &times;
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
