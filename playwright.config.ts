// Configure serial browser workflow tests and their local servers.
import { defineConfig } from '@playwright/test';
import { browserExecutable } from './src/application/audit/adapters/browser-config.js';

export default defineConfig({
  testDir: './tests/ui',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: 'http://127.0.0.1:4173',
    browserName: 'chromium',
    launchOptions: {
      ...(browserExecutable() ? { executablePath: browserExecutable()! } : {}),
    },
    screenshot: 'off',
    trace: 'off',
    video: 'off',
  },
  webServer: {
    command: 'npx tsx tests/ui/server.ts',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
