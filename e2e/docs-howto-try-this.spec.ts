/**
 * @file e2e/docs-howto-try-this.spec.ts
 *
 * Phase A-content / P4 coverage: how-to pages render the CanvasEmbed
 * preview, the "Take to canvas" button loads the template into the
 * main canvas, and the app navigates to the canvas view with the
 * loaded graph.
 */

import { test, expect, type Page } from '@playwright/test';

async function openHowtoTab(page: Page, slug: string) {
  await page.goto('/');
  await page.waitForSelector('text=Or start from a template');
  await page.evaluate((key) => {
    (window as any).__SYSTEMSIM_STORE__.getState().openWiki(key);
  }, `howto.${slug}`);
  await page.waitForSelector('[data-testid="docs-tabs"]');
  await expect(page.locator('[data-testid="docs-tab-howto"][data-active="true"]')).toBeVisible();
}

test.describe('Docs How-to tab + CanvasEmbed', () => {
  test.setTimeout(60000);

  test('How-to cacheStampede renders an embed and markdown body', async ({ page }) => {
    await openHowtoTab(page, 'cacheStampede');
    await expect(page.getByTestId('docs-markdown')).toBeVisible();
    // Wait for the embed to load (async fetch of the template JSON)
    await expect(page.getByTestId('canvas-embed')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('canvas-embed')).toHaveAttribute('data-template', 'cacheStampede');
    // "Run inline" is the disabled stub (deferred).
    await expect(page.getByTestId('canvas-embed-run-inline')).toBeDisabled();
  });

  test('Take to canvas replaces main graph and switches to canvas view', async ({ page }) => {
    await openHowtoTab(page, 'retryStorm');
    await page.getByTestId('canvas-embed').waitFor({ state: 'visible' });
    await page.getByTestId('canvas-embed-take-to-canvas').click();
    // Expect to land on the canvas (fleshed-out UI) with nodes rendered from the template
    await page.waitForSelector('.react-flow__node', { timeout: 4000 });
    const appView = await page.evaluate(() => (window as any).__SYSTEMSIM_STORE__.getState().appView);
    expect(appView).toBe('canvas');
    // The retry-storm template's first node is a load_balancer labeled "Edge LB"
    const firstNode = await page.locator('.react-flow__node').first().textContent();
    expect(firstNode).toContain('Edge LB');
  });

  test('all 5 how-to templates render without error', async ({ page }) => {
    for (const slug of ['cacheStampede', 'hotShard', 'retryStorm', 'breakerTrip', 'backpressurePropagation']) {
      await openHowtoTab(page, slug);
      await page.getByTestId('canvas-embed').waitFor({ state: 'visible', timeout: 5000 });
      await expect(page.getByTestId('canvas-embed-error')).toHaveCount(0);
    }
  });
});
