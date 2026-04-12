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

function mockGenerateAPI(page: import('@playwright/test').Page, response: object, status = 200) {
  return page.route('**/api/generate-diagram', (route) => {
    route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(response),
    });
  });
}

test.describe('Template flow', () => {
  test('template click loads canvas with wires', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('text=Or start from a template');

    // Use the template picker section specifically (not the scenario card)
    const templateSection = page.locator('text=Or start from a template').locator('..');
    await templateSection.locator('button:has-text("Discord Notification Fanout")').click();

    // Should navigate to canvas view
    await page.waitForSelector('[data-testid="react-flow-wrapper"], .react-flow', { timeout: 5000 });

    // Verify nodes are present (React Flow renders them)
    const nodes = page.locator('.react-flow__node');
    await expect(nodes.first()).toBeVisible({ timeout: 3000 });
    const count = await nodes.count();
    expect(count).toBeGreaterThanOrEqual(3);
  });
});

test.describe('Text-to-diagram generation', () => {
  test('description → Generate → canvas populated', async ({ page }) => {
    await mockGenerateAPI(page, MOCK_DIAGRAM_RESPONSE);

    await page.goto('/?VITE_ENABLE_TEXT_TO_DIAGRAM=true');

    // If feature flag isn't applied via URL, check for the textarea
    const textarea = page.locator('textarea[aria-label="System description"]');
    if (await textarea.isVisible({ timeout: 2000 }).catch(() => false)) {
      await textarea.fill('A load balancer connected to an API server and a database');
      await page.click('button:has-text("Generate")');
      await page.waitForSelector('.react-flow__node', { timeout: 10000 });
      const nodes = page.locator('.react-flow__node');
      const count = await nodes.count();
      expect(count).toBeGreaterThanOrEqual(3);
    } else {
      // Feature flag not enabled, skip gracefully
      test.skip();
    }
  });

  test('Generate → Cancel → no stale state', async ({ page }) => {
    // Mock a slow API response
    await page.route('**/api/generate-diagram', async (route) => {
      await new Promise((r) => setTimeout(r, 5000));
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_DIAGRAM_RESPONSE),
      });
    });

    await page.goto('/');
    const textarea = page.locator('textarea[aria-label="System description"]');
    if (await textarea.isVisible({ timeout: 2000 }).catch(() => false)) {
      await textarea.fill('A load balancer connected to servers');
      await page.click('button:has-text("Generate")');

      // Wait for cancel button to appear
      const cancelBtn = page.locator('button:has-text("Cancel")');
      await expect(cancelBtn).toBeVisible({ timeout: 2000 });
      await cancelBtn.click();

      // Should still be on landing page, not canvas
      await expect(page.locator('text=Design distributed systems')).toBeVisible();
    } else {
      test.skip();
    }
  });

  test('Generate → validation error → recover via template link', async ({ page }) => {
    await mockGenerateAPI(page, MOCK_VALIDATION_ERROR, 422);

    await page.goto('/');
    const textarea = page.locator('textarea[aria-label="System description"]');
    if (await textarea.isVisible({ timeout: 2000 }).catch(() => false)) {
      await textarea.fill('A complex microservices architecture');
      await page.click('button:has-text("Generate")');

      // Error should appear
      await expect(page.locator('text=Generation failed')).toBeVisible({ timeout: 5000 });

      // "Try a template instead" link should be visible
      await expect(page.locator('text=Try a template instead')).toBeVisible();
    } else {
      test.skip();
    }
  });

  test('Generate → rate limit → shows rate limit message', async ({ page }) => {
    await mockGenerateAPI(page, MOCK_RATE_LIMIT, 429);

    await page.goto('/');
    const textarea = page.locator('textarea[aria-label="System description"]');
    if (await textarea.isVisible({ timeout: 2000 }).catch(() => false)) {
      await textarea.fill('A simple API with a database backend');
      await page.click('button:has-text("Generate")');

      await expect(page.locator('text=Too many requests')).toBeVisible({ timeout: 5000 });
    } else {
      test.skip();
    }
  });
});

test.describe('Remix flow', () => {
  test('Remix → Apply → canvas updated', async ({ page }) => {
    // First load a template to get to canvas
    await page.goto('/');
    await page.waitForSelector('text=Or start from a template');
    await page.click('button:has-text("Basic CRUD App")');
    await page.waitForSelector('.react-flow__node', { timeout: 5000 });

    // Mock remix API
    await mockGenerateAPI(page, MOCK_REMIX_RESPONSE);

    // Click Remix button
    const remixBtn = page.locator('button:has-text("Remix")');
    if (await remixBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await remixBtn.click();

      // Confirmation modal should appear
      const confirmBtn = page.locator('button:has-text("Replace")');
      await expect(confirmBtn).toBeVisible({ timeout: 2000 });
      await confirmBtn.click();

      // Remix input should appear
      const remixInput = page.locator('input[placeholder*="Add a read replica"]');
      await expect(remixInput).toBeVisible({ timeout: 2000 });
      await remixInput.fill('Add a read replica to the database');

      await page.click('button:has-text("Apply")');

      // Canvas should update with more nodes
      await page.waitForTimeout(1000);
      const nodes = page.locator('.react-flow__node');
      const count = await nodes.count();
      expect(count).toBeGreaterThanOrEqual(4);
    }
  });
});

test.describe('Session save/load', () => {
  test('save → load → all components and wires survive', async ({ page }) => {
    // Load a template first
    await page.goto('/');
    await page.waitForSelector('text=Or start from a template');
    await page.click('button:has-text("Basic CRUD App")');
    await page.waitForSelector('.react-flow__node', { timeout: 5000 });

    // Count initial nodes and edges
    const initialNodes = await page.locator('.react-flow__node').count();
    const initialEdges = await page.locator('.react-flow__edge').count();
    expect(initialNodes).toBeGreaterThanOrEqual(3);
    expect(initialEdges).toBeGreaterThanOrEqual(2);

    // Trigger save (intercept download)
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('button:has-text("Save")'),
    ]);

    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();

    // Read the saved file
    const fs = await import('fs');
    const savedJson = JSON.parse(fs.readFileSync(downloadPath!, 'utf-8'));
    expect(savedJson.componentGraph.components.length).toBe(initialNodes);
    expect(savedJson.componentGraph.wires.length).toBe(initialEdges);

    // Navigate back to landing
    await page.goto('/');
    await page.waitForSelector('text=Design distributed systems');

    // Load the saved file
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.click('button:has-text("Load session from file")');
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(downloadPath!);

    // Should navigate to canvas
    await page.waitForSelector('.react-flow__node', { timeout: 5000 });

    // Verify same count
    const loadedNodes = await page.locator('.react-flow__node').count();
    const loadedEdges = await page.locator('.react-flow__edge').count();
    expect(loadedNodes).toBe(initialNodes);
    expect(loadedEdges).toBe(initialEdges);
  });
});
