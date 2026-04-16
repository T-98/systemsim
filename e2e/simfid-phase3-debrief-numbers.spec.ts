import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RESULTS_DIR = path.join(__dirname, '..', 'test-results', 'simfid-phase3');

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

async function setupScenario(page: Page, opts: {
  serverInstances: number;
  serverProcessingMs: number;
  trafficRps: number;
  trafficDuration: number;
}) {
  await page.goto('/');
  await page.waitForSelector('text=Or start from a template');
  await page.click('button:has-text("Basic CRUD App")');
  await page.waitForSelector('.react-flow__node', { timeout: 5000 });

  await page.evaluate((o) => {
    const store = (window as any).__SYSTEMSIM_STORE__;
    if (!store) return;
    const state = store.getState();

    const serverNode = state.nodes.find((n: any) => n.data.type === 'server');
    if (serverNode) {
      store.getState().updateComponentConfig(serverNode.id, {
        instanceCount: o.serverInstances,
        processingTimeMs: o.serverProcessingMs,
      });
    }

    const lbNode = state.nodes.find((n: any) => n.data.type === 'load_balancer');
    if (lbNode) {
      store.getState().updateComponentConfig(lbNode.id, { isEntry: true });
    }

    store.getState().setTrafficProfile({
      profileName: 'test',
      durationSeconds: o.trafficDuration,
      phases: [{ startS: 0, endS: o.trafficDuration, rps: o.trafficRps, shape: 'steady', description: 'test' }],
      requestMix: { default: 1.0 },
      userDistribution: 'uniform',
      jitterPercent: 0,
    });

    const dbNode = state.nodes.find((n: any) => n.data.type === 'database');
    const sNode = state.nodes.find((n: any) => n.data.type === 'server');
    store.getState().setSchemaMemory({
      version: 1,
      entities: [{
        id: 'e1', name: 'items', fields: [{ name: 'id', type: 'uuid', cardinality: 'high' }],
        indexes: [{ field: 'id', type: 'btree' }], accessPatterns: [], assignedDbId: dbNode?.id ?? null,
      }],
      relationships: [],
      aiNotes: '',
    });
    if (sNode) {
      store.getState().setApiContracts([{
        id: 'c1', method: 'GET', path: '/items', description: 'test',
        authMode: 'none', ownerServiceId: sNode.id,
      }]);
    }
  }, opts);

  await page.waitForTimeout(300);
}

async function runToCompletion(page: Page, runButtonLabel: 'Run' | 'Run Stressed') {
  const speedButton = page.locator('button:has-text("10x")');
  if (await speedButton.isVisible()) await speedButton.click();

  const runButton = page.getByRole('button', { name: runButtonLabel, exact: true });
  await expect(runButton).toBeEnabled({ timeout: 5000 });
  await runButton.click();

  const toolbarDebrief = page.locator('button:has-text("Debrief")').first();
  await expect(toolbarDebrief).toBeVisible({ timeout: 120000 });
  await toolbarDebrief.click();
  await page.waitForTimeout(500);
}

test.describe('SIMFID Phase 3 — Real numbers, stressed runs, saturation callouts', () => {
  test.setTimeout(60000);
  test.beforeAll(() => ensureDir(RESULTS_DIR));

  test('debrief shows per-component table with sorted rows and real numbers', async ({ page }) => {
    const dir = path.join(RESULTS_DIR, 'per-component-table');
    ensureDir(dir);

    // Moderate load → non-crashing run with real metrics
    await setupScenario(page, {
      serverInstances: 2,
      serverProcessingMs: 50,
      trafficRps: 30,
      trafficDuration: 8,
    });

    await runToCompletion(page, 'Run');

    // Table should exist inside the debrief tab of the bottom panel
    const table = page.getByTestId('per-component-table');
    await expect(table).toBeVisible();

    // Expect at least 3 components (LB + server + DB from Basic CRUD template)
    const rows = table.locator('tbody tr');
    await expect(rows).toHaveCount(await rows.count());
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThanOrEqual(3);

    // Extract p99 values (column index 2: Component, p50, p99, ρ, Errors, Peak Queue)
    const p99Values: number[] = [];
    for (let i = 0; i < rowCount; i++) {
      const p99Text = await rows.nth(i).locator('td').nth(2).innerText();
      const n = parseInt(p99Text.replace(/[^\d]/g, ''), 10);
      p99Values.push(isNaN(n) ? 0 : n);
    }
    // Sorted desc
    for (let i = 1; i < p99Values.length; i++) {
      expect(p99Values[i - 1]).toBeGreaterThanOrEqual(p99Values[i]);
    }

    // Score badges must NOT contain literal "Pass" / "Warn" / "Fail"
    const bottomPanel = page.getByTestId('bottom-panel');
    const panelText = await bottomPanel.innerText();
    expect(panelText).not.toMatch(/\b(Pass|Warn|Fail)\b/);

    await page.screenshot({ path: path.join(dir, 'debrief-with-table.png') });
  });

  test('Run Stressed button triggers stressed run and shows badge', async ({ page }) => {
    const dir = path.join(RESULTS_DIR, 'run-stressed');
    ensureDir(dir);

    await setupScenario(page, {
      serverInstances: 3,
      serverProcessingMs: 30,
      trafficRps: 20,
      trafficDuration: 6,
    });

    // Button should be present
    const stressedBtn = page.locator('button:has-text("Run Stressed")');
    await expect(stressedBtn).toBeVisible();
    await expect(stressedBtn).toBeEnabled();

    await page.screenshot({ path: path.join(dir, 'toolbar-with-stressed-button.png') });

    await runToCompletion(page, 'Run Stressed');

    // Stressed badge should be visible in the debrief
    const badge = page.getByTestId('stressed-badge');
    await expect(badge).toBeVisible();
    await expect(badge).toContainText(/stressed run/i);

    await page.screenshot({ path: path.join(dir, 'debrief-stressed.png') });
  });

  test('normal run does NOT show stressed badge', async ({ page }) => {
    const dir = path.join(RESULTS_DIR, 'normal-no-badge');
    ensureDir(dir);

    await setupScenario(page, {
      serverInstances: 3,
      serverProcessingMs: 30,
      trafficRps: 20,
      trafficDuration: 6,
    });

    await runToCompletion(page, 'Run');

    const badge = page.getByTestId('stressed-badge');
    await expect(badge).not.toBeVisible();
  });

  test('saturation callout appears in live log when server hits ρ ≥ 0.85', async ({ page }) => {
    const dir = path.join(RESULTS_DIR, 'saturation-callout');
    ensureDir(dir);

    // Server capacity: 1 instance × (1000/50) = 20 RPS. 18 RPS → ρ = 0.9
    await setupScenario(page, {
      serverInstances: 1,
      serverProcessingMs: 50,
      trafficRps: 18,
      trafficDuration: 8,
    });

    await runToCompletion(page, 'Run');

    // Switch to Live Log tab
    const logTab = page.locator('button:has-text("Live Log")').first();
    await logTab.click();
    await page.waitForTimeout(300);

    const panelText = await page.getByTestId('bottom-panel').innerText();
    expect(panelText).toMatch(/headroom before queueing collapse/);

    await page.screenshot({ path: path.join(dir, 'log-with-callout.png') });
  });
});
