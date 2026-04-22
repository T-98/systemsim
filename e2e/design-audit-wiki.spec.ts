// Visual-audit screenshot harness for wiki + landing polish.
// Usage: pnpm exec playwright test e2e/design-audit-wiki.spec.ts
// Not part of regression suite — writes screenshots under test-results/design-audit-wiki/.
import { test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUT = path.join(__dirname, '..', 'test-results', 'design-audit-wiki');

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => fs.mkdirSync(OUT, { recursive: true }));

async function setTheme(page: any, mode: 'light' | 'dark') {
  await page.evaluate((m: string) => {
    const html = document.documentElement;
    if (m === 'dark') html.classList.add('dark');
    else html.classList.remove('dark');
    localStorage.setItem('systemsim-theme', m);
  }, mode);
}

for (const theme of ['light', 'dark'] as const) {
  test(`landing — ${theme} — 1440`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await setTheme(page, theme);
    await page.waitForSelector('[data-testid="landing-nav"]');
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, `landing-${theme}-1440.png`), fullPage: false });
  });

  test(`wiki learn — welcome — ${theme} — 1440`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await setTheme(page, theme);
    await page.evaluate(() => {
      (window as any).__SYSTEMSIM_STORE__.getState().openWiki('userGuide.welcome');
    });
    await page.waitForSelector('[data-testid="wiki-nav"]');
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, `wiki-learn-welcome-${theme}-1440.png`) });
  });

  test(`wiki reference — circuit breaker — ${theme} — 1440`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await setTheme(page, theme);
    await page.evaluate(() => {
      const s = (window as any).__SYSTEMSIM_STORE__.getState();
      s.openWiki('reference.40-circuit-breaker-state-machine');
    });
    await page.waitForSelector('[data-testid="wiki-main"]');
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, `wiki-ref-circuit-${theme}-1440.png`) });
  });

  test(`wiki howto — cache stampede — ${theme} — 1440`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await setTheme(page, theme);
    await page.evaluate(() => {
      (window as any).__SYSTEMSIM_STORE__.getState().openWiki('howto.cacheStampede');
    });
    await page.waitForSelector('[data-testid="wiki-main"]');
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(OUT, `wiki-howto-cache-${theme}-1440.png`) });
  });
}

test('wiki learn — narrow viewport hides TOC — light — 1024', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto('/');
  await page.evaluate(() => {
    (window as any).__SYSTEMSIM_STORE__.getState().openWiki('userGuide.welcome');
  });
  await page.waitForSelector('[data-testid="wiki-nav"]');
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, 'wiki-narrow-1024.png') });
});

test('cmdk palette open — light — 1440', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.evaluate(() => {
    (window as any).__SYSTEMSIM_STORE__.getState().openWiki('userGuide.welcome');
  });
  await page.waitForSelector('[data-testid="wiki-nav"]');
  await page.keyboard.press('Meta+k');
  await page.waitForSelector('[data-testid="command-palette"]');
  await page.getByTestId('command-palette-input').fill('cache');
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT, 'cmdk-open-1440.png') });
});
