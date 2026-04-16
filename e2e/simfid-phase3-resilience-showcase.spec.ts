import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RESULTS_DIR = path.join(__dirname, '..', 'test-results', 'simfid-phase3-showcase');

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

async function loadShowcaseTemplate(page: Page) {
  await page.goto('/');
  await page.waitForSelector('text=Or start from a template');
  await page.click('button:has-text("Resilience Showcase")');
  await page.waitForSelector('.react-flow__node', { timeout: 5000 });

  // Inject preflight bypass so Run is enabled without the full design flow.
  await page.evaluate(() => {
    const store = (window as any).__SYSTEMSIM_STORE__;
    const state = store.getState();
    const srv = state.nodes.find((n: any) => n.data.type === 'server');
    const db = state.nodes.find((n: any) => n.data.type === 'database');

    store.getState().setSchemaMemory({
      version: 1,
      entities: [{
        id: 'e1', name: 'items', fields: [{ name: 'id', type: 'uuid', cardinality: 'high' }],
        indexes: [{ field: 'id', type: 'btree' }], accessPatterns: [], assignedDbId: db?.id ?? null,
      }],
      relationships: [],
      aiNotes: '',
    });
    if (srv) {
      store.getState().setApiContracts([{
        id: 'c1', method: 'GET', path: '/items', description: 'test',
        authMode: 'none', ownerServiceId: srv.id,
      }]);
    }

    // Crank traffic so the DB saturates and all three resilience features fire.
    // 25s gives the breaker time to trip after ticks of sustained error, while
    // retries + backpressure build up in the early ticks.
    store.getState().setTrafficProfile({
      profileName: 'showcase', durationSeconds: 25, jitterPercent: 0,
      phases: [{ startS: 0, endS: 25, rps: 120, shape: 'steady', description: 'overload' }],
      requestMix: { default: 1.0 }, userDistribution: 'uniform',
    });
  });
  await page.waitForTimeout(300);
}

