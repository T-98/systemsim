import { test, expect } from '@playwright/test';

const MOCK_DIAGRAM_RESPONSE = {
  graph: {
    nodes: [
      { type: 'load_balancer', label: 'LB' },
      { type: 'server', label: 'API Server' },
      { type: 'database', label: 'Database' },
    ],
    edges: [
      { source: 'load_balancer-0', target: 'server-1' },
      { source: 'server-1', target: 'database-2' },
    ],
  },
  promptVersion: '1.0',
};

const MOCK_VALIDATION_ERROR = {
  error: true,
  kind: 'validation',
  message: 'Generation failed. Try rephrasing your description.',
  reason: 'invalid_type',
};

const MOCK_RATE_LIMIT = {
  error: true,
  kind: 'rate_limit',
  message: 'Too many requests. Wait a moment.',
};

const MOCK_REMIX_RESPONSE = {
  graph: {
    nodes: [
      { type: 'load_balancer', label: 'LB' },
      { type: 'server', label: 'API Server' },
      { type: 'database', label: 'Primary DB' },
      { type: 'database', label: 'Read Replica' },
    ],
    edges: [
      { source: 'load_balancer-0', target: 'server-1' },
      { source: 'server-1', target: 'database-2' },
      { source: 'server-1', target: 'database-3' },
    ],
  },
  promptVersion: '1.0',
};

test.describe('Template flow', () => {
  test('template click loads canvas with nodes AND edges', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('text=Or start from a template');

    const templateSection = page.locator('text=Or start from a template').locator('..');
    await templateSection.locator('button:has-text("Basic CRUD App")').click();

    await page.waitForSelector('.react-flow__node', { timeout: 5000 });

    const nodes = page.locator('.react-flow__node');
    const nodeCount = await nodes.count();
    expect(nodeCount).toBeGreaterThanOrEqual(3);

    const edges = page.locator('.react-flow__edge');
    const edgeCount = await edges.count();
    expect(edgeCount).toBeGreaterThanOrEqual(2);
  });
});

