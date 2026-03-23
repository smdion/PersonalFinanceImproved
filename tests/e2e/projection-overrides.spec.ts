import { test, expect } from "@playwright/test";

test.describe("Retirement projection page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/retirement");
    await page.waitForLoadState("networkidle");
  });

  test("retirement page loads with projection content", async ({ page }) => {
    const bodyText = await page.locator("body").innerText();
    expect(bodyText.length).toBeGreaterThan(50);

    // Should show retirement/projection-related content
    const hasContent = /retirement|projection|year|balance|withdraw/i.test(
      bodyText,
    );
    const hasEmptyState = /no data|empty|configure/i.test(bodyText);

    expect(hasContent || hasEmptyState).toBeTruthy();
  });

  test("methodology sub-pages load without errors", async ({ page }) => {
    const methodologyPages = [
      "/retirement/methodology",
      "/retirement/accumulation-methodology",
      "/retirement/decumulation-methodology",
    ];

    for (const pagePath of methodologyPages) {
      const response = await page.goto(pagePath);
      expect(response).not.toBeNull();
      expect(response!.status()).toBeLessThan(500);

      const bodyText = await page.locator("body").innerText();
      expect(bodyText.length).toBeGreaterThan(100);
      expect(bodyText).not.toMatch(/application error/i);
    }
  });

  test("retirement page does not trigger error boundaries", async ({
    page,
  }) => {
    const errorOverlay = page.locator(
      "#__next-build-error, [data-nextjs-dialog]",
    );
    expect(await errorOverlay.count()).toBe(0);

    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toMatch(/unhandled/i);
    expect(bodyText).not.toMatch(/application error/i);
  });
});
