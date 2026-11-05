import { defineConfig, devices } from "@playwright/test";

const NON_DEMO_SPECS = [
  /auth-flow\.spec\.ts$/,
  /sync-integration-flow\.spec\.ts$/,
];

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  // One retry keeps a failure's trace; in CI a test that passes only on
  // the retry still fails the run, so a flaky test is named, not hidden.
  retries: 1,
  failOnFlakyTests: !!process.env.CI,
  forbidOnly: !!process.env.CI,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    // In demo-only mode, pre-set a demo profile cookie so dashboard pages
    // render content instead of redirecting to the profile selector.
    ...(process.env.DEMO_ONLY === "true" && {
      storageState: {
        cookies: [
          {
            name: "demo_active_profile",
            value: "single-income",
            domain: "localhost",
            path: "/",
            expires: -1,
            httpOnly: false,
            secure: false,
            sameSite: "Lax" as const,
          },
        ],
        origins: [],
      },
    }),
  },
  projects: [
    {
      name: "chromium",
      testIgnore: NON_DEMO_SPECS,
      use: { ...devices["Desktop Chrome"] },
    },
    // Sign-in and admin pages DEMO_ONLY hides: run against a real install
    // with its first admin (scripts/ci-image-boot.sh, after first-run).
    {
      name: "non-demo",
      testMatch: NON_DEMO_SPECS,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // CI starts the standalone build, unless PLAYWRIGHT_BASE_URL points at a
  // server already running (scripts/ci-image-boot.sh's booted container).
  webServer:
    process.env.CI && !process.env.PLAYWRIGHT_BASE_URL
      ? {
          command: "node .next/standalone/server.js",
          url: "http://localhost:3000",
          reuseExistingServer: false,
          timeout: 30_000,
        }
      : undefined,
});
