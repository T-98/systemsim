import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RESULTS_DIR = path.join(__dirname, '..', 'test-results', 'simfid-phase8a-bote');

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

async function openCanvasFreeform(page: Page) {
  await page.goto('/');
  await page.waitForSelector('text=Or start from a template');
  await page.click('button:has-text("Basic CRUD App")');
  await page.waitForSelector('.react-flow__node', { timeout: 5000 });
  await page.evaluate(() => {
    const store = (window as any).__SYSTEMSIM_STORE__;
    store.getState().setAppMode('freeform');
    store.getState().setSidebarTab('traffic');
  });
}

async function expandTrafficEditor(page: Page) {
  const toggle = page.getByTestId('traffic-editor-toggle');
  await toggle.click();
  await expect(page.getByTestId('traffic-open-bote')).toBeVisible();
}

test.describe('SIMFID Phase 8a — BOTE capacity estimator', () => {
  test.beforeAll(() => ensureDir(RESULTS_DIR));

  test('panel opens from the traffic tab and renders all estimates', async ({ page }) => {
    await openCanvasFreeform(page);
    await expandTrafficEditor(page);

    await page.getByTestId('traffic-open-bote').click();
    await expect(page.getByTestId('bote-panel')).toBeVisible();

    // Defaults: 1M DAU × 10 actions / 86 400 ≈ 115.7 avg QPS, 3× peak ≈ 347.
    await expect(page.getByTestId('bote-out-avg-qps')).toHaveText('116');
    await expect(page.getByTestId('bote-out-peak-qps')).toHaveText('347');
    // 2M writes/day × 1 KB ≈ 57.2 GB / month.
    await expect(page.getByTestId('bote-out-storage-month')).toHaveText('57.2 GB');

    await page.screenshot({ path: path.join(RESULTS_DIR, 'bote-panel-defaults.png'), fullPage: true });
  });

  test('DAU input updates outputs live', async ({ page }) => {
    await openCanvasFreeform(page);
    await expandTrafficEditor(page);
    await page.getByTestId('traffic-open-bote').click();

    const dau = page.getByTestId('bote-input-dau');
    await dau.fill('10000000'); // 10M DAU → 1157 avg QPS → "1.2K"
    await expect(page.getByTestId('bote-out-avg-qps')).toHaveText('1.2K');
    await expect(page.getByTestId('bote-out-peak-qps')).toHaveText('3.5K');

    await page.screenshot({ path: path.join(RESULTS_DIR, 'bote-panel-live-update.png'), fullPage: true });
  });

  test('deleting a selected component does NOT surface the estimator uninvited', async ({ page }) => {
    await openCanvasFreeform(page);

    // Select a node (opens its config), then delete it from the panel.
    await page.locator('.react-flow__node').first().click();
    await expect(page.getByRole('button', { name: 'Delete Component' })).toBeVisible();
    await page.getByRole('button', { name: 'Delete Component' }).click();

    // The dock must close — not fall through to the BOTE panel (review P1).
    await expect(page.getByTestId('bote-panel')).not.toBeVisible();

    await page.screenshot({ path: path.join(RESULTS_DIR, 'no-bote-after-delete.png'), fullPage: true });
  });

  test('"Apply to traffic profile" writes a two-phase profile the traffic panel reflects', async ({ page }) => {
    await openCanvasFreeform(page);
    await expandTrafficEditor(page);
    await page.getByTestId('traffic-open-bote').click();
    await expect(page.getByTestId('bote-panel')).toBeVisible();

    await page.getByTestId('bote-apply').click();

    // Store-level assertion: two phases, steady baseline then spike to 3×.
    const profile = await page.evaluate(() => {
      const store = (window as any).__SYSTEMSIM_STORE__;
      return store.getState().trafficProfile;
    });
    expect(profile.profileName).toBe('BOTE estimate');
    expect(profile.phases).toHaveLength(2);
    expect(profile.phases[0].shape).toBe('steady');
    expect(profile.phases[0].rps).toBe(116);
    expect(profile.phases[1].shape).toBe('spike');
    expect(profile.phases[1].rps).toBe(347);

    // UI-level assertion: the traffic editor's draft re-seeded from the
    // applied profile (the sidebar switched to the Traffic tab on apply).
    // Read live input values — attribute selectors (input[value*=...]) go
    // stale on controlled inputs that React reuses across re-seeds.
    await expect(page.getByTestId('traffic-editor-toggle')).toBeVisible();
    await expect.poll(async () => {
      const values = await page.locator('input').evaluateAll(
        (els) => els.map((el) => (el as HTMLInputElement).value),
      );
      return values.some((v) => v.includes('Baseline average'));
    }).toBe(true);

    await page.screenshot({ path: path.join(RESULTS_DIR, 'bote-applied-to-traffic.png'), fullPage: true });
  });
});
