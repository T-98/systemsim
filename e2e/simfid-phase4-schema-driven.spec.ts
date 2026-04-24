/**
 * @file simfid-phase4-schema-driven.spec.ts
 *
 * SIMFID Phase 4 end-to-end spec. Drives a full Discord-shape scenario
 * through the engine and asserts that the schema-driven runtime signals
 * land in the Live Log — specifically the unindexed-scan callout from
 * Commit 3 (§55). This spec exists because unit tests can pin formulas
 * but can't observe the user-visible surface (the log), which is where
 * the teaching signal lives.
 *
 * Shape of the assertion:
 *   1. Build a schema where one endpoint reads an un-indexed table.
 *   2. Configure a traffic profile + an endpoint route that routes
 *      enough RPS through that endpoint to cross the 5% threshold.
 *   3. Run. Wait for sim to finish.
 *   4. Assert the Live Log contains `may include unindexed access on`
 *      and the offending endpoint + table names.
 *
 * Parallel regression guard: run the same graph with `indexed: true`
 * on every TableAccess and assert the callout does NOT appear.
 */
import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RESULTS_DIR = path.join(__dirname, '..', 'test-results', 'simfid-phase4-schema-driven');

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * Sets up a minimal but realistic schema-driven scenario directly via
 * the Zustand store. Follows the same harness pattern as the Phase 3
 * specs so preflight bypass + run-to-completion works reliably.
 *
 * When `unindexed` is true, the messages endpoint's `TableAccess` for
 * `messages` has `indexed: false` — the exact condition that should
 * trip `unindexed-scan:messages`.
 */
async function setupSchemaScenario(page: Page, opts: { unindexed: boolean }) {
  await page.goto('/');
  await page.waitForSelector('text=Or start from a template');
  await page.click('button:has-text("Basic CRUD App")');
  await page.waitForSelector('.react-flow__node', { timeout: 5000 });

  await page.evaluate(({ unindexed }) => {
    const store = (window as any).__SYSTEMSIM_STORE__;
    if (!store) return;
    const state = store.getState();

    const serverNode = state.nodes.find((n: any) => n.data.type === 'server');
    const lbNode = state.nodes.find((n: any) => n.data.type === 'load_balancer');
    const dbNode = state.nodes.find((n: any) => n.data.type === 'database');
    if (!serverNode || !dbNode) return;

    if (lbNode) store.getState().updateComponentConfig(lbNode.id, { isEntry: true });
    // Big server + big DB so neither saturates — we want ONLY the
    // unindexed-scan signal, not latency from pool exhaustion or
    // read/write saturation.
    store.getState().updateComponentConfig(serverNode.id, {
      instanceCount: 10, processingTimeMs: 20, maxConcurrent: 5000,
    });
    store.getState().updateComponentConfig(dbNode.id, {
      readThroughputRps: 50_000, writeThroughputRps: 20_000,
      readReplicas: 0, connectionPoolSize: 10_000,
    });

    // Schema: one entity `messages` on the only DB. Indexed iff the
    // test says so.
    store.getState().setSchemaMemory({
      version: 1,
      entities: [
        {
          id: 'messages',
          name: 'messages',
          fields: [{ name: 'id', type: 'uuid', cardinality: 'high' }],
          indexes: unindexed ? [] : [{ field: 'id', type: 'btree' }],
          accessPatterns: [],
          assignedDbId: dbNode.id,
        },
      ],
      relationships: [],
      aiNotes: '',
    });

    // One contract + owned route. TableAccess.indexed encodes the
    // scenario flag.
    store.getState().setApiContracts([{
      id: 'c-messages', method: 'GET', path: '/messages',
      description: 'list messages', authMode: 'none',
      ownerServiceId: serverNode.id,
    }]);

    // setApiContracts auto-BFS's a basic route; overwrite with our
    // schema-driven shape so the engine sees TableAccess.indexed.
    const chain = lbNode
      ? [lbNode.id, serverNode.id, dbNode.id]
      : [serverNode.id, dbNode.id];
    store.getState().setEndpointRoutes([{
      endpointId: 'c-messages',
      componentChain: chain,
      tablesAccessed: [{ tableId: 'messages', mode: 'read', indexed: !unindexed }],
      weight: 1,
      estimatedPayloadBytes: 256,
    }]);

    store.getState().setTrafficProfile({
      profileName: 'schema-driven',
      durationSeconds: 8,
      phases: [{ startS: 0, endS: 8, rps: 500, shape: 'steady', description: 'steady read' }],
      requestMix: { 'GET /messages': 1.0 },
      userDistribution: 'uniform',
      jitterPercent: 0,
    });
  }, { unindexed: opts.unindexed });

  await page.waitForTimeout(300);
}

async function runToDone(page: Page) {
  const speed10x = page.locator('button:has-text("10x")');
  if (await speed10x.isVisible()) await speed10x.click();

  const runButton = page.getByRole('button', { name: 'Run', exact: true });
  await expect(runButton).toBeEnabled({ timeout: 5000 });
  await runButton.click();

  const toolbarDebrief = page.locator('button:has-text("Debrief")').first();
  await expect(toolbarDebrief).toBeVisible({ timeout: 120000 });
}

async function readLog(page: Page): Promise<string> {
  const logTab = page.locator('button:has-text("Live Log")').first();
  if (await logTab.isVisible()) await logTab.click();
  await page.waitForTimeout(300);
  return page.getByTestId('bottom-panel').innerText();
}

test.describe('SIMFID Phase 4 — schema-driven runtime signals', () => {
  test.setTimeout(60000);
  test.beforeAll(() => ensureDir(RESULTS_DIR));

  test('unindexed read fires the unindexed-scan callout with endpoint + table names', async ({ page }) => {
    const dir = path.join(RESULTS_DIR, 'unindexed');
    ensureDir(dir);

    await setupSchemaScenario(page, { unindexed: true });
    await runToDone(page);

    const panelText = await readLog(page);
    // Assert the hedged wording from Commit 3.
    expect(panelText).toMatch(/may include unindexed access/);
    // And both the table and (uuid-shaped) endpoint id make it into the line.
    expect(panelText).toMatch(/"messages"/);
    expect(panelText).toMatch(/c-messages/);

    await page.screenshot({ path: path.join(dir, 'log-with-scan.png'), fullPage: true });
  });

  test('fully indexed access does NOT fire the callout (regression guard)', async ({ page }) => {
    const dir = path.join(RESULTS_DIR, 'indexed');
    ensureDir(dir);

    await setupSchemaScenario(page, { unindexed: false });
    await runToDone(page);

    const panelText = await readLog(page);
    expect(panelText).not.toMatch(/may include unindexed access/);

    await page.screenshot({ path: path.join(dir, 'log-clean.png'), fullPage: true });
  });
});
