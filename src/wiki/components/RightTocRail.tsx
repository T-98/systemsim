/**
 * @file wiki/components/RightTocRail.tsx
 *
 * "On this page" TOC shown to the right of the article at wide viewports.
 * Derives its heading list from the topic's markdown body via
 * `extractHeadings()` — same dedup algorithm the renderer uses to attach
 * `id=` attributes, so anchor hrefs and DOM ids always match.
 *
 * Active-section tracking uses a single IntersectionObserver with the
 * wiki main-pane element as the observer root (not the viewport), because
 * the wiki scrolls inside `<main className="overflow-y-auto">` in
 * WikiRoute. The observer is torn down and re-created whenever the topic
 * or scroll container changes so we don't leak observers across navigations.
 *
 * Section deep-linking: v1 is scrollIntoView-only. We intentionally do
 * not write the section id into the URL hash because the docs router
 * already owns `#docs/<tab>/<slug>`. A future docsHash grammar change
 * could layer sections on top without breaking the current layout.
 */

import { useEffect, useRef, useState, type RefObject } from 'react';
import { extractHeadings, type TocHeading } from './MarkdownBody';

export default function RightTocRail({
  markdown,
  scrollRootRef,
  topicKey,
}: {
  markdown: string;
  /** The wiki main-pane scroll container. The observer roots here. */
  scrollRootRef: RefObject<HTMLElement | null>;
  /** Re-derive the TOC + observer whenever this changes. */
  topicKey: string | null;
}) {
  const [headings, setHeadings] = useState<TocHeading[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    setHeadings(extractHeadings(markdown));
    setActiveId(null);
  }, [markdown, topicKey]);

  useEffect(() => {
    const root = scrollRootRef.current;
    if (!root || headings.length === 0) return;
    // rootMargin top is negative so a heading is only "active" once it's
    // comfortably past the sticky header; bottom is negative so we pick a
    // single heading near the top of the viewport instead of whatever's
    // last visible near the bottom.
    const io = new IntersectionObserver(
      (entries) => {
        // Prefer headings that are intersecting; pick the topmost by
        // document order.
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort(
            (a, b) => (a.target as HTMLElement).offsetTop - (b.target as HTMLElement).offsetTop,
          );
        if (visible.length > 0) {
          setActiveId(visible[0].target.id);
        }
      },
      {
        root,
        rootMargin: '-80px 0px -70% 0px',
        threshold: 0,
      },
    );
    for (const h of headings) {
      const el = root.querySelector<HTMLElement>(`#${CSS.escape(h.id)}`);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, [headings, scrollRootRef, topicKey]);

  if (headings.length === 0) return null;

  const onClick = (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    // preventDefault so the browser doesn't stomp `#docs/<tab>/<slug>` on us
    // (see file header). We scroll manually inside the wiki main pane.
    e.preventDefault();
    const root = scrollRootRef.current;
    const el = root?.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setActiveId(id);
    }
  };

  return (
    <aside
      data-testid="wiki-toc"
      role="navigation"
      aria-label="On this page"
      style={{
        width: 200,
        flexShrink: 0,
        padding: '48px 24px 96px 0',
        position: 'sticky',
        top: 0,
        alignSelf: 'flex-start',
        maxHeight: 'calc(100vh - 0px)',
        overflowY: 'auto',
      }}
    >
      <div
        style={{
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: '-0.12px',
          color: 'var(--text-primary)',
          marginBottom: 12,
        }}
      >
        On this page
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {headings.map((h) => {
          const isActive = activeId === h.id;
          return (
            <li key={h.id} style={{ margin: 0 }}>
              <a
                data-testid="wiki-toc-item"
                data-active={isActive ? 'true' : 'false'}
                data-depth={h.level}
                aria-current={isActive ? 'location' : undefined}
                href={`#${h.id}`}
                onClick={(e) => onClick(e, h.id)}
                style={{
                  display: 'block',
                  padding: '4px 0 4px 8px',
                  paddingLeft: h.level === 3 ? 24 : 8,
                  fontSize: 13,
                  letterSpacing: '-0.224px',
                  color: isActive ? 'var(--accent-link)' : 'var(--text-tertiary)',
                  textDecoration: 'none',
                  borderLeft: `2px solid ${isActive ? 'var(--accent)' : 'transparent'}`,
                  lineHeight: 1.45,
                }}
              >
                {h.text}
              </a>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
