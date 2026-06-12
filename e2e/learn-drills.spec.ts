import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RESULTS_DIR = path.join(__dirname, '..', 'test-results', 'learn-drills');

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

async function gotoLanding(page: Page) {
  await page.goto('/');
  await page.waitForSelector('text=Or start from a template');
}

test.describe('Learn drills — the learning wedge', () => {
  test.setTimeout(180000);
  test.beforeAll(() => ensureDir(RESULTS_DIR));

  test('landing shows the Learn section with drill cards', async ({ page }) => {
    await gotoLanding(page);
    await expect(page.getByTestId('learn-section')).toBeVisible();
    await expect(page.getByTestId('drill-queue-backlog')).toBeVisible();
    await page.screenshot({ path: path.join(RESULTS_DIR, '01-landing-learn.png'), fullPage: true });
  });

  test('full arc: observe → diagnose (wrong, then right) → fix → verified pass', async ({ page }) => {
    await gotoLanding(page);

    // Stage the drill: broken graph + HUD + auto-run.
    await page.getByTestId('drill-queue-backlog').click();
    await expect(page.getByTestId('challenge-banner')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('challenge-banner')).toHaveAttribute('data-step', 'observe');

    // Auto-run started without any user click.
    await expect.poll(() =>
      page.evaluate(() => (window as any).__SYSTEMSIM_STORE__.getState().simulationStatus),
    { timeout: 10000 }).toBe('running');
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(RESULTS_DIR, '02-observe.png'), fullPage: true });

    // Move to diagnosis. A wrong answer teaches and does NOT unlock the fix.
    await page.getByTestId('challenge-to-diagnose').click();
    await expect(page.getByTestId('challenge-banner')).toHaveAttribute('data-step', 'diagnose');
    await page.getByTestId('diagnosis-max-depth').click();
    await expect(page.getByTestId('diagnosis-max-depth')).toContainText('buys minutes');
    await expect(page.getByTestId('challenge-to-fix')).toHaveCount(0);

    // The right answer unlocks the fix phase.
    await page.getByTestId('diagnosis-drain-rate').click();
    await expect(page.getByTestId('challenge-to-fix')).toBeVisible();
    await page.screenshot({ path: path.join(RESULTS_DIR, '03-diagnose.png'), fullPage: true });
    await page.getByTestId('challenge-to-fix').click();
    await expect(page.getByTestId('challenge-banner')).toHaveAttribute('data-step', 'fix');

    // Apply the fix the way a user would land it (config change on the queue),
    // wait out the observe run, then re-run at max speed.
    await page.evaluate(() => {
      const s = (window as any).__SYSTEMSIM_STORE__.getState();
      const q = s.nodes.find((n: any) => n.data.type === 'queue');
      s.updateComponentConfig(q.id, { consumersPerGroup: 10 });
    });
    await expect.poll(() =>
      page.evaluate(() => (window as any).__SYSTEMSIM_STORE__.getState().simulationStatus),
    { timeout: 150000 }).toBe('completed');

    await page.locator('button:has-text("10x")').click();
    await page.getByRole('button', { name: 'Run again' }).click();
    await expect.poll(() =>
      page.evaluate(() => (window as any).__SYSTEMSIM_STORE__.getState().simulationStatus),
    { timeout: 60000 }).toBe('completed');

    // The evaluator scored the run: all criteria green, drill passed.
    await expect(page.getByTestId('challenge-banner')).toHaveAttribute('data-step', 'passed', { timeout: 10000 });
    await expect(page.getByTestId('challenge-passed')).toBeVisible();
    await page.screenshot({ path: path.join(RESULTS_DIR, '04-passed.png'), fullPage: true });
  });

  test('a wrong fix does not pass — criteria show failures', async ({ page }) => {
    await gotoLanding(page);
    await page.getByTestId('drill-queue-backlog').click();
    await expect(page.getByTestId('challenge-banner')).toBeVisible({ timeout: 10000 });

    // Skip ahead: stop the observe run, jump to fix, change something useless.
    await page.evaluate(() => {
      const s = (window as any).__SYSTEMSIM_STORE__.getState();
      s.setChallengeStep('fix');
      const q = s.nodes.find((n: any) => n.data.type === 'queue');
      s.updateComponentConfig(q.id, { maxDepth: 1000000 }); // bigger buffer ≠ fix
    });
    await expect.poll(() =>
      page.evaluate(() => (window as any).__SYSTEMSIM_STORE__.getState().simulationStatus),
    { timeout: 150000 }).toBe('completed');

    await page.locator('button:has-text("10x")').click();
    await page.getByRole('button', { name: 'Run again' }).click();
    await expect.poll(() =>
      page.evaluate(() => (window as any).__SYSTEMSIM_STORE__.getState().simulationStatus),
    { timeout: 60000 }).toBe('completed');

    await expect(page.getByTestId('challenge-banner')).toHaveAttribute('data-step', 'fix');
    await expect(page.getByTestId('challenge-criteria')).toContainText('✕');
    await page.screenshot({ path: path.join(RESULTS_DIR, '05-wrong-fix.png'), fullPage: true });
  });

  test('Study link opens the KB section; Exit dismisses the drill', async ({ page }) => {
    await gotoLanding(page);
    await page.getByTestId('drill-queue-backlog').click();
    await expect(page.getByTestId('challenge-banner')).toBeVisible({ timeout: 10000 });

    await page.getByTestId('challenge-study').click();
    await expect(page.getByTestId('wiki-main')).toBeVisible({ timeout: 5000 });
    await page.getByTestId('wiki-back').click();

    await expect(page.getByTestId('challenge-banner')).toBeVisible();
    await page.getByTestId('challenge-exit').click();
    await expect(page.getByTestId('challenge-banner')).toHaveCount(0);
  });
});
