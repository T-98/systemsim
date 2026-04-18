/**
 * @file e2e/live-log-grouping.spec.ts
 *
 * Phase C4 coverage: runs of ≥5 same-componentId + same-severity events
 * inside a 2-second window collapse into a single grouped row with a
 * chevron that expands to show the underlying events.
 */

import { test, expect, type Page } from '@playwright/test';

async function gotoCanvasWithNodes(page: Page) {
  await page.goto('/');
  await page.waitForSelector('text=Or start from a template');
  await page.click('button:has-text("Basic CRUD App")');
  await page.waitForSelector('.react-flow__node', { timeout: 5000 });
  await page.evaluate(() => (window as any).__SYSTEMSIM_STORE__.getState().setBottomPanelOpen(true));
  await page.waitForSelector('[data-testid="log-filter"]', { timeout: 3000 });
}

async function seedLogs(page: Page, entries: { time: number; message: string; severity: 'info' | 'warning' | 'critical'; componentId?: string }[]) {
  await page.evaluate((es) => {
    const s = (window as any).__SYSTEMSIM_STORE__.getState();
    s.clearLiveLog();
    for (const e of es) s.addLogEntry(e);
  }, entries);
}

test.describe('Live log grouping', () => {
  test.setTimeout(45000);

  test('6 same-component same-severity events in 2s window collapse to one group row', async ({ page }) => {
    await gotoCanvasWithNodes(page);
    await seedLogs(
      page,
      Array.from({ length: 6 }, (_, i) => ({
        time: 1 + i * 0.2,
        message: `server-1 warning ${i}`,
        severity: 'warning' as const,
        componentId: 'server-1',
      }))
    );

    await expect(page.getByTestId('log-group')).toHaveCount(1);
    await expect(page.getByTestId('log-group-header')).toContainText('6× server-1');
    // Individual rows hidden by default (collapsed)
    await expect(page.getByTestId('log-row')).toHaveCount(0);
  });

  test('expanding a group reveals its entries', async ({ page }) => {
    await gotoCanvasWithNodes(page);
    await seedLogs(
      page,
      Array.from({ length: 5 }, (_, i) => ({
        time: 1 + i * 0.2,
        message: `server-1 warning ${i}`,
        severity: 'warning' as const,
        componentId: 'server-1',
      }))
    );

    const group = page.getByTestId('log-group').first();
    await expect(group).toHaveAttribute('data-expanded', 'false');
    await page.getByTestId('log-group-header').click();
    await expect(group).toHaveAttribute('data-expanded', 'true');
    // 5 inner rows visible
    await expect(page.getByTestId('log-row')).toHaveCount(5);
  });

  test('fewer than minRun does not collapse', async ({ page }) => {
    await gotoCanvasWithNodes(page);
    await seedLogs(
      page,
      Array.from({ length: 4 }, (_, i) => ({
        time: 1 + i * 0.2,
        message: `server-1 warning ${i}`,
        severity: 'warning' as const,
        componentId: 'server-1',
      }))
    );
    await expect(page.getByTestId('log-group')).toHaveCount(0);
    await expect(page.getByTestId('log-row')).toHaveCount(4);
  });

  test('different severities break the group', async ({ page }) => {
    await gotoCanvasWithNodes(page);
    await seedLogs(page, [
      { time: 1.0, message: 'a', severity: 'warning', componentId: 'server-1' },
      { time: 1.2, message: 'b', severity: 'warning', componentId: 'server-1' },
      { time: 1.4, message: 'c', severity: 'critical', componentId: 'server-1' },
      { time: 1.6, message: 'd', severity: 'warning', componentId: 'server-1' },
      { time: 1.8, message: 'e', severity: 'warning', componentId: 'server-1' },
      { time: 2.0, message: 'f', severity: 'warning', componentId: 'server-1' },
    ]);
    // Only 2 warnings before the critical + 3 warnings after — neither hits minRun=5.
    await expect(page.getByTestId('log-group')).toHaveCount(0);
    await expect(page.getByTestId('log-row')).toHaveCount(6);
  });

  test('entries outside the 2s window break the group', async ({ page }) => {
    await gotoCanvasWithNodes(page);
    await seedLogs(page, [
      { time: 1.0, message: 'a', severity: 'warning', componentId: 'server-1' },
      { time: 1.3, message: 'b', severity: 'warning', componentId: 'server-1' },
      { time: 1.6, message: 'c', severity: 'warning', componentId: 'server-1' },
      { time: 1.9, message: 'd', severity: 'warning', componentId: 'server-1' },
      { time: 4.0, message: 'e (outside window)', severity: 'warning', componentId: 'server-1' },
      { time: 4.3, message: 'f', severity: 'warning', componentId: 'server-1' },
    ]);
    // 4 in window, 2 after — neither run hits minRun=5.
    await expect(page.getByTestId('log-group')).toHaveCount(0);
    await expect(page.getByTestId('log-row')).toHaveCount(6);
  });
});
