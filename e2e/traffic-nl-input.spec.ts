/**
 * @file e2e/traffic-nl-input.spec.ts
 *
 * Phase B3 coverage: natural-language traffic description → Generate →
 * TrafficProfile applied to the editor + store. The Edge Function is
 * stubbed at the fetch layer so the test doesn't hit Anthropic.
 */

import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RESULTS_DIR = path.join(__dirname, '..', 'test-results', 'traffic-nl-input');

function ensureDir(dir: string) { fs.mkdirSync(dir, { recursive: true }); }

const FAKE_PROFILE = {
  profileName: 'nl_generated',
  durationSeconds: 45,
  phases: [
    { startS: 0, endS: 15, rps: 500, shape: 'steady', description: 'Warm-up' },
    { startS: 15, endS: 20, rps: 8000, shape: 'instant_spike', description: 'Spike' },
    { startS: 20, endS: 45, rps: 500, shape: 'ramp_down', description: 'Recover' },
  ],
  requestMix: { default: 1.0 },
  userDistribution: 'uniform',
  jitterPercent: 15,
  promptVersion: '2026-04-18.1',
};

async function openTrafficEditor(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.waitForSelector('text=Or start from a template');
  await page.click('button:has-text("Basic CRUD App")');
  await page.waitForSelector('.react-flow__node', { timeout: 5000 });
  await page.evaluate(() => {
    const store = (window as any).__SYSTEMSIM_STORE__;
    store.getState().setAppMode('freeform');
    store.getState().setSidebarTab('traffic');
  });
  await page.getByTestId('traffic-editor-toggle').click();
  await page.waitForSelector('[data-testid="nl-traffic-input"]', { timeout: 3000 });
}

test.describe('NL traffic input', () => {
  test.setTimeout(45000);
  test.beforeAll(() => ensureDir(RESULTS_DIR));

  test('success: description → profile applied to editor + store', async ({ page }) => {
    await page.route('**/api/traffic-intent', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FAKE_PROFILE) });
    });
    await openTrafficEditor(page);
    await page.getByTestId('nl-traffic-textarea').fill('ramp to 500 rps, spike to 8000 for 5s, cool down');
    await page.getByTestId('nl-traffic-generate').click();

    // Wait for the store's trafficProfile to reflect the NL-generated one
    await page.waitForFunction(() => {
      const s = (window as any).__SYSTEMSIM_STORE__.getState();
      return s.trafficProfile?.profileName === 'nl_generated';
    }, { timeout: 4000 });

    const applied = await page.evaluate(() => {
      const s = (window as any).__SYSTEMSIM_STORE__.getState();
      return s.trafficProfile;
    });
    expect(applied.profileName).toBe('nl_generated');
    expect(applied.phases).toHaveLength(3);
    await page.screenshot({ path: path.join(RESULTS_DIR, 'applied.png'), fullPage: true });
  });

  test('error: server 500 surfaces an inline error', async ({ page }) => {
    await page.route('**/api/traffic-intent', async (route) => {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: true, kind: 'api_error', message: 'Upstream failure' }) });
    });
    await openTrafficEditor(page);
    await page.getByTestId('nl-traffic-textarea').fill('anything');
    await page.getByTestId('nl-traffic-generate').click();
    await expect(page.getByTestId('nl-traffic-error')).toBeVisible({ timeout: 3000 });
    await page.screenshot({ path: path.join(RESULTS_DIR, 'error.png'), fullPage: true });
  });

  test('rate-limit (429) surfaces as an error without crashing', async ({ page }) => {
    await page.route('**/api/traffic-intent', async (route) => {
      await route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: true, kind: 'rate_limit', message: 'Too many requests' }) });
    });
    await openTrafficEditor(page);
    await page.getByTestId('nl-traffic-textarea').fill('anything');
    await page.getByTestId('nl-traffic-generate').click();
    await expect(page.getByTestId('nl-traffic-error')).toBeVisible({ timeout: 3000 });
  });

  test('Generate button disabled while loading', async ({ page }) => {
    // Delay the response so we can assert the loading state
    await page.route('**/api/traffic-intent', async (route) => {
      await new Promise((r) => setTimeout(r, 600));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FAKE_PROFILE) });
    });
    await openTrafficEditor(page);
    await page.getByTestId('nl-traffic-textarea').fill('ramp then spike');
    const btn = page.getByTestId('nl-traffic-generate');
    await btn.click();
    await expect(btn).toBeDisabled();
    await expect(btn).toContainText('Parsing');
    // Wait for success
    await page.waitForFunction(() => {
      const s = (window as any).__SYSTEMSIM_STORE__.getState();
      return s.trafficProfile?.profileName === 'nl_generated';
    }, { timeout: 4000 });
  });
});
