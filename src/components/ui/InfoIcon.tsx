/**
 * @file components/ui/InfoIcon.tsx
 *
 * Tiny (i) glyph that opens a popover with a short description + "Learn more →"
 * link to the wiki. Used next to every field label, traffic editor field,
 * canvas node label, toolbar action, and live-log severity badge.
 *
 * Design:
 * - Self-contained. No external popover dep (Radix/Headless not installed).
 * - Never crashes on unknown topic keys — `lookupTopic` returns a safe
 *   "Documentation coming soon." fallback.
 * - Click to toggle. Click outside, Escape, or the "Learn more" button closes it.
 * - Popover positions relative to the icon; caller controls placement via the
 *   `side` prop if the default ("top") would clip.
 *
 * Tracking for coverage:
 * - Every rendered InfoIcon registers its topic into `window.__SYSTEMSIM_TOPIC_REFS__`
 *   at mount. The `/wiki/coverage` route reads this set to flag unresolved keys.
 */

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from '../../store';
import { lookupTopic } from '../../wiki/topics';

declare global {
  interface Window {
    __SYSTEMSIM_TOPIC_REFS__?: Set<string>;
  }
}

function registerRef(key: string) {
  if (typeof window === 'undefined') return;
  if (!window.__SYSTEMSIM_TOPIC_REFS__) window.__SYSTEMSIM_TOPIC_REFS__ = new Set();
  window.__SYSTEMSIM_TOPIC_REFS__.add(key);
}

type Side = 'top' | 'bottom' | 'left' | 'right';

export interface InfoIconProps {
  topic: string;
  /** Preferred popover side. Auto-flips if it would clip. Default: 'top'. */
  side?: Side;
  /** Optional inline style overrides on the (i) glyph container. */
  style?: React.CSSProperties;
  /** ARIA label override for the trigger. */
  ariaLabel?: string;
}

const GLYPH_SIZE = 14;

