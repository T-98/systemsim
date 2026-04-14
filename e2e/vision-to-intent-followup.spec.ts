import { test, expect } from '@playwright/test';

const INTENT_RESPONSE_HIGH = {
  intent: 'We let users place orders. Payments and email confirmation run off a queue.',
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

const INTENT_RESPONSE_WITH_ITEMS = {
  intent: 'A meme voting app where users upload memes and vote on them.',
  components: [
    { label: 'API', type: 'server' },
    { label: 'Postgres', type: 'database' },
  ],
  connections: 'API --> Postgres',
  confidence: {
    intent: 'med',
    items: [
      { name: 'Image CDN', confidence: 'low', reasoning: 'Not mentioned; inferred from typical meme apps.' },
      { name: 'API --> Postgres', confidence: 'med', reasoning: 'Standard pattern assumed.' },
      { name: 'Postgres', confidence: 'high', reasoning: 'Explicit in the user text.' },
    ],
  },
  promptVersion: '2.0',
};

const INTENT_RESPONSE_REDERIVED = {
  intent: 'We let users place orders through a streamlined web flow with a cart and checkout.',
  components: [
    { label: 'Storefront', type: 'server' },
    { label: 'Cart Cache', type: 'cache' },
    { label: 'Checkout Service', type: 'server' },
    { label: 'Orders DB', type: 'database' },
  ],
  connections: [
    'Storefront --> Cart Cache',
    'Storefront --> Checkout Service',
    'Checkout Service --> Orders DB',
  ].join('\n'),
  confidence: { intent: 'high', items: [] },
  promptVersion: '2.0',
};

async function submitAndReachReview(page: import('@playwright/test').Page, prompt = 'A load balancer with API servers and a Postgres database handling order flow') {
  await page.route('**/api/describe-intent', (route) => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(INTENT_RESPONSE_HIGH) });
  });
  await page.goto('/');
  const textarea = page.locator('textarea[aria-label="System description"]');
  await expect(textarea).toBeVisible({ timeout: 3000 });
  await textarea.fill(prompt);
  await page.click('button:has-text("Generate")');
  await expect(page.getByRole('heading', { name: 'What you are building' })).toBeVisible({ timeout: 10000 });
}

test.describe('Intent header on canvas', () => {
  test('Generate → canvas shows intent header with the submitted intent', async ({ page }) => {
    await submitAndReachReview(page);
    await page.click('button:has-text("Generate diagram")');
    await page.waitForSelector('.react-flow__node', { timeout: 10000 });
    const header = page.getByLabel(/Edit intent: /);
    await expect(header).toBeVisible();
    await expect(header).toContainText(INTENT_RESPONSE_HIGH.intent);
  });

  test('inline edit on intent header saves on blur and persists', async ({ page }) => {
    await submitAndReachReview(page);
    await page.click('button:has-text("Generate diagram")');
    await page.waitForSelector('.react-flow__node', { timeout: 10000 });

    await page.getByLabel(/Edit intent: /).click();
    const editor = page.locator('textarea[aria-label="Edit intent"]');
    await expect(editor).toBeVisible({ timeout: 1000 });
    await editor.fill('A refined product vision, written by the founder.');
    await editor.blur();
    await expect(page.getByLabel(/Edit intent: A refined product vision/)).toBeVisible();
  });

  test('Escape cancels intent edit', async ({ page }) => {
    await submitAndReachReview(page);
    await page.click('button:has-text("Generate diagram")');
    await page.waitForSelector('.react-flow__node', { timeout: 10000 });

    const originalLabel = await page.getByLabel(/Edit intent: /).getAttribute('aria-label');
    await page.getByLabel(/Edit intent: /).click();
    const editor = page.locator('textarea[aria-label="Edit intent"]');
    await editor.fill('DELETED');
    await editor.press('Escape');
    await expect(page.getByLabel(originalLabel!)).toBeVisible({ timeout: 1000 });
  });

  test('template click clears any prior intent', async ({ page }) => {
    // First land on canvas with an intent set via V2I
    await submitAndReachReview(page);
    await page.click('button:has-text("Generate diagram")');
    await page.waitForSelector('.react-flow__node', { timeout: 10000 });
    await expect(page.getByLabel(/Edit intent: /)).toBeVisible();

    // Go back to landing, pick a template
    await page.goto('/');
    await page.waitForSelector('text=Or start from a template');
    const templateSection = page.locator('text=Or start from a template').locator('..');
    await templateSection.locator('button:has-text("Basic CRUD App")').click();
    await page.waitForSelector('.react-flow__node', { timeout: 5000 });

    // Intent header should still render but in placeholder state
    await expect(page.getByLabel('Add intent')).toBeVisible();
  });
});

