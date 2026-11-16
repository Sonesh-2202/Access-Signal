import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end tests run against a live stack (seeded backend + Vite).
 *   cd backend && python -m scripts.seed_demo --reset && uvicorn app.main:app
 *   cd frontend && npm run test:e2e            # starts Vite itself unless E2E_BASE_URL is set
 * The report-submission test writes to the database; reseed afterwards for a clean demo.
 */
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:5180'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45_000,
  retries: 0,
  use: {
    baseURL,
    trace: 'retain-on-failure',
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: 'npx vite --port 5180 --strictPort', url: baseURL, reuseExistingServer: true, timeout: 60_000 },
})
