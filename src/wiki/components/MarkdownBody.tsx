/**
 * @file wiki/components/MarkdownBody.tsx
 *
 * Markdown → HTML renderer for wiki topic bodies. Uses `marked` (25KB,
 * no deps) with a hand-rolled sanitizer + custom `<CanvasEmbed>` splice.
 *
 * CanvasEmbed integration:
 *   Authors drop `<CanvasEmbed template="<slug>" />` tags into markdown
 *   (used by how-to pages). This renderer splits the source on those
 *   tags, renders each surrounding markdown chunk separately, and
 *   interpolates <CanvasEmbed /> React components between them. The
 *   renderer stays safe-by-default — the tag is recognized only in this
 *   exact syntax, never as arbitrary HTML.
 *
 * Content sources are all trusted/internal (Learn pages hand-written,
 * Reference auto-imported from the KB, How-to hand-written). The
 * sanitizer is defense-in-depth for future user-supplied content.
 */

import { Fragment, useMemo } from 'react';
import { marked, Marked, Lexer, type Tokens } from 'marked';
import CanvasEmbed from './CanvasEmbed';

marked.use({ gfm: true, breaks: false });

/** A heading extracted from a topic's body for the right-rail TOC. */
export interface TocHeading {
  level: 2 | 3;
  text: string;
  id: string;
}

/** Slugify a heading into a URL-safe id. */
export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 64);
}

/**
 * Dedup a slug against a running counter. Same algorithm used by both the
 * heading renderer and the extractHeadings walker so the generated DOM ids
 * match the TOC hrefs exactly.
 */
function uniqueId(base: string, seen: Map<string, number>): string {
  const n = seen.get(base) ?? 0;
  seen.set(base, n + 1);
  return n === 0 ? base : `${base}-${n + 1}`;
}

/** Extract plain text from an inline token list (strip HTML). */
function plainText(tokens: Tokens.Generic[] | undefined): string {
  if (!tokens) return '';
  let out = '';
  for (const t of tokens) {
    if (typeof (t as Tokens.Text).text === 'string') out += (t as Tokens.Text).text;
    // Recurse into nested inline tokens (link/em/strong/etc.)
    if ((t as Tokens.Generic).tokens) out += plainText((t as Tokens.Generic).tokens);
  }
  return out;
}

/**
 * Walk the markdown token stream and return the h2/h3 headings with
 * stable, deduped ids. Uses the same dedup counter as the renderer so
 * the TOC's `href="#id"` matches the rendered `<h2 id="id">` exactly.
 */
export function extractHeadings(md: string): TocHeading[] {
  if (!md) return [];
  const lexer = new Lexer({ gfm: true, breaks: false });
  const tokens = lexer.lex(md);
  const seen = new Map<string, number>();
  const out: TocHeading[] = [];
  for (const tok of tokens) {
    if (tok.type !== 'heading') continue;
    const h = tok as Tokens.Heading;
    const text = plainText(h.tokens as Tokens.Generic[]).trim();
    const base = slugifyHeading(text);
    const id = uniqueId(base, seen);
    if (h.depth === 2 || h.depth === 3) {
      out.push({ level: h.depth, text, id });
    }
  }
  return out;
}

/**
 * Render markdown to sanitized HTML with heading ids and a quiet anchor
 * affordance on h2/h3. Uses a per-call `Marked` instance so the dedup
 * counter is scoped to this render (no shared state across topics).
 */
export function renderMarkdown(md: string): string {
  if (!md) return '';
  const seen = new Map<string, number>();
  const m = new Marked({ gfm: true, breaks: false });
  m.use({
    renderer: {
      // Regular function so `this` binds to the marked Renderer instance at
      // render time — that's where `parser.parseInline` lives. An arrow
      // function or closure capture of the `m` instance does NOT work in
      // marked v18 (parser is set per-parse on the renderer, not on `m`).
      heading(this: { parser: { parseInline(t: Tokens.Generic[]): string } }, token: Tokens.Heading): string {
        const textHtml = this.parser.parseInline(token.tokens as Tokens.Generic[]);
        const plain = textHtml.replace(/<[^>]+>/g, '').trim();
        const base = slugifyHeading(plain);
        const id = uniqueId(base, seen);
        return `<h${token.depth} id="${id}">${textHtml}</h${token.depth}>\n`;
      },
    },
  });
  const raw = m.parse(md, { async: false }) as string;
  return sanitize(raw);
}

/**
 * Allowlist sanitizer. Parses the HTML via DOMParser, walks the tree,
 * and rebuilds the serialized output keeping only tags + attributes we
 * expect. Defense-in-depth — our content is internal/trusted today, but
 * this future-proofs us if the pipeline ever accepts user markdown.
 *
 * A regex sanitizer was too easy to bypass:
 *   - unclosed `<script>`, `<iframe>`, `<object>`, `<embed>`, `<form>`
 *   - unquoted attributes (`href=javascript:...`)
 *   - HTML-entity / whitespace tricks (`java\tscript:`, `&#106;avascript:`)
 *   - dangerous `data:image/svg+xml` URLs
 *   - inline handlers inside foreign content (MathML, SVG)
 */