export default function InfoIcon({ topic, side = 'top', style, ariaLabel }: InfoIconProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; transformOrigin: string } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const popoverId = useId();
  const openWiki = useStore((s) => s.openWiki);

  const info = lookupTopic(topic);

  useEffect(() => {
    registerRef(topic);
  }, [topic]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (triggerRef.current?.contains(t)) return;
      if (popoverRef.current?.contains(t)) return;
      setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !popoverRef.current) {
      setPos(null);
      return;
    }
    const trig = triggerRef.current.getBoundingClientRect();
    const pop = popoverRef.current.getBoundingClientRect();
    const margin = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Compute candidates for each side, pick the preferred if it fits; otherwise
    // flip to the opposite axis. Don't try to fit on-screen beyond margin — caller
    // chose placement; if all four sides clip, pick the largest remaining room.
    const fitTop = trig.top >= pop.height + margin;
    const fitBottom = vh - trig.bottom >= pop.height + margin;
    const fitLeft = trig.left >= pop.width + margin;
    const fitRight = vw - trig.right >= pop.width + margin;

    let chosen: Side = side;
    if (side === 'top' && !fitTop && fitBottom) chosen = 'bottom';
    else if (side === 'bottom' && !fitBottom && fitTop) chosen = 'top';
    else if (side === 'left' && !fitLeft && fitRight) chosen = 'right';
    else if (side === 'right' && !fitRight && fitLeft) chosen = 'left';

    let top = 0;
    let left = 0;
    let origin = 'center bottom';
    if (chosen === 'top') {
      top = trig.top - pop.height - margin;
      left = trig.left + trig.width / 2 - pop.width / 2;
      origin = 'center bottom';
    } else if (chosen === 'bottom') {
      top = trig.bottom + margin;
      left = trig.left + trig.width / 2 - pop.width / 2;
      origin = 'center top';
    } else if (chosen === 'left') {
      top = trig.top + trig.height / 2 - pop.height / 2;
      left = trig.left - pop.width - margin;
      origin = 'right center';
    } else {
      top = trig.top + trig.height / 2 - pop.height / 2;
      left = trig.right + margin;
      origin = 'left center';
    }

    // Clamp to viewport horizontally + vertically so it never renders off-screen.
    left = Math.max(margin, Math.min(left, vw - pop.width - margin));
    top = Math.max(margin, Math.min(top, vh - pop.height - margin));

    setPos({ top, left, transformOrigin: origin });
  }, [open, side]);

  const handleLearnMore = () => {
    setOpen(false);
    openWiki(topic);
  };

  const learnMoreRef = useRef<HTMLButtonElement>(null);

  // Move focus into the popover when it opens. On close (without navigation)
  // we return focus to the trigger (Escape handler does this explicitly).
  useLayoutEffect(() => {
    if (open && learnMoreRef.current) {
      learnMoreRef.current.focus();
    }
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel ?? `More info: ${info.title}`}
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        data-testid="info-icon"
        data-topic={topic}
        data-resolved={info.resolved ? 'true' : 'false'}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="info-icon-trigger"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: GLYPH_SIZE,
          height: GLYPH_SIZE,
          borderRadius: '50%',
          fontSize: 10,
          fontWeight: 600,
          lineHeight: 1,
          fontStyle: 'italic',
          cursor: 'pointer',
          color: 'var(--text-tertiary)',
          background: 'transparent',
          border: '1px solid var(--border-color)',
          padding: 0,
          flexShrink: 0,
          transition: 'color 160ms ease, border-color 160ms ease, box-shadow 160ms ease',
          ...style,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = 'var(--text-primary)';
          e.currentTarget.style.borderColor = 'var(--text-tertiary)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = 'var(--text-tertiary)';
          e.currentTarget.style.borderColor = 'var(--border-color)';
        }}
        onFocus={(e) => {
          e.currentTarget.style.boxShadow = '0 0 0 2px var(--accent)';
          e.currentTarget.style.color = 'var(--text-primary)';
          e.currentTarget.style.borderColor = 'var(--text-tertiary)';
        }}
        onBlur={(e) => {
          e.currentTarget.style.boxShadow = 'none';
          e.currentTarget.style.color = 'var(--text-tertiary)';
          e.currentTarget.style.borderColor = 'var(--border-color)';
        }}
      >
        i
      </button>
      {open && (
        <div
          ref={popoverRef}
          id={popoverId}
          role="dialog"
          aria-label={info.title}
          data-testid="info-popover"
          data-topic={topic}
          style={{
            position: 'fixed',
            top: pos?.top ?? -9999,
            left: pos?.left ?? -9999,
            visibility: pos ? 'visible' : 'hidden',
            transformOrigin: pos?.transformOrigin,
            minWidth: 220,
            maxWidth: 300,
            padding: '12px 14px',
            borderRadius: 10,
            background: 'var(--bg-sidebar)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-color)',
            boxShadow: 'var(--shadow-card)',
            fontSize: 12,
            lineHeight: 1.45,
            letterSpacing: '-0.12px',
            zIndex: 9999,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 13 }}>{info.title}</div>
          <div style={{ color: 'var(--text-secondary)' }}>
            {info.shortDescription || 'Documentation coming soon.'}
          </div>
          <button
            ref={learnMoreRef}
            type="button"
            data-testid="info-learn-more"
            onClick={handleLearnMore}
            style={{
              marginTop: 10,
              padding: '6px 10px',
              borderRadius: 6,
              background: 'transparent',
              color: 'var(--accent)',
              border: '1px solid var(--accent)',
              fontSize: 12,
              cursor: 'pointer',
              letterSpacing: '-0.12px',
            }}
            onFocus={(e) => { e.currentTarget.style.boxShadow = '0 0 0 2px var(--accent)'; }}
            onBlur={(e) => { e.currentTarget.style.boxShadow = 'none'; }}
          >
            Learn more →
          </button>
        </div>
      )}
    </>
  );
}
