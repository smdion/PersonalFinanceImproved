import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  retries: 1,
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
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: process.env.CI
    ? {
        command: "node .next/standalone/server.js",
        url: "http://localhost:3000",
        reuseExistingServer: false,
        timeout: 30_000,
      }
    : undefined,
});
