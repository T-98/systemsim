import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RESULTS_DIR = path.join(__dirname, '..', 'test-results', 'simfid-phase3-retry');

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

async function setupRetryScenario(page: Page) {
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

    // Give the server a retry policy. Downstream DB will error under load,
    // driving retry amplification.
    if (serverNode) {
      store.getState().updateComponentConfig(serverNode.id, {
        instanceCount: 10,
        processingTimeMs: 10,
        retryPolicy: { maxRetries: 3, backoffMs: 100 },
      });
    }
    if (dbNode) {
      // Low throughput → DB pool exhausts quickly → errorRate > 0.3 → amplification ≈ 1.6×
      store.getState().updateComponentConfig(dbNode.id, {
        writeThroughputRps: 2,
        readThroughputRps: 2,
        readReplicas: 0,
        connectionPoolSize: 30,
      });
    }
    if (lbNode) store.getState().updateComponentConfig(lbNode.id, { isEntry: true });

    store.getState().setTrafficProfile({
      profileName: 'retry-storm',
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

test.describe('SIMFID Phase 3 — Retry Storms', () => {
  test.setTimeout(60000);
  test.beforeAll(() => ensureDir(RESULTS_DIR));

  test('retry-storm callout appears in live log when amplification crosses 1.5×', async ({ page }) => {
    const dir = path.join(RESULTS_DIR, 'amplification');
    ensureDir(dir);

    await setupRetryScenario(page);

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
    expect(panelText).toMatch(/retry storm/);
    expect(panelText).toMatch(/amplifying load/);

    await page.screenshot({ path: path.join(dir, 'log-with-retry-storm.png') });
  });
});
