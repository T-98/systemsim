import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // design-audit*.spec.ts are screenshot harnesses for /design-review, not regression tests.
  // Run explicitly: `pnpm exec playwright test e2e/design-audit.spec.ts` (or design-audit-wiki.spec.ts).
  testIgnore: ['**/design-audit*.spec.ts'],
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