const ALLOWED_TAGS = new Set([
  'a', 'p', 'br', 'hr', 'span', 'div', 'strong', 'em', 'code', 'pre', 'blockquote',
  'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'img',
]);
const ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(['href', 'title', 'rel', 'target']),
  img: new Set(['src', 'alt', 'title', 'width', 'height']),
  '*': new Set(['class', 'id']),
};
const SAFE_URL_RE = /^(https?:|mailto:|#|\/)/i;

function sanitize(html: string): string {
  if (typeof DOMParser === 'undefined') {
    // SSR fallback: be conservative — strip all tags. Pages using this path
    // won't exist in SystemSim today but we leave a safe default.
    return html.replace(/<[^>]*>/g, '');
  }
  const doc = new DOMParser().parseFromString(`<div id="root">${html}</div>`, 'text/html');
  const root = doc.getElementById('root');
  if (!root) return '';
  sanitizeNode(root);
  // Post-process: wrap wide tables in a horizontally scrollable container so
  // they don't blow out the article column. Matches .docs-table-scroll in CSS.
  for (const table of Array.from(root.querySelectorAll('table'))) {
    const wrap = doc.createElement('div');
    wrap.className = 'docs-table-scroll';
    table.parentNode?.insertBefore(wrap, table);
    wrap.appendChild(table);
  }
  return root.innerHTML;
}

function sanitizeNode(node: Node): void {
  const children = Array.from(node.childNodes);
  for (const child of children) {
    if (child.nodeType === 1 /* element */) {
      const el = child as Element;
      const tag = el.tagName.toLowerCase();
      if (!ALLOWED_TAGS.has(tag)) {
        // Unknown tag → unwrap: keep safe text children, drop the element.
        // Avoids dropping legitimate nested text when we remove e.g. <div> wrappers.
        const safe = el.textContent ?? '';
        node.replaceChild(document.createTextNode(safe), el);
        continue;
      }
      // Whitelist attributes.
      for (const attr of Array.from(el.attributes)) {
        const name = attr.name.toLowerCase();
        const perTag = ALLOWED_ATTRS[tag];
        const wildcard = ALLOWED_ATTRS['*'];
        const allowed = (perTag && perTag.has(name)) || (wildcard && wildcard.has(name));
        if (!allowed) {
          el.removeAttribute(attr.name);
          continue;
        }
        // Scrub href/src URLs.
        if ((name === 'href' || name === 'src') && !SAFE_URL_RE.test(attr.value.trim())) {
          el.setAttribute(attr.name, '#');
        }
      }
      // Force safe `rel` on anchors with target=_blank.
      if (tag === 'a' && el.getAttribute('target') === '_blank') {
        el.setAttribute('rel', 'noopener noreferrer');
      }
      sanitizeNode(el);
    } else if (child.nodeType === 8 /* comment */) {
      node.removeChild(child);
    }
  }
}

// Case-insensitive + matches self-closing / paired forms + tolerant of whitespace.
const EMBED_RE = /<CanvasEmbed\s+template\s*=\s*"([^"]+)"\s*\/?>(?:<\/CanvasEmbed>)?/gi;
// Slug allowlist for the embed template fetch (matches the filesystem naming).
const SAFE_SLUG_RE = /^[a-zA-Z0-9_-]+$/;
// Fenced + indented code blocks. We blank these out before scanning for embeds
// so `<CanvasEmbed />` inside a code example doesn't get spliced as a live embed.
const FENCED_CODE_RE = /```[\s\S]*?```|~~~[\s\S]*?~~~/g;

interface Segment {
  kind: 'markdown' | 'embed';
  content: string;
}

/** Replace each char inside matches with spaces so indexes outside match are unchanged. */
function blankRanges(md: string, re: RegExp): string {
  return md.replace(re, (m) => m.replace(/[^\n]/g, ' '));
}

/**
 * Split markdown on CanvasEmbed tags. Scans over a copy of the source with
 * code blocks blanked out so embeds inside code blocks aren't extracted;
 * the extracted index ranges are then applied to the original string so
 * the output preserves verbatim markdown.
 */
function splitOnEmbeds(md: string): Segment[] {
  const segs: Segment[] = [];
  const scannable = blankRanges(md, FENCED_CODE_RE);
  let last = 0;
  let m: RegExpExecArray | null;
  EMBED_RE.lastIndex = 0;
  while ((m = EMBED_RE.exec(scannable))) {
    const slug = m[1].trim();
    if (!SAFE_SLUG_RE.test(slug)) continue; // Silently drop — never fetch arbitrary paths.
    if (m.index > last) segs.push({ kind: 'markdown', content: md.slice(last, m.index) });
    segs.push({ kind: 'embed', content: slug });
    last = m.index + m[0].length;
  }
  if (last < md.length) segs.push({ kind: 'markdown', content: md.slice(last) });
  return segs;
}

export default function MarkdownBody({ markdown }: { markdown: string }) {
  const segments = useMemo(() => splitOnEmbeds(markdown), [markdown]);
  const rendered = useMemo(
    () =>
      segments.map((s) => ({
        kind: s.kind,
        html: s.kind === 'markdown' ? renderMarkdown(s.content) : s.content,
      })),
    [segments]
  );

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
    >
      {rendered.map((seg, i) => {
        if (seg.kind === 'embed') {
          return <CanvasEmbed key={`embed-${i}`} template={seg.html} />;
        }
        return (
          <Fragment key={`md-${i}`}>
            <div dangerouslySetInnerHTML={{ __html: seg.html }} />
          </Fragment>
        );
      })}
    </div>
  );
}
