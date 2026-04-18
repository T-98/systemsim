/**
 * @file e2e/traffic-phase-curve.spec.ts
 *
 * Phase B2 coverage: PhaseCurve renders above the traffic phases table,
 * updates when phases mutate, and exposes a tooltip on hover.
 */

import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RESULTS_DIR = path.join(__dirname, '..', 'test-results', 'traffic-phase-curve');

function ensureDir(dir: string) { fs.mkdirSync(dir, { recursive: true }); }

async function openTrafficEditor(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.waitForSelector('text=Or start from a template');
  await page.click('button:has-text("Basic CRUD App")');
  await page.waitForSelector('.react-flow__node', { timeout: 5000 });
  await page.evaluate(() => {
    const store = (window as any).__SYSTEMSIM_STORE__;
    store.getState().setAppMode('freeform');
    store.getState().setSidebarTab('traffic');
  });
  // Expand the TrafficEditor (starts collapsed)
  await page.getByTestId('traffic-editor-toggle').click();
  await page.waitForSelector('[data-testid="phase-curve"]', { timeout: 3000 });
}

test.describe('PhaseCurve preview', () => {
  test.setTimeout(45000);
  test.beforeAll(() => ensureDir(RESULTS_DIR));

  test('renders above the phases table with a non-trivial path', async ({ page }) => {
    await openTrafficEditor(page);
    const svg = page.getByTestId('phase-curve');
    await expect(svg).toBeVisible();
    const pathD = await page.getByTestId('phase-curve-path').getAttribute('d');
    expect(pathD).toBeTruthy();
    expect(pathD!.length).toBeGreaterThan(10);
    await page.screenshot({ path: path.join(RESULTS_DIR, 'initial.png'), fullPage: true });
  });

  test('curve updates when a phase rps changes', async ({ page }) => {
    await openTrafficEditor(page);
    const before = await page.getByTestId('phase-curve-path').getAttribute('d');

    // Mutate the first phase's rps via the first RPS input
    const rpsInput = page.locator('input[placeholder="RPS"]').first();
    await rpsInput.fill('7777');
    await rpsInput.blur();

    // Re-render tick
    await page.waitForTimeout(100);
    const after = await page.getByTestId('phase-curve-path').getAttribute('d');
    expect(after).not.toBe(before);
    await page.screenshot({ path: path.join(RESULTS_DIR, 'after-rps-change.png'), fullPage: true });
  });

  test('hover shows tooltip with time + rps', async ({ page }) => {
    await openTrafficEditor(page);
    const svg = page.getByTestId('phase-curve');
    const box = await svg.boundingBox();
    if (!box) throw new Error('no svg box');
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await expect(page.getByTestId('phase-curve-tooltip')).toBeVisible();
    const text = await page.getByTestId('phase-curve-tooltip').textContent();
    expect(text).toMatch(/t=\d+s/);
    expect(text).toMatch(/RPS=/);
    await page.screenshot({ path: path.join(RESULTS_DIR, 'tooltip.png'), fullPage: true });
  });

  test('all five phase shapes render without error', async ({ page }) => {
    await openTrafficEditor(page);
    // Swap the first phase through each shape and confirm the curve stays non-empty
    const shapeSelect = page.locator('select').first();
    for (const shape of ['steady', 'ramp_up', 'ramp_down', 'spike', 'instant_spike']) {
      await shapeSelect.selectOption(shape);
      await page.waitForTimeout(40);
      const d = await page.getByTestId('phase-curve-path').getAttribute('d');
      expect(d, `empty curve for shape=${shape}`).toBeTruthy();
      expect(d!.length).toBeGreaterThan(5);
    }
  });
});
