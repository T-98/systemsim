/**
 * @file e2e/traffic-panel-scroll.spec.ts
 *
 * Phase B1 coverage: sidebar widens to 320px on wide viewports, collapses
 * to a 44px rail below 1200px, content scrolls instead of clipping.
 */

import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RESULTS_DIR = path.join(__dirname, '..', 'test-results', 'traffic-panel-scroll');

function ensureDir(dir: string) { fs.mkdirSync(dir, { recursive: true }); }

async function gotoCanvasFreeform(page: Page) {
  await page.goto('/');
  await page.waitForSelector('text=Or start from a template');
  await page.click('button:has-text("Basic CRUD App")');
  await page.waitForSelector('.react-flow__node', { timeout: 5000 });
  await page.evaluate(() => {
    const store = (window as any).__SYSTEMSIM_STORE__;
    store.getState().setAppMode('freeform');
    store.getState().setSidebarTab('traffic');
  });
  await page.waitForSelector('[data-testid="canvas-sidebar"]');
}

test.describe('Traffic panel sizing + responsive collapse', () => {
  test.setTimeout(45000);
  test.beforeAll(() => ensureDir(RESULTS_DIR));

  test('sidebar is 320px wide on viewports ≥ 1200px', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoCanvasFreeform(page);
    const sidebar = page.getByTestId('canvas-sidebar');
    await expect(sidebar).toHaveAttribute('data-collapsed', 'false');
    const box = await sidebar.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(320);
    expect(box?.width).toBeLessThanOrEqual(360);
    await page.screenshot({ path: path.join(RESULTS_DIR, 'wide-expanded.png'), fullPage: true });
  });

  test('sidebar collapses to a rail below 1200px', async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 900 });
    await gotoCanvasFreeform(page);
    const sidebar = page.getByTestId('canvas-sidebar');
    await expect(sidebar).toHaveAttribute('data-collapsed', 'true');
    await expect(page.getByTestId('sidebar-expand')).toBeVisible();
    const box = await sidebar.boundingBox();
    expect(box?.width).toBeLessThanOrEqual(60);
    await page.screenshot({ path: path.join(RESULTS_DIR, 'narrow-collapsed.png'), fullPage: true });
  });

  test('user can manually collapse / expand', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoCanvasFreeform(page);
    await page.getByTestId('sidebar-collapse').click();
    await expect(page.getByTestId('canvas-sidebar')).toHaveAttribute('data-collapsed', 'true');
    await page.getByTestId('sidebar-expand').click();
    await expect(page.getByTestId('canvas-sidebar')).toHaveAttribute('data-collapsed', 'false');
  });

  test('traffic panel content scrolls instead of clipping', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 700 });
    await gotoCanvasFreeform(page);
    // Expand the TrafficEditor (it starts collapsed)
    await page.getByTestId('traffic-editor-toggle').click();
    await page.waitForSelector('[data-testid="nl-traffic-input"]', { timeout: 3000 });

    // The "Apply" button is at the bottom of the panel body — should be reachable via scroll,
    // not clipped. Scroll into view first, then assert it's visible.
    const apply = page.locator('button:has-text("Apply")');
    await apply.scrollIntoViewIfNeeded();
    await expect(apply).toBeVisible();
  });
});
