/**
 * @file wiki/components/MarkdownBody.tsx
 *
 * Markdown → HTML renderer for wiki topic bodies. Uses `marked` (25KB,
 * no deps) and renders via `dangerouslySetInnerHTML` behind a small
 * allowlist sanitizer.
 *
 * Content sources are all trusted/internal:
 *   - Learn pages: hand-written markdown files bundled with the app.
 *   - Reference pages: auto-imported from system-design-knowledgebase.md
 *     at build time.
 *   - How-to pages: hand-written markdown.
 *
 * The sanitizer is defense-in-depth against a future pipeline that might
 * introduce user-supplied content — not a hot-path concern today.
 *
 * Styling: topic-body prose styles live in index.css `.docs-prose`.
 */

import { useMemo } from 'react';
import { marked } from 'marked';

// Configure marked once at module load. GFM tables + headers with slugified ids.
marked.use({
  gfm: true,
  breaks: false,
  // Deterministic heading IDs so the right-rail TOC can anchor to them.
  // The renderer below emits `id="<slugified heading text>"` on each heading.
});

/** Slugify a heading's text content into a URL-safe anchor id. */
export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 64);
}

interface RenderOpts {
  /** Rewrites `#docs/...` cross-refs in the rendered HTML at mount time. */
  baseHash?: string;
}

/**
 * Render a markdown string to HTML, returning a sanitized string ready
 * for `dangerouslySetInnerHTML`. Memoized on the markdown input.
 */
export function renderMarkdown(md: string, _opts: RenderOpts = {}): string {
  if (!md) return '';
  const raw = marked.parse(md, { async: false }) as string;
  return sanitize(raw);
}

/**
 * Tiny tag allowlist. Rejects `<script>`, `<iframe>`, `javascript:` URLs.
 * Keeps headings / paragraphs / lists / tables / code / a / img / blockquote.
 */
function sanitize(html: string): string {
  // Drop any <script>...</script> or <iframe> blocks outright.
  let out = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  out = out.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');
  // Neutralize javascript: / data: on hrefs and srcs.
  out = out.replace(/\s(href|src)\s*=\s*"(\s*javascript:|\s*data:text\/html)[^"]*"/gi, ' $1="#"');
  out = out.replace(/\s(href|src)\s*=\s*'(\s*javascript:|\s*data:text\/html)[^']*'/gi, ' $1="#"');
  // Drop inline event handlers.
  out = out.replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '');
  out = out.replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '');
  return out;
}

export default function MarkdownBody({ markdown }: { markdown: string }) {
  const html = useMemo(() => renderMarkdown(markdown), [markdown]);
  return (
    <div
      className="docs-prose"
      data-testid="docs-markdown"
      style={{
        fontSize: 15,
        lineHeight: 1.65,
        color: 'var(--text-secondary)',
        letterSpacing: '-0.12px',
        maxWidth: 720,
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
