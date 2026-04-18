/**
 * @file e2e/docs-search-cmdk.spec.ts
 *
 * Phase A-content / P5 coverage: ⌘K opens a global command palette that
 * searches across all topics (Learn / Reference / How-to / component /
 * concept / config / severity). Enter opens the selected topic.
 */

import { test, expect, type Page } from '@playwright/test';

async function gotoCanvasWithNodes(page: Page) {
  await page.goto('/');
  await page.waitForSelector('text=Or start from a template');
  await page.click('button:has-text("Basic CRUD App")');
  await page.waitForSelector('.react-flow__node', { timeout: 5000 });
}

test.describe('Docs ⌘K search', () => {
  test.setTimeout(45000);

  test('Cmd+K opens the palette from the canvas', async ({ page }) => {
    await gotoCanvasWithNodes(page);
    await page.keyboard.press('Meta+k');
    await expect(page.getByTestId('command-palette')).toBeVisible();
    await expect(page.getByTestId('command-palette-input')).toBeFocused();
    // Default view shows curated Learn + Reference + How-to items.
    expect(await page.getByTestId('command-palette-item').count()).toBeGreaterThan(4);
  });

  test('Typing narrows; Enter opens the wiki on the selected topic', async ({ page }) => {
    await gotoCanvasWithNodes(page);
    await page.keyboard.press('Meta+k');
    await page.getByTestId('command-palette-input').fill('circuit breaker');
    // Wait for results to populate with matching topics
    await expect(page.getByTestId('command-palette-item').first()).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('docs-markdown')).toBeVisible();
    const body = page.getByTestId('docs-markdown');
    await expect(body).toContainText('CLOSED');
  });

  test('Escape closes the palette', async ({ page }) => {
    await gotoCanvasWithNodes(page);
    await page.keyboard.press('Meta+k');
    await expect(page.getByTestId('command-palette')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('command-palette')).toHaveCount(0);
  });

  test('ArrowDown + Enter opens second result', async ({ page }) => {
    await gotoCanvasWithNodes(page);
    await page.keyboard.press('Meta+k');
    await page.getByTestId('command-palette-input').fill('cache');
    await expect(page.getByTestId('command-palette-item').first()).toBeVisible();
    await page.keyboard.press('ArrowDown');
    const selected = page.locator('[data-testid="command-palette-item"][data-selected="true"]');
    expect(await selected.count()).toBe(1);
    await page.keyboard.press('Enter');
    // A Cache-tagged second result may be a `component.*` stub (empty body) or
    // a `reference.*` full section. Either way the wiki article wrapper renders;
    // assert that instead of the markdown-only body.
    await expect(page.getByTestId('wiki-body')).toBeVisible();
  });
});