test.describe('Session save/load with intent', () => {
  test('save → load → intent survives', async ({ page }) => {
    await submitAndReachReview(page);
    await page.click('button:has-text("Generate diagram")');
    await page.waitForSelector('.react-flow__node', { timeout: 10000 });

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('button:has-text("Save")'),
    ]);
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();

    const fs = await import('fs');
    const saved = JSON.parse(fs.readFileSync(downloadPath!, 'utf-8'));
    expect(saved.intent).toBe(INTENT_RESPONSE_HIGH.intent);

    await page.goto('/');
    await page.waitForSelector('text=Design distributed systems');
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.click('button:has-text("Load session from file")');
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(downloadPath!);

    await page.waitForSelector('.react-flow__node', { timeout: 5000 });
    await expect(page.getByLabel(/Edit intent: /)).toContainText(INTENT_RESPONSE_HIGH.intent);
  });
});

test.describe('Confidence panel', () => {
  test('collapsed by default with summary counts', async ({ page }) => {
    await page.route('**/api/describe-intent', (route) => {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(INTENT_RESPONSE_WITH_ITEMS) });
    });
    await page.goto('/');
    const textarea = page.locator('textarea[aria-label="System description"]');
    await expect(textarea).toBeVisible({ timeout: 3000 });
    await textarea.fill('A meme voting app with API and database');
    await page.click('button:has-text("Generate")');
    await expect(page.getByRole('heading', { name: 'What you are building' })).toBeVisible({ timeout: 10000 });

    const panel = page.locator('summary', { hasText: 'What did we see?' });
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('3 items flagged');
  });

  test('expands to show per-item reasoning', async ({ page }) => {
    await page.route('**/api/describe-intent', (route) => {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(INTENT_RESPONSE_WITH_ITEMS) });
    });
    await page.goto('/');
    const textarea = page.locator('textarea[aria-label="System description"]');
    await expect(textarea).toBeVisible({ timeout: 3000 });
    await textarea.fill('A meme voting app with API and database');
    await page.click('button:has-text("Generate")');
    await expect(page.getByRole('heading', { name: 'What you are building' })).toBeVisible({ timeout: 10000 });

    await page.locator('summary', { hasText: 'What did we see?' }).click();
    await expect(page.locator('text=Not mentioned; inferred from typical meme apps')).toBeVisible();
    await expect(page.locator('text=Standard pattern assumed')).toBeVisible();
  });
});

test.describe('Re-derive from intent', () => {
  test('edited intent → Re-derive → components + connections refresh', async ({ page }) => {
    let call = 0;
    await page.route('**/api/describe-intent', (route) => {
      call += 1;
      const body = call === 1 ? INTENT_RESPONSE_HIGH : INTENT_RESPONSE_REDERIVED;
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.goto('/');
    const textarea = page.locator('textarea[aria-label="System description"]');
    await expect(textarea).toBeVisible({ timeout: 3000 });
    await textarea.fill('An e-commerce order flow with API and database');
    await page.click('button:has-text("Generate")');
    await expect(page.getByRole('heading', { name: 'What you are building' })).toBeVisible({ timeout: 10000 });

    const intentField = page.locator('textarea[aria-label="What you are building"]');
    await intentField.fill('We let users place orders through a streamlined web flow with cart and checkout.');

    await page.click('button:has-text("Re-derive from intent")');
    // The re-derive swaps the review state with INTENT_RESPONSE_REDERIVED
    await expect(page.locator('textarea[aria-label="Connections"]')).toHaveValue(INTENT_RESPONSE_REDERIVED.connections, { timeout: 5000 });
    await expect(page.locator('text=4 components read')).toBeVisible();
  });

  test('Re-derive disabled when intent is too short', async ({ page }) => {
    await submitAndReachReview(page);
    const intentField = page.locator('textarea[aria-label="What you are building"]');
    await intentField.fill('short');
    const rederiveBtn = page.locator('button:has-text("Re-derive from intent")');
    await expect(rederiveBtn).toBeDisabled();
  });
});