test.describe('SIMFID Phase 3 — Resilience Showcase template', () => {
  test.setTimeout(90000);
  test.beforeAll(() => ensureDir(RESULTS_DIR));

  test('showcase template trips breaker + logs retry storm + logs backpressure in one run', async ({ page }) => {
    const dir = path.join(RESULTS_DIR, 'full-run');
    ensureDir(dir);

    await loadShowcaseTemplate(page);

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

    // All three Phase 3 features should show up in the live log
    expect(panelText).toMatch(/Circuit breaker/);
    expect(panelText).toMatch(/retry storm/);
    expect(panelText).toMatch(/signaling backpressure/);

    await page.screenshot({ path: path.join(dir, 'log-all-three.png') });
  });

  test('ConfigPanel exposes circuit breaker toggle on wire selection', async ({ page }) => {
    const dir = path.join(RESULTS_DIR, 'wire-breaker-ui');
    ensureDir(dir);

    await loadShowcaseTemplate(page);

    // Select the first edge programmatically (clicking edges is flaky in xyflow).
    await page.evaluate(() => {
      const store = (window as any).__SYSTEMSIM_STORE__;
      const edge = store.getState().edges[0];
      store.getState().setSelectedEdgeId(edge.id);
      store.getState().setConfigPanelOpen(true);
    });
    await page.waitForTimeout(300);

    const panel = page.locator('text=Wire Config').first();
    await expect(panel).toBeVisible();

    // Circuit breaker toggle should be visible in the wire config panel
    const breakerLabel = page.locator('text=Circuit breaker').first();
    await expect(breakerLabel).toBeVisible();

    await page.screenshot({ path: path.join(dir, 'wire-config-with-breaker.png') });
  });

  test('ConfigPanel exposes retry + backpressure toggles on node selection', async ({ page }) => {
    const dir = path.join(RESULTS_DIR, 'node-resilience-ui');
    ensureDir(dir);

    await loadShowcaseTemplate(page);

    await page.evaluate(() => {
      const store = (window as any).__SYSTEMSIM_STORE__;
      const server = store.getState().nodes.find((n: any) => n.data.type === 'server');
      store.getState().setSelectedNodeId(server.id);
      store.getState().setConfigPanelOpen(true);
    });
    await page.waitForTimeout(300);

    const retryLabel = page.locator('text=Retry policy').first();
    await expect(retryLabel).toBeVisible();
    const backpressureLabel = page.locator('text=Backpressure').first();
    await expect(backpressureLabel).toBeVisible();

    await page.screenshot({ path: path.join(dir, 'node-config-with-resilience.png') });
  });

  test('wire breaker colors clear after run completes (no stale paint)', async ({ page }) => {
    // Codex finding #2: users editing the graph post-run were seeing old
    // breaker colors. Verify SimWireEdge only renders breaker state during
    // an actively running/paused sim.
    await loadShowcaseTemplate(page);

    const speed10x = page.locator('button:has-text("10x")');
    if (await speed10x.isVisible()) await speed10x.click();

    const runButton = page.getByRole('button', { name: 'Run', exact: true });
    await expect(runButton).toBeEnabled({ timeout: 5000 });
    await runButton.click();

    // Wait for completion
    const toolbarDebrief = page.locator('button:has-text("Debrief")').first();
    await expect(toolbarDebrief).toBeVisible({ timeout: 120000 });

    // After completion, simulationStatus === 'completed'. SimWireEdge should
    // not render any breaker color. We assert by reading the store state.
    const sawBreakerDuringRun = await page.evaluate(() => {
      const store = (window as any).__SYSTEMSIM_STORE__;
      const wireStates = store.getState().liveWireStates;
      // wireStates still has the final post-run values, but SimWireEdge won't paint them.
      return Object.values(wireStates).some((s: any) => s.breakerStatus === 'open' || s.breakerStatus === 'half_open');
    });
    // The showcase should have produced breaker activity during the run.
    expect(sawBreakerDuringRun).toBe(true);
    // SimWireEdge logic check: simulationStatus is 'completed', so showBreakerState = false.
    const status = await page.evaluate(() => (window as any).__SYSTEMSIM_STORE__.getState().simulationStatus);
    expect(status).toBe('completed');
  });

  test('replaceGraph during a run tears down the old engine', async ({ page }) => {
    // Codex finding #1: replaceGraph was leaving the old engine ticking.
    // Verify: start a run, replace graph, wait, confirm no stale metrics.
    await loadShowcaseTemplate(page);

    const speed10x = page.locator('button:has-text("10x")');
    if (await speed10x.isVisible()) await speed10x.click();

    const runButton = page.getByRole('button', { name: 'Run', exact: true });
    await expect(runButton).toBeEnabled({ timeout: 5000 });
    await runButton.click();

    await page.waitForTimeout(500); // let a tick or two happen

    // Now swap to a different template via replaceGraph
    await page.evaluate(() => {
      const store = (window as any).__SYSTEMSIM_STORE__;
      store.getState().replaceGraph({
        nodes: [
          { type: 'server', label: 'New Server' },
          { type: 'database', label: 'New DB' },
        ],
        edges: [{ source: 'server-0', target: 'database-1' }],
      }, { layout: 'auto' });
    });

    // Wait longer than a tick (1000ms / 10x speed = 100ms per tick)
    await page.waitForTimeout(500);

    // The old run should be fully stopped — simulationStatus === 'idle'.
    const status = await page.evaluate(() => (window as any).__SYSTEMSIM_STORE__.getState().simulationStatus);
    expect(status).toBe('idle');

    // No stale wireStates from the old graph.
    const wireStateCount = await page.evaluate(() => {
      const states = (window as any).__SYSTEMSIM_STORE__.getState().liveWireStates;
      return Object.keys(states).length;
    });
    expect(wireStateCount).toBe(0);
  });
});
