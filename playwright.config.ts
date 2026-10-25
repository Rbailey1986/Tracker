import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60000,
  use: { baseURL: 'http://127.0.0.1:4319', viewport: { width: 1360, height: 900 } },
  webServer: {
    command: 'npx vite build --logLevel warn && npx tsx tests/e2e/server.ts',
    url: 'http://127.0.0.1:4319/api/overview',
    reuseExistingServer: false,
    timeout: 120000,
  },
});
