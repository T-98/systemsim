import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RESULTS_DIR = path.join(__dirname, '..', 'test-results', 'chaos-drill');

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

async function openChaosDrill(page: Page) {
  await page.goto('/');
  await page.waitForSelector('text=Or start from a template');
  await page.click('button:has-text("Chaos Drill")');
  await page.waitForSelector('.react-flow__node', { timeout: 5000 });
}

test.describe('Chaos Drill — the spark demo', () => {
  test.setTimeout(120000);
  test.beforeAll(() => ensureDir(RESULTS_DIR));

  test('template is run-ready and Kill appears only during a run', async ({ page }) => {
    await openChaosDrill(page);

    const runButton = page.getByRole('button', { name: 'Run', exact: true });
    await expect(runButton).toBeEnabled();

    // Pre-run hover shows the info icon, not Kill (and the icon proves the
    // hover registered — keeps this from passing if the feature vanishes).
    const replicaB = page.locator('.react-flow__node', { hasText: 'Replica B' });
    await replicaB.hover();
    await expect(replicaB.getByTestId('node-info-badge')).toBeVisible();
    await expect(page.getByTestId('chaos-kill')).toHaveCount(0);

    await page.screenshot({ path: path.join(RESULTS_DIR, '01-run-ready.png'), fullPage: true });
  });

  test('kill a replica mid-run → cascade; revive → recovery', async ({ page }) => {
    await openChaosDrill(page);

    // Slow ticks down for deterministic interaction (1x = 1 tick/s).
    await page.locator('button:has-text("1x")').click();
    await page.getByRole('button', { name: 'Run', exact: true }).click();

    // Let the steady state establish (both replicas ~75% util, healthy).
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(RESULTS_DIR, '02-steady-state.png'), fullPage: true });

    // The kill: hover Replica B, hit the Kill pill.
    const replicaB = page.locator('.react-flow__node', { hasText: 'Replica B' });
    await replicaB.hover();
    const kill = page.getByTestId('chaos-kill');
    await expect(kill).toBeVisible();
    await kill.click();

    // Crash lands on the next tick: badge + chaos log line. Scope to the
    // killed node — the cascade is real enough that the SURVIVOR can also
    // crash from the redistributed load within a few ticks.
    await expect(replicaB.getByTestId('crashed-badge')).toBeVisible({ timeout: 5000 });
    await page.locator('button:has-text("Live Log")').first().click();
    await expect(page.getByTestId('bottom-panel')).toContainText('CHAOS — ', { timeout: 5000 });

    // The cascade: survivor saturates hard — assert a REAL error percentage
    // (≥20%), not just the presence of an Err row (review P2).
    const replicaA = page.locator('.react-flow__node', { hasText: 'Replica A' });
    await expect(replicaA).toContainText(/Err\s*([2-9]\d|1\d\d)(\.\d)?%/, { timeout: 10000 });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(RESULTS_DIR, '03-cascade.png'), fullPage: true });

    // The recovery: hover the corpse, the badge becomes Revive, click it.
    await replicaB.hover();
    const badge = replicaB.getByTestId('crashed-badge');
    await expect(badge).toContainText('Revive');
    await badge.click();

    // Revival lands next tick: B's badge gone, revive log line present.
    await expect(replicaB.getByTestId('crashed-badge')).toHaveCount(0, { timeout: 5000 });
    await expect(page.getByTestId('bottom-panel')).toContainText('revived', { timeout: 5000 });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(RESULTS_DIR, '04-recovery.png'), fullPage: true });
  });

  test('kill is engine-real: survivor takes double load (store metrics)', async ({ page }) => {
    await openChaosDrill(page);
    await page.locator('button:has-text("10x")').click();
    await page.getByRole('button', { name: 'Run', exact: true }).click();
    await page.waitForTimeout(1500);

    const ids = await page.evaluate(() => {
      const s = (window as any).__SYSTEMSIM_STORE__.getState();
      const a = s.nodes.find((n: any) => n.data.label === 'Replica A').id;
      const b = s.nodes.find((n: any) => n.data.label === 'Replica B').id;
      return { a, b };
    });

    // Kill B through the same handle the UI uses.
    await page.evaluate(() => {
      const s = (window as any).__SYSTEMSIM_STORE__.getState();
      const b = s.nodes.find((n: any) => n.data.label === 'Replica B').id;
      (window as any).__SYSTEMSIM_CHAOS__.kill(b);
    });
    await page.waitForTimeout(1500);

    const after = await page.evaluate(({ a, b }) => {
      const s = (window as any).__SYSTEMSIM_STORE__.getState();
      return { aRps: s.liveMetrics[a]?.rps ?? 0, bHealth: s.nodes.find((n: any) => n.id === b).data.health };
    }, ids);

    expect(after.bHealth).toBe('crashed');
    expect(after.aRps).toBeGreaterThan(45); // ~60 RPS shifted onto A (was ~30)
  });
});
