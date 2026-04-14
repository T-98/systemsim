import { useEffect, useState } from 'react';

const MIN_DESKTOP_WIDTH = 900;

/**
 * Shows a soft warning banner (not a hard redirect) when the viewport is
 * narrower than the desktop minimum. SystemSim's canvas + side panels need
 * real estate; mobile responsive is deferred.
 */
export default function DesktopOnlyNotice() {
  const [narrow, setNarrow] = useState(
    typeof window !== 'undefined' && window.innerWidth < MIN_DESKTOP_WIDTH
  );
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < MIN_DESKTOP_WIDTH);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  if (!narrow || dismissed) return null;

  return (
    <div
      role="status"
      className="fixed top-0 left-0 right-0 z-50 flex items-start gap-3"
      style={{
        background: 'rgba(255,159,10,0.08)',
        borderBottom: '1px solid rgba(255,159,10,0.2)',
        padding: '10px 16px',
        color: 'var(--text-secondary)',
      }}
    >
      <span
        style={{
          fontSize: 13,
          letterSpacing: '-0.224px',
          lineHeight: 1.4,
          flex: 1,
        }}
      >
        SystemSim works best on desktop. Open this on a laptop or wider screen for the full experience.
      </span>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        style={{
          background: 'transparent',
          color: 'var(--text-tertiary)',
          fontSize: 13,
          padding: '0 4px',
        }}
      >
        Dismiss
      </button>
    </div>
  );
}
