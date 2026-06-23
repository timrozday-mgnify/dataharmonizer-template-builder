import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './frontend/tests',
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'on-first-retry'
  },
  webServer: [
    {
      command: 'env PYTHONPATH=src:../linkml-lib/src uvicorn dataharmonizer_template_builder.api:app --host 127.0.0.1 --port 8765',
      url: 'http://127.0.0.1:8765/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000
    },
    {
      command: 'npm run dev -- --port 5173',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000
    }
  ],
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ]
});
