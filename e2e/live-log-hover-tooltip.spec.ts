/**
 * @file e2e/live-log-hover-tooltip.spec.ts
 *
 * Phase C3 coverage: callout phrases in log messages get underlined +
 * gain an adjacent InfoIcon trigger that opens the topic popover on
 * click. "Learn more →" routes to the wiki on the right topic.
 */

import { test, expect, type Page } from '@playwright/test';

async function gotoCanvasWithLog(page: Page, entries: { time: number; message: string; severity: 'info' | 'warning' | 'critical'; componentId?: string }[]) {
  await page.goto('/');
  await page.waitForSelector('text=Or start from a template');
  await page.click('button:has-text("Basic CRUD App")');
  await page.waitForSelector('.react-flow__node', { timeout: 5000 });
  await page.evaluate((es) => {
    const s = (window as any).__SYSTEMSIM_STORE__.getState();
    s.setBottomPanelOpen(true);
    s.clearLiveLog();
    for (const e of es) s.addLogEntry(e);
  }, entries);
  await page.waitForSelector('[data-testid="log-filter"]', { timeout: 3000 });
}

test.describe('Live log callout hover tooltips', () => {
  test.setTimeout(45000);

  test('circuit breaker phrase resolves to concept.circuitBreakerStates', async ({ page }) => {
    await gotoCanvasWithLog(page, [
      { time: 1, message: 'Circuit breaker opened on wire A→B', severity: 'critical', componentId: 'wire-1' },
    ]);
    const phrase = page.getByTestId('log-callout-phrase').first();
    await expect(phrase).toBeVisible();
    await expect(phrase).toHaveAttribute('data-topic', 'concept.circuitBreakerStates');
  });

  test('backpressure phrase resolves to concept.backpressure', async ({ page }) => {
    await gotoCanvasWithLog(page, [
      { time: 2, message: 'server-1 signaling backpressure (acceptanceRate=0.4)', severity: 'warning', componentId: 'server-1' },
    ]);
    const phrase = page.getByTestId('log-callout-phrase').first();
    await expect(phrase).toHaveAttribute('data-topic', 'concept.backpressure');
  });

  test('saturation ρ=0.92 resolves to concept.utilization', async ({ page }) => {
    await gotoCanvasWithLog(page, [
      { time: 3, message: 'server-1 hit ρ=0.92 at t=15s', severity: 'warning', componentId: 'server-1' },
    ]);
    const phrase = page.getByTestId('log-callout-phrase').first();
    await expect(phrase).toHaveAttribute('data-topic', 'concept.utilization');
  });

  test('clicking the callout info-icon opens popover and routes to wiki', async ({ page }) => {
    await gotoCanvasWithLog(page, [
      { time: 4, message: 'Retry storm amplifying downstream load', severity: 'warning', componentId: 'server-1' },
    ]);
    // The info-icon adjacent to the phrase is specifically scoped inside the callout span.
    const phraseIcon = page.locator('[data-testid="log-callout-phrase"] [data-testid="info-icon"]').first();
    await phraseIcon.click();
    const popover = page.getByTestId('info-popover');
    await expect(popover).toBeVisible();

    await page.getByTestId('info-learn-more').click();
    await page.waitForSelector('[data-testid="wiki-nav"]', { timeout: 3000 });
    const body = page.getByTestId('wiki-body');
    await expect(body).toHaveAttribute('data-topic', 'concept.retryStorm');
  });

  test('messages without a known phrase render as plain text (no phrase element)', async ({ page }) => {
    await gotoCanvasWithLog(page, [
      { time: 1, message: 'Sim started at t=0', severity: 'info' },
    ]);
    // Expect no callout phrase span in this row
    await expect(page.getByTestId('log-callout-phrase')).toHaveCount(0);
  });
});
