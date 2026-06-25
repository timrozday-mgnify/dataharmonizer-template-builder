import { defineConfig, devices } from '@playwright/test';
import fs from 'node:fs';

// COMPOSE_TEST_URL points at an already-running `docker compose` stack
// (single container serving frontend + backend, see scripts/test_compose.sh)
// — nothing to spawn there, unlike the two-process dev setup below.
const composeUrl = process.env.COMPOSE_TEST_URL;
const python = fs.existsSync('.venv/bin/python') ? '.venv/bin/python' : 'python';

export default defineConfig({
  testDir: './frontend/tests',
  timeout: 30_000,
  use: {
    baseURL: composeUrl ?? 'http://127.0.0.1:5173',
    trace: 'on-first-retry'
  },
  webServer: composeUrl
    ? undefined
    : [
        {
          command: `env PYTHONPATH=src:../linkml-lib/src ${python} manage.py runserver 127.0.0.1:8765 --noreload`,
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
