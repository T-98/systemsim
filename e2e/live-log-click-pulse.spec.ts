/**
 * @file e2e/live-log-click-pulse.spec.ts
 *
 * Phase C2 coverage: clicking a log row with a `componentId` sets
 * pulseTarget=`node:${id}` so the canvas node flashes, then auto-clears
 * after ~600ms. Rows without a componentId do not pulse.
 */

import { test, expect, type Page } from '@playwright/test';

async function gotoCanvasWithNodes(page: Page) {
  await page.goto('/');
  await page.waitForSelector('text=Or start from a template');
  await page.click('button:has-text("Basic CRUD App")');
  await page.waitForSelector('.react-flow__node', { timeout: 5000 });
  await page.evaluate(() => {
    (window as any).__SYSTEMSIM_STORE__.getState().setBottomPanelOpen(true);
  });
  await page.waitForSelector('[data-testid="log-filter"]', { timeout: 3000 });
}

test.describe('Live log click → canvas pulse', () => {
  test.setTimeout(45000);

  test('click row with componentId sets pulseTarget, then clears', async ({ page }) => {
    await gotoCanvasWithNodes(page);
    const firstNodeId = await page.evaluate(() => {
      const s = (window as any).__SYSTEMSIM_STORE__.getState();
      return s.nodes[0].id as string;
    });

    await page.evaluate((id) => {
      const s = (window as any).__SYSTEMSIM_STORE__.getState();
      s.clearLiveLog();
      s.addLogEntry({ time: 1, message: 'cache miss storm at Cache-1', severity: 'warning', componentId: id });
    }, firstNodeId);

    await page.getByTestId('log-row').first().click();

    // Pulse target should be set immediately
    const target = await page.evaluate(() => (window as any).__SYSTEMSIM_STORE__.getState().pulseTarget);
    expect(target).toMatch(/^node:/);
    expect(target).toContain(firstNodeId);

    // Selected node should be set too (for the ConfigPanel to show up)
    const selected = await page.evaluate(() => (window as any).__SYSTEMSIM_STORE__.getState().selectedNodeId);
    expect(selected).toBe(firstNodeId);

    // Pulse clears after ~600ms (we wait 1s to be safe)
    await page.waitForFunction(
      () => (window as any).__SYSTEMSIM_STORE__.getState().pulseTarget === null,
      { timeout: 2000 }
    );
  });

  test('row without componentId does not pulse', async ({ page }) => {
    await gotoCanvasWithNodes(page);
    await page.evaluate(() => {
      const s = (window as any).__SYSTEMSIM_STORE__.getState();
      s.clearLiveLog();
      s.addLogEntry({ time: 1, message: 'sim started', severity: 'info' });
      s.setPulseTarget(null);
    });
    await page.getByTestId('log-row').first().click();
    await page.waitForTimeout(100);
    const target = await page.evaluate(() => (window as any).__SYSTEMSIM_STORE__.getState().pulseTarget);
    expect(target).toBeNull();
  });

  test('clicking the info-icon inside a row does not trigger pulse', async ({ page }) => {
    await gotoCanvasWithNodes(page);
    const firstNodeId = await page.evaluate(() => (window as any).__SYSTEMSIM_STORE__.getState().nodes[0].id as string);
    await page.evaluate((id) => {
      const s = (window as any).__SYSTEMSIM_STORE__.getState();
      s.clearLiveLog();
      s.addLogEntry({ time: 1, message: 'note', severity: 'info', componentId: id });
      s.setPulseTarget(null);
    }, firstNodeId);

    // The info-icon (severity) is inside the row but should stopPropagation so the row click doesn't fire.
    await page.getByTestId('info-icon').first().click();
    const target = await page.evaluate(() => (window as any).__SYSTEMSIM_STORE__.getState().pulseTarget);
    expect(target).toBeNull();
  });
});
