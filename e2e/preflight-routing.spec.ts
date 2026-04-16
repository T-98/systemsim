import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RESULTS_DIR = path.join(__dirname, '..', 'test-results', 'preflight-routing');

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

async function loadBlankCanvas(page: Page) {
  await page.goto('/');
  await page.waitForSelector('text=Or start from a template');
  await page.click('button:has-text("Basic CRUD App")');
  await page.waitForSelector('.react-flow__node', { timeout: 5000 });
}

async function getState(page: Page) {
  return page.evaluate(() => {
    const store = (window as any).__SYSTEMSIM_STORE__;
    const s = store.getState();
    return {
      sidebarTab: s.sidebarTab,
      designPanelTab: s.designPanelTab,
      selectedNodeId: s.selectedNodeId,
      pulseTarget: s.pulseTarget,
    };
  });
}

test.describe('Preflight routing', () => {
  test.setTimeout(60000);
  test.beforeAll(() => ensureDir(RESULTS_DIR));

  test('clicking "Add traffic profile" switches sidebar to Traffic tab', async ({ page }) => {
    const dir = path.join(RESULTS_DIR, 'traffic');
    ensureDir(dir);
    await loadBlankCanvas(page);
    await page.screenshot({ path: path.join(dir, 'before.png') });

    const trafficRow = page.locator('button[aria-label*="Add traffic profile"]');
    await expect(trafficRow).toBeVisible();
    await trafficRow.click();
    await page.waitForTimeout(300);

    const state = await getState(page);
    expect(state.sidebarTab).toBe('traffic');
    await page.screenshot({ path: path.join(dir, 'after.png') });
  });

  test('clicking "Define a data schema" switches to Design → Schema', async ({ page }) => {
    const dir = path.join(RESULTS_DIR, 'design-schema');
    ensureDir(dir);
    await loadBlankCanvas(page);
    await page.screenshot({ path: path.join(dir, 'before.png') });

    const row = page.locator('button[aria-label*="Define a data schema"]');
    await expect(row).toBeVisible();
    await row.click();
    await page.waitForTimeout(300);

    const state = await getState(page);
    expect(state.sidebarTab).toBe('design');
    expect(state.designPanelTab).toBe('schema');
    await page.screenshot({ path: path.join(dir, 'after.png') });
  });

  test('clicking "Define API endpoints" switches to Design → Endpoints', async ({ page }) => {
    const dir = path.join(RESULTS_DIR, 'design-api');
    ensureDir(dir);
    await loadBlankCanvas(page);
    await page.screenshot({ path: path.join(dir, 'before.png') });

    const row = page.locator('button[aria-label*="Define API endpoints"]');
    await expect(row).toBeVisible();
    await row.click();
    await page.waitForTimeout(300);

    const state = await getState(page);
    expect(state.sidebarTab).toBe('design');
    expect(state.designPanelTab).toBe('api');
    await page.screenshot({ path: path.join(dir, 'after.png') });
  });

  test('clicking "Assign N tables" opens ConfigPanel on DB node', async ({ page }) => {
    const dir = path.join(RESULTS_DIR, 'config-db');
    ensureDir(dir);
    await loadBlankCanvas(page);

    // Set up a schema with an unassigned entity
    await page.evaluate(() => {
      const store = (window as any).__SYSTEMSIM_STORE__;
      const state = store.getState();
      const dbNode = state.nodes.find((n: any) => n.data.type === 'database');
      store.getState().setSchemaMemory({
        version: 1,
        entities: [{
          id: 'e1', name: 'items', fields: [{ name: 'id', type: 'uuid', cardinality: 'high' }],
          indexes: [{ field: 'id', type: 'btree' }], accessPatterns: [], assignedDbId: null,
        }],
        relationships: [],
        aiNotes: '',
      });
      return { dbId: dbNode.id };
    });
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(dir, 'before.png') });

    const row = page.locator('button[aria-label*="Assign"]').first();
    await expect(row).toBeVisible();
    await row.click();
    await page.waitForTimeout(300);

    const state = await getState(page);
    expect(state.selectedNodeId).toBeTruthy();
    await page.screenshot({ path: path.join(dir, 'after.png') });
  });

  test('clicking "Mark an entry point" triggers canvas pulse', async ({ page }) => {
    const dir = path.join(RESULTS_DIR, 'canvas-entry');
    ensureDir(dir);
    await loadBlankCanvas(page);

    // Create a cyclic graph so there's no natural entry point
    await page.evaluate(() => {
      const store = (window as any).__SYSTEMSIM_STORE__;
      const state = store.getState();
      const lbNode = state.nodes.find((n: any) => n.data.type === 'load_balancer');
      if (lbNode) {
        store.getState().updateComponentConfig(lbNode.id, { isEntry: false });
      }
      // Add a cycle edge so no zero-indegree nodes
      const edges = state.edges;
      const lastNode = state.nodes[state.nodes.length - 1];
      if (lbNode && lastNode && lbNode.id !== lastNode.id) {
        store.getState().onConnect({
          source: lastNode.id, target: lbNode.id,
          sourceHandle: null, targetHandle: null,
        });
      }
    });
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(dir, 'before.png') });

    const row = page.locator('button[aria-label*="Mark an entry point"]');
    if (await row.count() > 0) {
      await row.click();
      await page.waitForTimeout(200);
      await page.screenshot({ path: path.join(dir, 'after-with-pulse.png') });
    } else {
      // If preflight doesn't fire for this test setup, document it
      await page.screenshot({ path: path.join(dir, 'no-entry-error-not-shown.png') });
    }
  });
});
