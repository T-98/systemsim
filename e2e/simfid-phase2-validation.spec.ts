import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RESULTS_DIR = path.join(__dirname, '..', 'test-results', 'simfid-phase2');

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

async function setupScenario(page: Page, opts: {
  serverInstances?: number;
  serverProcessingMs?: number;
  wireLatencyMs?: number[];
  cacheEnabled?: boolean;
  cacheTtl?: number;
  cacheMemoryMb?: number;
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
    if (serverNode && (o.serverInstances || o.serverProcessingMs)) {
      store.getState().updateComponentConfig(serverNode.id, {
        ...(o.serverInstances != null ? { instanceCount: o.serverInstances } : {}),
        ...(o.serverProcessingMs != null ? { processingTimeMs: o.serverProcessingMs } : {}),
      });
    }

    const lbNode = state.nodes.find((n: any) => n.data.type === 'load_balancer');
    if (lbNode) {
      store.getState().updateComponentConfig(lbNode.id, { isEntry: true });
    }

    if (o.wireLatencyMs) {
      const edges = store.getState().edges;
      o.wireLatencyMs.forEach((lat: number, i: number) => {
        if (edges[i]) {
          store.getState().updateWireConfig(edges[i].id, { latencyMs: lat });
        }
      });
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
    const entityId = 'test-entity-1';
    store.getState().setSchemaMemory({
      version: 1,
      entities: [{
        id: entityId, name: 'items', fields: [{ name: 'id', type: 'uuid', cardinality: 'high' }],
        indexes: [{ field: 'id', type: 'btree' }], accessPatterns: [], assignedDbId: dbNode?.id ?? null,
      }],
      relationships: [],
      aiNotes: '',
    });
    if (sNode) {
      store.getState().setApiContracts([{
        id: 'test-contract-1', method: 'GET', path: '/items', description: 'test',
        authMode: 'none', ownerServiceId: sNode.id,
      }]);
    }
  }, opts);

  await page.waitForTimeout(300);
}

async function runSimAndCapture(page: Page, testDir: string) {
  ensureDir(testDir);

  const speedButton = page.locator('button:has-text("10x")');
  if (await speedButton.isVisible()) {
    await speedButton.click();
  }

  const runButton = page.locator('button:has-text("Run")');
  await expect(runButton).toBeEnabled({ timeout: 5000 });
  await runButton.click();

  await expect(page.locator('button:has-text("Pause")')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('button:has-text("Debrief")')).toBeVisible({ timeout: 120000 });

  await page.screenshot({ path: path.join(testDir, 'canvas.png'), fullPage: false });

  await page.click('button:has-text("Debrief")');
  await page.waitForTimeout(500);

  const downloadPromise = page.waitForEvent('download', { timeout: 10000 });
  await page.click('button:has-text("Download Report")');
  const download = await downloadPromise;
  await download.saveAs(path.join(testDir, download.suggestedFilename()));

  await page.screenshot({ path: path.join(testDir, 'debrief.png'), fullPage: false });
}

test.describe('SIMFID Phase 2 — Engine Fidelity Validation', () => {

  test.beforeAll(() => ensureDir(RESULTS_DIR));

  test('Test 3: Little\'s Law — low traffic (10 RPS, 1 instance @ 50ms = ρ=0.5)', async ({ page }) => {
    await setupScenario(page, { serverInstances: 1, serverProcessingMs: 50, trafficRps: 10, trafficDuration: 30 });
    await runSimAndCapture(page, path.join(RESULTS_DIR, 'test-3-littles-law-low-traffic'));
  });

  test('Test 4: Little\'s Law — high traffic (18 RPS, 1 instance @ 50ms = ρ=0.9)', async ({ page }) => {
    await setupScenario(page, { serverInstances: 1, serverProcessingMs: 50, trafficRps: 18, trafficDuration: 30 });
    await runSimAndCapture(page, path.join(RESULTS_DIR, 'test-4-littles-law-high-traffic'));
  });

  test('Test 5: More instances reduce latency (5 instances @ 50ms, 90 RPS = ρ=0.9)', async ({ page }) => {
    await setupScenario(page, { serverInstances: 5, serverProcessingMs: 50, trafficRps: 90, trafficDuration: 30 });
    await runSimAndCapture(page, path.join(RESULTS_DIR, 'test-5-more-instances'));
  });

  test('Test 6: Request drops under overload (1 instance @ 50ms, 30 RPS = ρ=1.5)', async ({ page }) => {
    await setupScenario(page, { serverInstances: 1, serverProcessingMs: 50, trafficRps: 30, trafficDuration: 30 });
    await runSimAndCapture(page, path.join(RESULTS_DIR, 'test-6-overload-drops'));
  });

  test('Test 7: LB latency reflects backend (3 instances @ 200ms, 10 RPS = ρ=0.67)', async ({ page }) => {
    await setupScenario(page, { serverInstances: 3, serverProcessingMs: 200, trafficRps: 10, trafficDuration: 30 });
    await runSimAndCapture(page, path.join(RESULTS_DIR, 'test-7-lb-latency-from-backends'));
  });

  test('Test 8: Wire latency accumulation (5ms + 10ms wires)', async ({ page }) => {
    await setupScenario(page, {
      serverInstances: 10, serverProcessingMs: 10,
      wireLatencyMs: [5, 10],
      trafficRps: 500, trafficDuration: 30,
    });
    await runSimAndCapture(page, path.join(RESULTS_DIR, 'test-8-wire-latency-accumulation'));
  });

  test('Test 9: Wire latency accumulation (50ms + 100ms wires)', async ({ page }) => {
    await setupScenario(page, {
      serverInstances: 10, serverProcessingMs: 10,
      wireLatencyMs: [50, 100],
      trafficRps: 500, trafficDuration: 30,
    });
    await runSimAndCapture(page, path.join(RESULTS_DIR, 'test-9-wire-latency-high'));
  });

});
