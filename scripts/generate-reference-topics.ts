/**
 * @file scripts/generate-reference-topics.ts
 *
 * Build-time splitter: reads `system-design-knowledgebase.md` at the repo
 * root, carves it into one `reference.<slug>` Topic per top-level
 * `## N. Title` heading, and emits `src/wiki/generated/referenceTopics.ts`
 * which is merged into `TOPICS` at runtime.
 *
 * Runs in two places:
 *   - A Vite plugin (see `vite.config.ts`) regenerates on dev server boot
 *     and on KB edits.
 *   - Standalone via `pnpm run generate:reference-topics` for CI / manual
 *     refreshes.
 *
 * Cross-references in the KB (text like `§40` or `§14.3`) are rewritten to
 * hash-based docs links (`#docs/reference/40-...`) at emit time so clicks
 * work without any runtime indirection.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');
const KB_PATH = resolve(REPO_ROOT, 'system-design-knowledgebase.md');
const OUT_PATH = resolve(REPO_ROOT, 'src/wiki/generated/referenceTopics.ts');
const HEADER_WARN = '// AUTO-GENERATED from system-design-knowledgebase.md — do not edit by hand.';

interface ReferenceSection {
  /** Raw number as it appears in the heading (e.g. "14", "40"). */
  number: string;
  /** The title portion after `N. ` (e.g. "Batch & Stream Processing"). */
  title: string;
  /** The URL-safe slug used in hash links and topic keys. */
  slug: string;
  /** `reference.<slug>` — the TOPICS key. */
  topicKey: string;
  /** First paragraph (≤160 chars) — used as `shortDescription` for popovers. */
  shortDescription: string;
  /** Full markdown body of this section, including its own `## N. Title` header. */
  body: string;
}

/** Slugify a heading's title. `## 14. Batch & Stream Processing` → `14-batch-stream-processing`. */
function buildSlug(num: string, title: string): string {
  const cleaned = title
    .toLowerCase()
    // Strip common punctuation.
    .replace(/[—–,()/:&]/g, ' ')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
  return `${num}-${cleaned}`.slice(0, 80);
}

/** Pull the first paragraph of text from a section body, strip markdown, truncate. */
function extractShortDescription(body: string): string {
  // Body starts with the `## N. Title` line — skip it.
  const lines = body.split('\n');
  let i = 1;
  // Skip blank lines.
  while (i < lines.length && lines[i].trim() === '') i++;
  // Collect until the next blank line or heading.
  const para: string[] = [];
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '' || /^#{1,6}\s/.test(line) || /^\*([^*]|$)/.test(line)) break;
    para.push(line);
    i++;
  }
  const text = para.join(' ')
    // Strip markdown emphasis / links / code ticks for the one-line popover.
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= 160) return text;
  // Truncate at the last word boundary ≤157 chars, append ellipsis.
  const cut = text.slice(0, 157);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > 100 ? lastSpace : 157)}…`;
}

/** Rewrite `§N` and `§N.M` cross-references to hash-based docs links. */
function rewriteCrossRefs(body: string, sectionByNumber: Map<string, ReferenceSection>): string {
  // `§14.3` → we link to `#docs/reference/14-...` (sub-sections collapse to their parent slug).
  return body.replace(/§\s?(\d+)(?:\.(\d+))?(\.\d+)?/g, (match, n) => {
    const sec = sectionByNumber.get(String(n));
    if (!sec) return match;
    return `[${match}](#docs/reference/${sec.slug})`;
  });
}

/**
 * Split the KB markdown into reference sections. Drops the `## Contents`
 * table of contents and anything before `## 1.`.
 */
export function splitReferenceSections(markdown: string): ReferenceSection[] {
  const lines = markdown.split('\n');
  const sections: ReferenceSection[] = [];
  let current: { num: string; title: string; start: number } | null = null;

  const headingRe = /^## (\d+)\. (.+)$/;
  // Two-pass: identify heading boundaries first.
  const boundaries: { num: string; title: string; start: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = headingRe.exec(lines[i]);
    if (!m) continue;
    boundaries.push({ num: m[1], title: m[2].trim(), start: i });
  }

  for (let i = 0; i < boundaries.length; i++) {
    const b = boundaries[i];
    const end = i + 1 < boundaries.length ? boundaries[i + 1].start : lines.length;
    const body = lines.slice(b.start, end).join('\n').trim();
    const slug = buildSlug(b.num, b.title);
    sections.push({
      number: b.num,
      title: b.title,
      slug,
      topicKey: `reference.${slug}`,
      shortDescription: extractShortDescription(body),
      body,
    });
  }

  // Cross-ref rewrite needs a full slug map to resolve §N links.
  const byNumber = new Map(sections.map((s) => [s.number, s]));
  for (const s of sections) {
    s.body = rewriteCrossRefs(s.body, byNumber);
  }

  return sections;
}

/** Emit TS source for `referenceTopics.ts`. */
function emitModule(sections: ReferenceSection[]): string {
  const lines: string[] = [
    HEADER_WARN,
    '// Run `pnpm run generate:reference-topics` to refresh.',
    '',
    "import type { Topic } from '../topics';",
    '',
    'export const REFERENCE_TOPICS: Record<string, Topic> = {',
  ];
  for (const s of sections) {
    lines.push(`  ${JSON.stringify(s.topicKey)}: {`);
    lines.push(`    title: ${JSON.stringify(`§${s.number} ${s.title}`)},`);
    lines.push(`    shortDescription: ${JSON.stringify(s.shortDescription)},`);
    lines.push(`    body: ${JSON.stringify(s.body)},`);
    lines.push(`    category: 'reference',`);
    lines.push(`  },`);
  }
  lines.push('};');
  lines.push('');
  lines.push(`export const REFERENCE_SECTION_COUNT = ${sections.length};`);
  lines.push('');
  return lines.join('\n');
}

export function generateReferenceTopics(options?: { kbPath?: string; outPath?: string }): number {
  const kb = options?.kbPath ?? KB_PATH;
  const out = options?.outPath ?? OUT_PATH;
  if (!existsSync(kb)) {
    // eslint-disable-next-line no-console
    console.warn(`[generate-reference-topics] KB not found at ${kb} — emitting empty stub.`);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(
      out,
      `${HEADER_WARN}\nimport type { Topic } from '../topics';\nexport const REFERENCE_TOPICS: Record<string, Topic> = {};\nexport const REFERENCE_SECTION_COUNT = 0;\n`,
      'utf8'
    );
    return 0;
  }
  const md = readFileSync(kb, 'utf8');
  const sections = splitReferenceSections(md);
  const source = emitModule(sections);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, source, 'utf8');
  // eslint-disable-next-line no-console
  console.log(`[generate-reference-topics] Emitted ${sections.length} reference topics → ${out}`);
  return sections.length;
}

// Standalone entry point: `tsx scripts/generate-reference-topics.ts`.
// (Covers CI + manual refresh; Vite invokes the exported function programmatically.)
if (import.meta.url === `file://${process.argv[1]}`) {
  generateReferenceTopics();
}
