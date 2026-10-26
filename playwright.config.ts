// Configure serial browser workflow tests and their local servers.
import { browserExecutable } from './src/application/audit/adapters/browser-config.js';
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/ui', testMatch: '**/*.spec.ts', fullyParallel: false, workers: 1,
  timeout: 30_000, expect: { timeout: 10_000 },
  use: { baseURL: 'http://127.0.0.1:4173', browserName: 'chromium', launchOptions: { ...(browserExecutable() ? { executablePath: browserExecutable()! } : {}) }, trace: 'off', screenshot: 'off', video: 'off' },
  webServer: {
    command: 'npx tsx tests/ui/server.ts', url: 'http://127.0.0.1:4173',
    reuseExistingServer: false, timeout: 30_000,
  },
});
