import { test, expect } from "@playwright/test";

test.describe("App health", () => {
  test("home page loads successfully", async ({ page }) => {
    const response = await page.goto("/");
    expect(response).not.toBeNull();
    expect(response!.status()).toBeLessThan(500);
    await expect(page).toHaveTitle(/Ledgr/);
  });

  test("tRPC endpoint is reachable", async ({ request }) => {
    // A bare GET to the tRPC route should return a response (even an error body)
    // rather than a network failure, proving the server is up.
    const response = await request.get("/api/trpc");
    expect(response.status()).toBeLessThan(500);
  });
});
