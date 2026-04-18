/**
 * @file e2e/wiki-scaffold.spec.ts
 *
 * Phase A-scaffold coverage: wiki route opens, nav shows grouped topics,
 * deep-link selects a specific topic, empty-state content renders, arrow
 * keys navigate, Back returns to the prior view. Screenshots saved to
 * test-results/wiki-scaffold/.
 */

import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RESULTS_DIR = path.join(__dirname, '..', 'test-results', 'wiki-scaffold');

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

async function gotoLanding(page: Page) {
  await page.goto('/');
  await page.waitForSelector('text=Or start from a template');
}

async function openWikiVia(page: Page, topic?: string) {
  await page.evaluate((t) => {
    const store = (window as any).__SYSTEMSIM_STORE__;
    store.getState().openWiki(t ?? undefined);
  }, topic ?? null);
  await page.waitForSelector('[data-testid="wiki-nav"]', { timeout: 5000 });
}

test.describe('Wiki scaffold', () => {
  test.setTimeout(45000);
  test.beforeAll(() => ensureDir(RESULTS_DIR));

  test('wiki opens with three top tabs and a scoped sidebar per tab', async ({ page }) => {
    await gotoLanding(page);
    await openWikiVia(page);

    await expect(page.getByTestId('wiki-nav')).toBeVisible();
    await expect(page.getByTestId('wiki-main')).toBeVisible();
    await expect(page.getByTestId('docs-tabs')).toBeVisible();

    // All three tabs render
    for (const tab of ['learn', 'reference', 'howto']) {
      await expect(page.getByTestId(`docs-tab-${tab}`)).toBeVisible();
    }

    // Switching to Reference shows the full set of groups — auto-imported
    // reference topics plus the shared component / concept / config / severity leaves.
    await page.getByTestId('docs-tab-reference').click();
    for (const cat of ['reference', 'component', 'concept', 'config', 'severity']) {
      await expect(page.getByTestId(`wiki-nav-group-${cat}`)).toBeVisible();
    }
    // The auto-imported reference topics render via MarkdownBody, not the empty-state card.
    await expect(page.getByTestId('docs-markdown')).toBeVisible();

    // Switching to How-to shows only the howto group, with hand-written bodies from P3/P4.
    await page.getByTestId('docs-tab-howto').click();
    await expect(page.getByTestId('wiki-nav-group-howto')).toBeVisible();
    await expect(page.getByTestId('docs-markdown')).toBeVisible();

    await page.screenshot({ path: path.join(RESULTS_DIR, 'wiki-default.png'), fullPage: true });
  });

  test('tab selection writes #docs/<tab> to the URL hash', async ({ page }) => {
    await gotoLanding(page);
    await openWikiVia(page);
    await page.getByTestId('docs-tab-reference').click();
    await expect.poll(() => page.evaluate(() => window.location.hash)).toContain('#docs/reference');
    await page.getByTestId('docs-tab-howto').click();
    await expect.poll(() => page.evaluate(() => window.location.hash)).toContain('#docs/howto');
  });

  test('deep-link to a specific topic focuses that entry', async ({ page }) => {
    await gotoLanding(page);
    await openWikiVia(page, 'component.database');

    const body = page.getByTestId('wiki-body');
    await expect(body).toHaveAttribute('data-topic', 'component.database');

    // Category label shows correctly
    await expect(page.locator('[data-testid="wiki-body"] h1')).toHaveText('Database');

    await page.screenshot({ path: path.join(RESULTS_DIR, 'wiki-deep-link.png'), fullPage: true });
  });

  test('arrow-down moves focused topic', async ({ page }) => {
    await gotoLanding(page);
    await openWikiVia(page, 'component.server');

    await page.keyboard.press('ArrowDown');
    // Wait for focus update
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-testid="wiki-body"]');
      return el?.getAttribute('data-topic') !== 'component.server';
    }, { timeout: 2000 });

    const body = page.getByTestId('wiki-body');
    const current = await body.getAttribute('data-topic');
    expect(current).not.toBe('component.server');
    expect(current).toBeTruthy();
  });

  test('how-to topics show a disabled "Load in canvas" stub', async ({ page }) => {
    await gotoLanding(page);
    await openWikiVia(page, 'howto.retryStorm');

    const loadBtn = page.getByTestId('wiki-howto-load');
    await expect(loadBtn).toBeVisible();
    await expect(loadBtn).toBeDisabled();
    await expect(loadBtn).toHaveAttribute('data-howto-template', 'retryStorm');
    await page.screenshot({ path: path.join(RESULTS_DIR, 'wiki-howto.png'), fullPage: true });
  });

  test('Back button returns the user to the prior view', async ({ page }) => {
    await gotoLanding(page);
    // Set prior view to 'landing' then open wiki
    await openWikiVia(page);

    await page.getByTestId('wiki-back').click();
    await page.waitForSelector('text=Or start from a template', { timeout: 3000 });
  });
});
