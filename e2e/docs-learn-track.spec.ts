/**
 * @file e2e/docs-learn-track.spec.ts
 *
 * Phase A-content / P3 coverage: the Learn tab is populated with 18
 * hand-written user-manual pages, ordered via USER_GUIDE_ORDER. Confirms
 * nav items render, body renders via MarkdownBody, and deep-linking
 * works for a Learn topic.
 */

import { test, expect, type Page } from '@playwright/test';

async function openLearnTab(page: Page) {
  await page.goto('/');
  await page.waitForSelector('text=Or start from a template');
  await page.evaluate(() => (window as any).__SYSTEMSIM_STORE__.getState().openWiki('userGuide.welcome'));
  await page.waitForSelector('[data-testid="docs-tabs"]');
}

test.describe('Docs Learn track', () => {
  test.setTimeout(45000);

  test('Learn tab populated with ≥18 items; Welcome renders as markdown', async ({ page }) => {
    await openLearnTab(page);
    const group = page.getByTestId('wiki-nav-group-userGuide');
    await expect(group).toBeVisible();
    const items = group.getByTestId('wiki-nav-item');
    expect(await items.count()).toBeGreaterThanOrEqual(18);
    const body = page.getByTestId('docs-markdown');
    await expect(body).toBeVisible();
    await expect(body).toContainText('Welcome to SystemSim');
  });

  test('deep-link to a Learn topic sets hash and focuses body', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('text=Or start from a template');
    await page.evaluate(() => (window as any).__SYSTEMSIM_STORE__.getState().openWiki('userGuide.running-a-simulation'));
    await page.waitForSelector('[data-testid="docs-markdown"]');
    await expect.poll(() => page.evaluate(() => window.location.hash)).toContain('#docs/learn/running-a-simulation');
    await expect(page.getByTestId('docs-markdown')).toContainText('Run button');
  });

  test('landing page "Learn SystemSim" button opens the Welcome page', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('text=Or start from a template');
    await page.getByTestId('landing-learn').click();
    await page.waitForSelector('[data-testid="docs-markdown"]');
    const body = page.getByTestId('docs-markdown');
    await expect(body).toContainText('Welcome to SystemSim');
  });
});
