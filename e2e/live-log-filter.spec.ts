/**
 * @file e2e/live-log-filter.spec.ts
 *
 * Phase C1 coverage: severity chips + component dropdown filter the
 * rendered live log; counter reflects shown / total. Uses store-level
 * `addLogEntry` to inject deterministic events without running the sim.
 */

import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RESULTS_DIR = path.join(__dirname, '..', 'test-results', 'live-log-filter');

function ensureDir(dir: string) { fs.mkdirSync(dir, { recursive: true }); }

async function gotoCanvasWithNodes(page: Page) {
  await page.goto('/');
  await page.waitForSelector('text=Or start from a template');
  await page.click('button:has-text("Basic CRUD App")');
  await page.waitForSelector('.react-flow__node', { timeout: 5000 });
  await page.evaluate(() => {
    const s = (window as any).__SYSTEMSIM_STORE__.getState();
    s.setBottomPanelOpen(true);
  });
  await page.waitForSelector('[data-testid="log-filter"]', { timeout: 3000 });
}

async function seedLogs(page: Page, entries: { time: number; message: string; severity: 'info' | 'warning' | 'critical'; componentId?: string }[]) {
  await page.evaluate((es) => {
    const s = (window as any).__SYSTEMSIM_STORE__.getState();
    s.clearLiveLog();
    for (const e of es) s.addLogEntry(e);
  }, entries);
}

test.describe('Live log filter', () => {
  test.setTimeout(45000);
  test.beforeAll(() => ensureDir(RESULTS_DIR));

  test('counter shows shown / total and filters by severity', async ({ page }) => {
    await gotoCanvasWithNodes(page);
    await seedLogs(page, [
      { time: 1, message: 'info event', severity: 'info' },
      { time: 2, message: 'warning event', severity: 'warning' },
      { time: 3, message: 'critical event', severity: 'critical' },
      { time: 4, message: 'another info', severity: 'info' },
    ]);

    await expect(page.getByTestId('log-filter-counter')).toContainText('4 / 4 events');

    // Click the 'warning' chip → only warnings
    await page.getByTestId('log-filter-severity-warning').click();
    await expect(page.getByTestId('log-filter-counter')).toContainText('1 / 4 events');

    // Add 'critical' to the selection → warnings + criticals
    await page.getByTestId('log-filter-severity-critical').click();
    await expect(page.getByTestId('log-filter-counter')).toContainText('2 / 4 events');

    // Reset clears both
    await page.getByTestId('log-filter-reset').click();
    await expect(page.getByTestId('log-filter-counter')).toContainText('4 / 4 events');

    await page.screenshot({ path: path.join(RESULTS_DIR, 'severity-filter.png'), fullPage: true });
  });

  test('component dropdown narrows to one componentId', async ({ page }) => {
    await gotoCanvasWithNodes(page);
    await seedLogs(page, [
      { time: 1, message: 'server-1 event', severity: 'info', componentId: 'server-1' },
      { time: 2, message: 'server-2 event', severity: 'info', componentId: 'server-2' },
      { time: 3, message: 'server-1 warning', severity: 'warning', componentId: 'server-1' },
    ]);

    const select = page.getByTestId('log-filter-component');
    // Options populate from log componentIds
    await select.selectOption('server-1');
    await expect(page.getByTestId('log-filter-counter')).toContainText('2 / 3 events');

    // Combine with severity
    await page.getByTestId('log-filter-severity-warning').click();
    await expect(page.getByTestId('log-filter-counter')).toContainText('1 / 3 events');

    await page.screenshot({ path: path.join(RESULTS_DIR, 'component-filter.png'), fullPage: true });
  });

  test('empty-match shows a friendly empty state', async ({ page }) => {
    await gotoCanvasWithNodes(page);
    await seedLogs(page, [
      { time: 1, message: 'only info', severity: 'info' },
    ]);
    await page.getByTestId('log-filter-severity-critical').click();
    await expect(page.getByTestId('log-filter-empty')).toBeVisible();
    await expect(page.getByTestId('log-filter-counter')).toContainText('0 / 1 events');
  });
});
