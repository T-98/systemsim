import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RESULTS_DIR = path.join(__dirname, '..', 'test-results', 'simfid-phase3-breakers');

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

async function setupBreakerScenario(page: Page) {
  await page.goto('/');
  await page.waitForSelector('text=Or start from a template');
  await page.click('button:has-text("Basic CRUD App")');
  await page.waitForSelector('.react-flow__node', { timeout: 5000 });

  // Overload the server + enable a breaker on the LB → server wire. Set
  // preflight-bypassing state directly for a reliable test run.
  await page.evaluate(() => {
    const store = (window as any).__SYSTEMSIM_STORE__;
    if (!store) return;
    const state = store.getState();

    const serverNode = state.nodes.find((n: any) => n.data.type === 'server');
    const lbNode = state.nodes.find((n: any) => n.data.type === 'load_balancer');
    const dbNode = state.nodes.find((n: any) => n.data.type === 'database');

    if (serverNode) {
      store.getState().updateComponentConfig(serverNode.id, {
        instanceCount: 1,
        processingTimeMs: 50,
      });
    }
    if (lbNode) {
      store.getState().updateComponentConfig(lbNode.id, { isEntry: true });
    }

    // Attach a breaker to every edge outgoing from the LB. The breaker
    // should trip when the server starts dropping requests.
    if (lbNode) {
      const lbEdges = state.edges.filter((e: any) => e.source === lbNode.id);
      for (const e of lbEdges) {
        store.getState().updateWireConfig(e.id, {
          circuitBreaker: {
            failureThreshold: 0.3,
            failureWindow: 2,
            cooldownSeconds: 60,
            halfOpenTicks: 2,
          },
        });
      }
    }

    // 200 RPS: ρ ≈ 10 on a 1-instance 50ms server. Guaranteed overload.
    store.getState().setTrafficProfile({
      profileName: 'breaker-test',
      durationSeconds: 15,
      phases: [{ startS: 0, endS: 15, rps: 200, shape: 'steady', description: 'overload' }],
      requestMix: { default: 1.0 },
      userDistribution: 'uniform',
      jitterPercent: 0,
    });

    // Preflight bypass: minimal schema + API contract.
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

test.describe('SIMFID Phase 3 — Circuit Breakers', () => {
  test.setTimeout(60000);
  test.beforeAll(() => ensureDir(RESULTS_DIR));

  test('breaker trip appears in live log when server overloads', async ({ page }) => {
    const dir = path.join(RESULTS_DIR, 'trip');
    ensureDir(dir);

    await setupBreakerScenario(page);

    // Run at max speed so ticks fly by
    const speed10x = page.locator('button:has-text("10x")');
    if (await speed10x.isVisible()) await speed10x.click();

    const runButton = page.getByRole('button', { name: 'Run', exact: true });
    await expect(runButton).toBeEnabled({ timeout: 5000 });
    await runButton.click();

    // Wait for sim to finish
    const toolbarDebrief = page.locator('button:has-text("Debrief")').first();
    await expect(toolbarDebrief).toBeVisible({ timeout: 120000 });

    // Switch to Live Log tab to inspect breaker transitions
    const logTab = page.locator('button:has-text("Live Log")').first();
    await logTab.click();
    await page.waitForTimeout(300);

    const panelText = await page.getByTestId('bottom-panel').innerText();
    expect(panelText).toMatch(/Circuit breaker/);
    expect(panelText).toMatch(/closed → open/);

    await page.screenshot({ path: path.join(dir, 'log-with-trip.png') });
  });

  test('scenario without a breaker config sees no breaker logs (regression guard)', async ({ page }) => {
    const dir = path.join(RESULTS_DIR, 'no-breaker');
    ensureDir(dir);

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

      if (serverNode) store.getState().updateComponentConfig(serverNode.id, { instanceCount: 5, processingTimeMs: 30 });
      if (lbNode) store.getState().updateComponentConfig(lbNode.id, { isEntry: true });

      store.getState().setTrafficProfile({
        profileName: 'no-breaker', durationSeconds: 8,
        phases: [{ startS: 0, endS: 8, rps: 30, shape: 'steady', description: 'healthy' }],
        requestMix: { default: 1.0 }, userDistribution: 'uniform', jitterPercent: 0,
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
    expect(panelText).not.toMatch(/Circuit breaker/);

    await page.screenshot({ path: path.join(dir, 'log-no-breaker.png') });
  });
});
