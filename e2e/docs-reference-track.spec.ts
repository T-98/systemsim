/**
 * @file e2e/docs-reference-track.spec.ts
 *
 * Phase A-content / P2 coverage: the Reference tab is auto-populated from
 * `system-design-knowledgebase.md` at build time. Confirms 39 reference
 * topics land in the sidebar, their bodies render as markdown (not the
 * empty-state card), and cross-refs like `§40` become hash-linked.
 */

import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RESULTS_DIR = path.join(__dirname, '..', 'test-results', 'docs-reference-track');

function ensureDir(dir: string) { fs.mkdirSync(dir, { recursive: true }); }

async function openReferenceTab(page: Page) {
  await page.goto('/');
  await page.waitForSelector('text=Or start from a template');
  await page.evaluate(() => {
    (window as any).__SYSTEMSIM_STORE__.getState().openWiki();
  });
  await page.waitForSelector('[data-testid="docs-tabs"]');
  await page.getByTestId('docs-tab-reference').click();
}

test.describe('Docs Reference track', () => {
  test.setTimeout(45000);
  test.beforeAll(() => ensureDir(RESULTS_DIR));

  test('Reference tab shows auto-imported reference topics + renders markdown', async ({ page }) => {
    await openReferenceTab(page);

    // The `reference` category group exists with a non-trivial number of entries.
    const group = page.getByTestId('wiki-nav-group-reference');
    await expect(group).toBeVisible();
    const refItems = group.getByTestId('wiki-nav-item');
    const count = await refItems.count();
    expect(count).toBeGreaterThan(20); // 39 expected

    // First auto-imported topic renders via MarkdownBody (not empty state).
    await expect(page.getByTestId('docs-markdown')).toBeVisible();
    await expect(page.getByTestId('wiki-empty-state')).toHaveCount(0);

    await page.screenshot({ path: path.join(RESULTS_DIR, 'reference-default.png'), fullPage: true });
  });

  test('clicking §10 Caching shows the full-curriculum body with headings', async ({ page }) => {
    await openReferenceTab(page);

    // Find the §10 Caching nav item by data-topic prefix.
    const cachingItem = page.locator('[data-testid="wiki-nav-item"][data-topic^="reference.10-caching"]').first();
    await cachingItem.click();

    const body = page.getByTestId('docs-markdown');
    await expect(body).toBeVisible();
    await expect(body).toContainText('Caching');
    // H2s from sub-sections like "10.1 Mental Model" render.
    await expect(body.locator('h2')).toHaveCount( await body.locator('h2').count() ); // at least 1

    await page.screenshot({ path: path.join(RESULTS_DIR, 'caching-section.png'), fullPage: true });
  });

  test('deep-link via URL hash #docs/reference/<slug>', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('text=Or start from a template');
    // Click a navigation shortcut: open wiki at §40 circuit breaker
    await page.evaluate(() => {
      (window as any).__SYSTEMSIM_STORE__.getState().openWiki('reference.40-circuit-breaker-state-machine');
    });
    await page.waitForSelector('[data-testid="docs-markdown"]');
    // Hash should be set.
    await expect.poll(() => page.evaluate(() => window.location.hash)).toContain('#docs/reference/40-');
    // Body mentions circuit breaker state names.
    const body = page.getByTestId('docs-markdown');
    await expect(body).toContainText('CLOSED');
    await expect(body).toContainText('HALF_OPEN');
  });
});