test.describe('Text-to-diagram generation', () => {
  test('description → Generate → canvas populated', async ({ page }) => {
    await page.route('**/api/generate-diagram', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_DIAGRAM_RESPONSE),
      });
    });

    await page.goto('/');

    const textarea = page.locator('textarea[aria-label="System description"]');
    await expect(textarea).toBeVisible({ timeout: 3000 });

    await textarea.fill('A load balancer connected to an API server and a database');
    await page.click('button:has-text("Generate")');

    await page.waitForSelector('.react-flow__node', { timeout: 10000 });
    const nodes = page.locator('.react-flow__node');
    expect(await nodes.count()).toBeGreaterThanOrEqual(3);
  });

  test('Generate → Cancel → stale response does not navigate to canvas', async ({ page }) => {
    let resolveRoute: (() => void) | null = null;
    await page.route('**/api/generate-diagram', async (route) => {
      await new Promise<void>((r) => { resolveRoute = r; });
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_DIAGRAM_RESPONSE),
      });
    });

    await page.goto('/');

    const textarea = page.locator('textarea[aria-label="System description"]');
    await expect(textarea).toBeVisible({ timeout: 3000 });
    await textarea.fill('A load balancer connected to servers');
    await page.click('button:has-text("Generate")');

    const cancelBtn = page.locator('button:has-text("Cancel")');
    await expect(cancelBtn).toBeVisible({ timeout: 2000 });
    await cancelBtn.click();

    // Now let the API resolve — the stale response should be ignored
    resolveRoute?.();
    await page.waitForTimeout(500);

    // Should still be on landing page, NOT canvas
    await expect(page.locator('text=Design distributed systems')).toBeVisible();
    await expect(page.locator('.react-flow__node')).toHaveCount(0);
  });

  test('Generate → validation error → shows error and template link', async ({ page }) => {
    await page.route('**/api/generate-diagram', (route) => {
      route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_VALIDATION_ERROR),
      });
    });

    await page.goto('/');
    const textarea = page.locator('textarea[aria-label="System description"]');
    await expect(textarea).toBeVisible({ timeout: 3000 });
    await textarea.fill('A complex microservices architecture');
    await page.click('button:has-text("Generate")');

    await expect(page.locator('text=Generation failed')).toBeVisible({ timeout: 5000 });
    const templateLink = page.locator('text=Try a template instead');
    await expect(templateLink).toBeVisible();

    // Click the link — it should clear the error
    await templateLink.click();
    await expect(page.locator('text=Generation failed')).not.toBeVisible();
  });

  test('Generate → rate limit → shows rate limit message', async ({ page }) => {
    await page.route('**/api/generate-diagram', (route) => {
      route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_RATE_LIMIT),
      });
    });

    await page.goto('/');
    const textarea = page.locator('textarea[aria-label="System description"]');
    await expect(textarea).toBeVisible({ timeout: 3000 });
    await textarea.fill('A simple API with a database backend');
    await page.click('button:has-text("Generate")');

    await expect(page.locator('text=Too many requests')).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Remix flow', () => {
  test('Remix → Apply → canvas updated with remixed graph', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('text=Or start from a template');

    const templateSection = page.locator('text=Or start from a template').locator('..');
    await templateSection.locator('button:has-text("Basic CRUD App")').click();
    await page.waitForSelector('.react-flow__node', { timeout: 5000 });

    const initialCount = await page.locator('.react-flow__node').count();

    // Mock remix API and verify it receives mode: 'remix'
    let requestBody: any = null;
    await page.route('**/api/generate-diagram', (route) => {
      route.request().postDataJSON().then?.((b: any) => { requestBody = b; });
      try { requestBody = JSON.parse(route.request().postData() ?? '{}'); } catch {}
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_REMIX_RESPONSE),
      });
    });

    const remixBtn = page.locator('button:has-text("Remix")');
    await expect(remixBtn).toBeVisible({ timeout: 2000 });
    await remixBtn.click();

    // Confirmation modal
    const confirmBtn = page.locator('button:has-text("Replace")');
    await expect(confirmBtn).toBeVisible({ timeout: 2000 });
    await confirmBtn.click();

    // Remix input
    const remixInput = page.locator('input[placeholder*="Add a read replica"]');
    await expect(remixInput).toBeVisible({ timeout: 2000 });
    await remixInput.fill('Add a read replica to the database');
    await page.click('button:has-text("Apply")');

    // Wait for new nodes to appear (remixed graph has 4 nodes)
    await expect(page.locator('.react-flow__node')).toHaveCount(4, { timeout: 5000 });

    // Verify request was sent as remix mode
    expect(requestBody?.mode).toBe('remix');
    expect(requestBody?.currentGraph).toBeTruthy();
  });
});

test.describe('Session save/load', () => {
  test('save → load → all components and wires survive', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('text=Or start from a template');

    const templateSection = page.locator('text=Or start from a template').locator('..');
    await templateSection.locator('button:has-text("Basic CRUD App")').click();
    await page.waitForSelector('.react-flow__node', { timeout: 5000 });

    const initialNodes = await page.locator('.react-flow__node').count();
    const initialEdges = await page.locator('.react-flow__edge').count();
    expect(initialNodes).toBeGreaterThanOrEqual(3);
    expect(initialEdges).toBeGreaterThanOrEqual(2);

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('button:has-text("Save")'),
    ]);

    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();

    const fs = await import('fs');
    const savedJson = JSON.parse(fs.readFileSync(downloadPath!, 'utf-8'));
    expect(savedJson.componentGraph.components.length).toBe(initialNodes);
    expect(savedJson.componentGraph.wires.length).toBe(initialEdges);

    await page.goto('/');
    await page.waitForSelector('text=Design distributed systems');

    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.click('button:has-text("Load session from file")');
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(downloadPath!);

    await page.waitForSelector('.react-flow__node', { timeout: 5000 });

    const loadedNodes = await page.locator('.react-flow__node').count();
    const loadedEdges = await page.locator('.react-flow__edge').count();
    expect(loadedNodes).toBe(initialNodes);
    expect(loadedEdges).toBe(initialEdges);
  });
});
