/**
 * @file wiki/docsHash.ts
 *
 * URL-hash-based deep linking for the docs product. Consistent with
 * Decisions §39 (state-based routing over React Router).
 *
 * Hash format:
 *   #docs/<tab>[/<topicSlug>]
 *
 * Examples:
 *   #docs/learn/welcome
 *   #docs/learn/your-first-design
 *   #docs/reference/10-caching-full-curriculum
 *   #docs/howto/cache-stampede
 *
 * The DocsShell parses the hash on mount and writes it on nav. Topic
 * keys use `.` in the TOPICS record (e.g. `userGuide.welcome`,
 * `reference.10-caching`) — we translate between `.` and `/` at the
 * boundary so the URL reads naturally.
 */

import type { WikiTab } from '../types';

export interface ParsedHash {
  tab: WikiTab | null;
  /** The full topic key as stored in `TOPICS` (e.g. `userGuide.welcome`). */
  topicKey: string | null;
}

/**
 * Parse a URL hash into a docs location. Returns `{ tab: null, topicKey: null }`
 * if the hash isn't a docs link, or if the tab isn't recognized.
 */
export function parseDocsHash(hash: string): ParsedHash {
  // Normalize: strip a single leading '#' if present.
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const parts = raw.split('/').filter(Boolean);

  if (parts[0] !== 'docs') return { tab: null, topicKey: null };

  const tab = parts[1] as WikiTab | undefined;
  if (tab !== 'learn' && tab !== 'reference' && tab !== 'howto') {
    return { tab: null, topicKey: null };
  }

  if (parts.length < 3) return { tab, topicKey: null };

  // Remaining segments join on '/' — topic slugs can contain '/' escapes in
  // theory. In practice they're single-segment snake-case-ish, but be safe.
  const slug = parts.slice(2).join('/');
  const topicKey = slugToTopicKey(tab, slug);
  return { tab, topicKey };
}

/**
 * Build a URL hash for a given location. The tab is required; omit the
 * topic to link to the tab root.
 */
export function buildDocsHash(tab: WikiTab, topicKey?: string | null): string {
  if (!topicKey) return `#docs/${tab}`;
  const slug = topicKeyToSlug(topicKey);
  return `#docs/${tab}/${slug}`;
}

/**
 * Replace the current location hash without adding a new history entry
 * (we use replace to avoid filling back/forward with intra-doc nav noise).
 */
export function writeDocsHash(tab: WikiTab, topicKey?: string | null): void {
  if (typeof window === 'undefined') return;
  const next = buildDocsHash(tab, topicKey);
  if (window.location.hash === next) return;
  history.replaceState(null, '', next);
}

/** Topic keys use `.`; URLs use `/`. */
export function topicKeyToSlug(key: string): string {
  // For a tabbed URL we only care about the portion AFTER the category prefix.
  // `userGuide.your-first-design` → `your-first-design`
  // `reference.10-caching-full-curriculum` → `10-caching-full-curriculum`
  // `howto.cache-stampede` → `cache-stampede`
  // Any unknown prefix just drops to the suffix after the first `.`.
  const dot = key.indexOf('.');
  if (dot < 0) return key;
  return key.slice(dot + 1);
}

/**
 * The inverse of topicKeyToSlug: tab + slug → topic key. Since the tab
 * choice dictates which category prefix to apply, this is straightforward.
 */
export function slugToTopicKey(tab: WikiTab, slug: string): string {
  const prefix = tab === 'learn' ? 'userGuide' : tab === 'reference' ? 'reference' : 'howto';
  return `${prefix}.${slug}`;
}
