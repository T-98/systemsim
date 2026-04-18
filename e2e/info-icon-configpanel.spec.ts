/**
 * @file e2e/info-icon-configpanel.spec.ts
 *
 * Phase A-scaffold coverage: InfoIcons render next to ConfigPanel field
 * labels, popover opens on click, the "Learn more" button routes to
 * the wiki focused on the correct topic.
 */

import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RESULTS_DIR = path.join(__dirname, '..', 'test-results', 'info-icon-configpanel');

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

async function loadBlankCanvas(page: Page) {
  await page.goto('/');
  await page.waitForSelector('text=Or start from a template');
  await page.click('button:has-text("Basic CRUD App")');
  await page.waitForSelector('.react-flow__node', { timeout: 5000 });
}

async function openFirstServerConfig(page: Page) {
  // Click the first server node to open ConfigPanel
  const firstNode = page.locator('.react-flow__node').first();
  await firstNode.click();
  await page.waitForTimeout(200);
}

test.describe('InfoIcon in ConfigPanel', () => {
  test.setTimeout(45000);
  test.beforeAll(() => ensureDir(RESULTS_DIR));

  test('component config panel renders InfoIcons next to field labels', async ({ page }) => {
    await loadBlankCanvas(page);
    await openFirstServerConfig(page);

    const icons = page.locator('[data-testid="info-icon"]');
    const count = await icons.count();
    expect(count).toBeGreaterThan(3);

    // At least one of them resolves to a declared topic
    const resolvedCount = await page.locator('[data-testid="info-icon"][data-resolved="true"]').count();
    expect(resolvedCount).toBeGreaterThan(0);

    await page.screenshot({ path: path.join(RESULTS_DIR, 'config-panel-with-icons.png'), fullPage: true });
  });

  test('clicking an InfoIcon opens a popover with a "Learn more" button', async ({ page }) => {
    await loadBlankCanvas(page);
    await openFirstServerConfig(page);

    const firstIcon = page.locator('[data-testid="info-icon"]').first();
    await firstIcon.click();

    const popover = page.getByTestId('info-popover');
    await expect(popover).toBeVisible();
    await expect(page.getByTestId('info-learn-more')).toBeVisible();

    await page.screenshot({ path: path.join(RESULTS_DIR, 'popover-open.png'), fullPage: true });
  });

  test('"Learn more" routes to the wiki focused on the topic', async ({ page }) => {
    await loadBlankCanvas(page);
    await openFirstServerConfig(page);

    // Pick a specific InfoIcon whose topic we know (component.* on the header)
    const headerIcon = page.locator('[data-testid="info-icon"][data-topic^="component."]').first();
    const topicAttr = await headerIcon.getAttribute('data-topic');
    expect(topicAttr).toBeTruthy();

    await headerIcon.click();
    await page.getByTestId('info-learn-more').click();

    await page.waitForSelector('[data-testid="wiki-nav"]', { timeout: 3000 });
    const body = page.getByTestId('wiki-body');
    await expect(body).toHaveAttribute('data-topic', topicAttr!);

    await page.screenshot({ path: path.join(RESULTS_DIR, 'learn-more-routes.png'), fullPage: true });
  });

  test('Escape closes the popover', async ({ page }) => {
    await loadBlankCanvas(page);
    await openFirstServerConfig(page);

    await page.locator('[data-testid="info-icon"]').first().click();
    await expect(page.getByTestId('info-popover')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('info-popover')).toHaveCount(0);
  });

  test('wire configuration shows throughput/latency/jitter InfoIcons', async ({ page }) => {
    await loadBlankCanvas(page);
    // Click the first edge/wire
    const edge = page.locator('.react-flow__edge').first();
    await edge.click({ force: true });
    await page.waitForTimeout(300);

    // Expect InfoIcons on throughputRps, latencyMs, jitterMs
    for (const key of ['config.throughputRps', 'config.latencyMs', 'config.jitterMs']) {
      await expect(page.locator(`[data-testid="info-icon"][data-topic="${key}"]`)).toBeVisible();
    }
  });
});
