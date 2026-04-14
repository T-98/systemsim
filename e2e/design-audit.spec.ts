// Design-audit screenshot harness. Not part of regular E2E run.
// Usage: pnpm exec playwright test e2e/design-audit.spec.ts
import { test } from '@playwright/test';

const MOCK_INTENT = {
  intent: 'We have a read-heavy API behind a load balancer with two servers, Postgres for writes, and a Redis cache for hot paths.',
  components: [
    { label: 'Load Balancer', type: 'load_balancer' },
    { label: 'API Server 1', type: 'server' },
    { label: 'API Server 2', type: 'server' },
    { label: 'Postgres', type: 'database' },
    { label: 'Redis Cache', type: 'cache' },
  ],
  connections: [
    'Load Balancer --> API Server 1',
    'Load Balancer --> API Server 2',
    'API Server 1 --> Postgres',
    'API Server 2 --> Postgres',
    'API Server 1 --read--> Redis Cache',
    'API Server 2 --read--> Redis Cache',
  ].join('\n'),
  confidence: {
    intent: 'high',
    items: [
      { name: 'Load Balancer', confidence: 'high', reasoning: 'Explicitly mentioned.' },
      { name: 'API Server', confidence: 'high', reasoning: 'User said "two API servers".' },
      { name: 'Redis Cache', confidence: 'med', reasoning: 'User mentioned Redis; write-through vs read-through direction assumed.' },
    ],
  },
  promptVersion: '2.0',
};

const MOCK_GRAPH = {
  graph: {
    nodes: MOCK_INTENT.components.map((c) => ({ type: c.type, label: c.label })),
    edges: [
      { source: 'load_balancer-0', target: 'server-1' },
      { source: 'load_balancer-0', target: 'server-2' },
      { source: 'server-1', target: 'database-3' },
      { source: 'server-2', target: 'database-3' },
      { source: 'server-1', target: 'cache-4' },
      { source: 'server-2', target: 'cache-4' },
    ],
  },
  promptVersion: '1.0',
};

const dir = '/tmp/design-audit/screenshots';

test.describe('design audit harness', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('landing', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('text=SystemSim');
    await page.screenshot({ path: `${dir}/landing-1440.png`, fullPage: true });
  });

  test('landing mobile', async ({ page, browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const p = await ctx.newPage();
    await p.goto('http://localhost:5180/');
    await p.waitForSelector('text=SystemSim');
    await p.screenshot({ path: `${dir}/landing-mobile.png`, fullPage: true });
    await ctx.close();
  });

  test('review with content', async ({ page }) => {
    await page.route('**/api/describe-intent', (route) => {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_INTENT) });
    });
    await page.goto('/');
    await page.locator('textarea[aria-label="System description"]').fill('Load balancer, API servers, Postgres, Redis cache');
    await page.click('button:has-text("Generate")');
    await page.waitForSelector('textarea[aria-label="What you are building"]');
    await page.screenshot({ path: `${dir}/review-full.png`, fullPage: true });

    // Also capture with confidence panel expanded
    await page.locator('summary', { hasText: 'What did we see?' }).click();
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${dir}/review-expanded.png`, fullPage: true });
  });

  test('review with error in connections', async ({ page }) => {
    await page.route('**/api/describe-intent', (route) => {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_INTENT) });
    });
    await page.goto('/');
    await page.locator('textarea[aria-label="System description"]').fill('Load balancer, API servers, Postgres, Redis cache');
    await page.click('button:has-text("Generate")');
    await page.waitForSelector('textarea[aria-label="What you are building"]');
    // Inject a bad line
    const cxn = page.locator('textarea[aria-label="Connections"]');
    await cxn.fill('Load Balancer --> API Server 1\nmystery box --> Postgres\nAPI Server 1 --> Postgres');
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${dir}/review-error.png`, fullPage: true });
  });

  test('canvas with intent header', async ({ page }) => {
    await page.route('**/api/describe-intent', (route) => {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_INTENT) });
    });
    await page.route('**/api/generate-diagram', (route) => {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_GRAPH) });
    });
    await page.goto('/');
    await page.locator('textarea[aria-label="System description"]').fill('Load balancer, API servers, Postgres, Redis cache');
    await page.click('button:has-text("Generate")');
    await page.waitForSelector('textarea[aria-label="What you are building"]');
    await page.click('button:has-text("Generate diagram")');
    await page.waitForSelector('.react-flow__node');
    await page.waitForTimeout(600); // layout settle
    await page.screenshot({ path: `${dir}/canvas-with-intent.png`, fullPage: true });

    // Click intent header to show edit state
    await page.getByLabel(/Edit intent: /).click();
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${dir}/canvas-intent-editing.png`, fullPage: true });
  });

  test('template flow canvas (no intent)', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('text=Or start from a template');
    const section = page.locator('text=Or start from a template').locator('..');
    await section.locator('button:has-text("Basic CRUD App")').click();
    await page.waitForSelector('.react-flow__node');
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${dir}/canvas-template.png`, fullPage: true });
  });

  test('drag-drop hover state', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('text=SystemSim');
    // Synthesize a dragenter event with Files type
    await page.evaluate(() => {
      const zone = document.querySelector('[class*="rounded-xl"]') as HTMLElement;
      if (!zone) return;
      const dt = new DataTransfer();
      const dragEvent = new DragEvent('dragenter', {
        bubbles: true,
        cancelable: true,
        dataTransfer: dt,
      });
      // DataTransfer types is read-only in spec; simulate by overriding
      Object.defineProperty(dragEvent.dataTransfer, 'types', { value: ['Files'] });
      zone.dispatchEvent(dragEvent);
    });
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${dir}/landing-drag-active.png`, fullPage: true });
  });
});
