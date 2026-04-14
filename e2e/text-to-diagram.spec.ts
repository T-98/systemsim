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

const MOCK_INTENT_RESPONSE = {
  intent: 'We let users place orders. Orders go to a payment service and a confirmation email is sent.',
  components: [
    { label: 'Load Balancer', type: 'load_balancer' },
    { label: 'API Server', type: 'server' },
    { label: 'Orders DB', type: 'database' },
    { label: 'Queue', type: 'queue' },
    { label: 'Email Worker', type: 'server' },
  ],
  connections: [
    'Load Balancer --> API Server',
    'API Server --> Orders DB',
    'API Server --> Queue',
    'Queue --> Email Worker',
  ].join('\n'),
  confidence: { intent: 'high', items: [] },
  promptVersion: '2.0',
};

const MOCK_INTENT_LOW_CONFIDENCE = {
  intent: 'A system with some components, but the diagram was unclear in places.',
  components: [
    { label: 'API', type: 'server' },
    { label: 'Database', type: 'database' },
  ],
  connections: 'API --> Database',
  confidence: {
    intent: 'low',
    items: [{ name: 'Cache?', confidence: 'low', reasoning: 'Label was blurry' }],
  },
  promptVersion: '2.0',
};

test.describe('Vision-to-intent (text-only)', () => {
  test('text description → Generate → review → Generate diagram → canvas populated', async ({ page }) => {
    await page.route('**/api/describe-intent', (route) => {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_INTENT_RESPONSE) });
    });

    await page.goto('/');
    const textarea = page.locator('textarea[aria-label="System description"]');
    await expect(textarea).toBeVisible({ timeout: 3000 });
    await textarea.fill('A load balancer connected to two API servers and a Postgres database');
    await page.click('button:has-text("Generate")');

    // Review screen appears with intent + components + connections
    await expect(page.getByRole('heading', { name: 'What you are building' })).toBeVisible({ timeout: 10000 });
    await expect(page.locator('textarea[aria-label="What you are building"]')).toHaveValue(MOCK_INTENT_RESPONSE.intent);
    await expect(page.getByRole('heading', { name: 'Components detected' })).toBeVisible();
    await expect(page.locator('text=5 components read')).toBeVisible();
    await expect(page.locator('textarea[aria-label="Connections"]')).toHaveValue(MOCK_INTENT_RESPONSE.connections);

    // Generate the diagram — local graph assembly, no second API call
    await page.click('button:has-text("Generate diagram")');
    await page.waitForSelector('.react-flow__node', { timeout: 10000 });
    const nodeCount = await page.locator('.react-flow__node').count();
    expect(nodeCount).toBe(5);
  });

  test('review → Back → landing preserves input', async ({ page }) => {
    await page.route('**/api/describe-intent', (route) => {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_INTENT_RESPONSE) });
    });

    await page.goto('/');
    const textarea = page.locator('textarea[aria-label="System description"]');
    await expect(textarea).toBeVisible({ timeout: 3000 });
    const typedText = 'A load balancer with servers and a database';
    await textarea.fill(typedText);
    await page.click('button:has-text("Generate")');

    await expect(page.getByRole('heading', { name: 'What you are building' })).toBeVisible({ timeout: 10000 });

    await page.click('button:has-text("← Back")');
    await expect(page.locator('text=Design distributed systems')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('textarea[aria-label="System description"]')).toHaveValue(typedText);
  });

  test('edited connections → canvas respects edits', async ({ page }) => {
    await page.route('**/api/describe-intent', (route) => {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_INTENT_RESPONSE) });
    });

    await page.goto('/');
    const textarea = page.locator('textarea[aria-label="System description"]');
    await expect(textarea).toBeVisible({ timeout: 3000 });
    await textarea.fill('An e-commerce checkout system');
    await page.click('button:has-text("Generate")');

    await expect(page.getByRole('heading', { name: 'What you are building' })).toBeVisible({ timeout: 10000 });

    // Edit connections: keep only two edges
    const connectionsField = page.locator('textarea[aria-label="Connections"]');
    await connectionsField.fill(
      'Load Balancer --> API Server\nAPI Server --> Orders DB'
    );
    await expect(page.locator('text=2 connections ready')).toBeVisible();

    await page.click('button:has-text("Generate diagram")');
    await page.waitForSelector('.react-flow__node', { timeout: 10000 });
    expect(await page.locator('.react-flow__edge').count()).toBe(2);
  });

  test('connection typo → error banner, generate disabled', async ({ page }) => {
    await page.route('**/api/describe-intent', (route) => {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_INTENT_RESPONSE) });
    });

    await page.goto('/');
    const textarea = page.locator('textarea[aria-label="System description"]');
    await expect(textarea).toBeVisible({ timeout: 3000 });
    await textarea.fill('An e-commerce checkout system');
    await page.click('button:has-text("Generate")');

    await expect(page.getByRole('heading', { name: 'What you are building' })).toBeVisible({ timeout: 10000 });

    // Type a connection referencing a nonexistent component
    const connectionsField = page.locator('textarea[aria-label="Connections"]');
    await connectionsField.fill('mystery box --> API Server');

    await expect(page.locator('text=1 connection needs fixing')).toBeVisible();
    await expect(page.locator('text=not in the components list')).toBeVisible();

    const generateBtn = page.locator('button:has-text("Generate diagram")');
    await expect(generateBtn).toBeDisabled();
  });

  test('low-confidence response → warning banner visible on review', async ({ page }) => {
    await page.route('**/api/describe-intent', (route) => {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_INTENT_LOW_CONFIDENCE) });
    });

    await page.goto('/');
    const textarea = page.locator('textarea[aria-label="System description"]');
    await expect(textarea).toBeVisible({ timeout: 3000 });
    await textarea.fill('A rough sketch of some system');
    await page.click('button:has-text("Generate")');

    await expect(page.getByRole('heading', { name: 'What you are building' })).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=Some parts of your diagram were unclear')).toBeVisible();
  });

  test('describe-intent validation error → stay on landing, show banner', async ({ page }) => {
    await page.route('**/api/describe-intent', (route) => {
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: true, kind: 'validation', message: 'Describe your system or attach an image.' }),
      });
    });

    await page.goto('/');
    const textarea = page.locator('textarea[aria-label="System description"]');
    await expect(textarea).toBeVisible({ timeout: 3000 });
    await textarea.fill('not enough input maybe');
    await page.click('button:has-text("Generate")');

    await expect(page.locator('text=Describe your system or attach an image')).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('heading', { name: 'What you are building' })).not.toBeVisible();
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
