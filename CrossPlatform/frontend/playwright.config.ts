import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  // The first .NET backend launch on a GitHub runner includes cold JIT and assembly loading.
  // Keep this separate from the per-test timeout so readiness checks do not fail while the UI is
  // already running normally.
  expect: { timeout: 30_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
})
