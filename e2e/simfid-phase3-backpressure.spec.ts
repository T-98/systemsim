import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RESULTS_DIR = path.join(__dirname, '..', 'test-results', 'simfid-phase3-backpressure');

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

async function setupBackpressureScenario(page: Page) {
  await page.goto('/');
  await page.waitForSelector('text=Or start from a template');
  await page.click('button:has-text("Basic CRUD App")');
  await page.waitForSelector('.react-flow__node', { timeout: 5000 });

  await page.evaluate(() => {
    const store = (window as any).__SYSTEMSIM_STORE__;
    if (!store) return;
    const state = store.getState();
    const serverNode = state.nodes.find((n: any) => n.data.type === 'server');
    const lbNode = state.nodes.find((n: any) => n.data.type === 'load_balancer');
    const dbNode = state.nodes.find((n: any) => n.data.type === 'database');

    // Enable backpressure on the DB, which is the saturated downstream.
    // Low throughput + high traffic → DB errorRate climbs → acceptanceRate drops.
    if (serverNode) {
      store.getState().updateComponentConfig(serverNode.id, {
        instanceCount: 10,
        processingTimeMs: 10,
      });
    }
    if (dbNode) {
      store.getState().updateComponentConfig(dbNode.id, {
        writeThroughputRps: 2,
        readThroughputRps: 2,
        readReplicas: 0,
        connectionPoolSize: 30,
        backpressure: { enabled: true },
      });
    }
    if (lbNode) store.getState().updateComponentConfig(lbNode.id, { isEntry: true });

    store.getState().setTrafficProfile({
      profileName: 'backpressure',
      durationSeconds: 15,
      phases: [{ startS: 0, endS: 15, rps: 40, shape: 'steady', description: 'sustained load' }],
      requestMix: { default: 1.0 },
      userDistribution: 'uniform',
      jitterPercent: 0,
    });

    store.getState().setSchemaMemory({
      version: 1,
      entities: [{
        id: 'e1', name: 'items', fields: [{ name: 'id', type: 'uuid', cardinality: 'high' }],
        indexes: [{ field: 'id', type: 'btree' }], accessPatterns: [], assignedDbId: dbNode?.id ?? null,
      }],
      relationships: [],
      aiNotes: '',
    });
    if (serverNode) {
      store.getState().setApiContracts([{
        id: 'c1', method: 'GET', path: '/items', description: 'test',
        authMode: 'none', ownerServiceId: serverNode.id,
      }]);
    }
  });
  await page.waitForTimeout(300);
}

test.describe('SIMFID Phase 3 — Backpressure', () => {
  test.setTimeout(60000);
  test.beforeAll(() => ensureDir(RESULTS_DIR));

  test('backpressure callout appears in live log when acceptanceRate drops below 0.7', async ({ page }) => {
    const dir = path.join(RESULTS_DIR, 'callout');
    ensureDir(dir);

    await setupBackpressureScenario(page);

    const speed10x = page.locator('button:has-text("10x")');
    if (await speed10x.isVisible()) await speed10x.click();

    const runButton = page.getByRole('button', { name: 'Run', exact: true });
    await expect(runButton).toBeEnabled({ timeout: 5000 });
    await runButton.click();

    const toolbarDebrief = page.locator('button:has-text("Debrief")').first();
    await expect(toolbarDebrief).toBeVisible({ timeout: 120000 });

    const logTab = page.locator('button:has-text("Live Log")').first();
    await logTab.click();
    await page.waitForTimeout(300);

    const panelText = await page.getByTestId('bottom-panel').innerText();
    expect(panelText).toMatch(/signaling backpressure/);

    await page.screenshot({ path: path.join(dir, 'log-with-backpressure.png') });
  });
});
