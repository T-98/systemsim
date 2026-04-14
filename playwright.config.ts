import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // design-audit.spec.ts is a screenshot harness for /design-review, not a regression test.
  // Run it explicitly: `pnpm exec playwright test e2e/design-audit.spec.ts`
  testIgnore: ['**/design-audit.spec.ts'],
  timeout: 30000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:5180',
    headless: true,
  },
  webServer: {
    command: 'VITE_ENABLE_TEXT_TO_DIAGRAM=true pnpm dev',
    port: 5180,
    reuseExistingServer: true,
    timeout: 15000,
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
});
