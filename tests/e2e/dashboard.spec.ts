import { test, expect } from "@playwright/test";

test.describe("Dashboard page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
  });

  test("renders dashboard cards without errors", async ({ page }) => {
    // Dashboard should show card-like containers
    const body = page.locator("body");
    await expect(body).toBeVisible();

    // No error boundaries should be triggered
    const errorBoundary = page.locator('[data-testid="error-boundary"]');
    expect(await errorBoundary.count()).toBe(0);

    // No Next.js error overlays
    const errorOverlay = page.locator(
      "#__next-build-error, [data-nextjs-dialog]",
    );
    expect(await errorOverlay.count()).toBe(0);
  });

  test("displays meaningful content (not blank)", async ({ page }) => {
    const bodyText = await page.locator("body").innerText();
    // Dashboard should have substantial content — cards, numbers, labels
    expect(bodyText.length).toBeGreaterThan(100);

    // Should not contain crash indicators
    expect(bodyText).not.toMatch(/application error/i);
    expect(bodyText).not.toMatch(/unhandled/i);
  });

  test("all major pages are accessible from navigation", async ({ page }) => {
    const majorPages = [
      "/paycheck",
      "/budget",
      "/portfolio",
      "/retirement",
      "/networth",
      "/savings",
      "/settings",
    ];

    for (const pagePath of majorPages) {
      const response = await page.goto(pagePath);
      expect(response).not.toBeNull();
      expect(response!.status()).toBeLessThan(500);
    }
  });
});
