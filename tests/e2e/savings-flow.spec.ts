import { test, expect } from "@playwright/test";

test.describe("Savings page flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/savings");
    await page.waitForLoadState("networkidle");
  });

  test("savings page loads with fund cards or empty state", async ({
    page,
  }) => {
    const bodyText = await page.locator("body").innerText();
    expect(bodyText.length).toBeGreaterThan(50);

    // Should show savings-related content or an empty state
    const hasSavingsContent =
      /savings|fund|goal|emergency|target|balance/i.test(bodyText);
    const hasEmptyState = /no data|empty|no funds|create/i.test(bodyText);

    expect(hasSavingsContent || hasEmptyState).toBeTruthy();
  });

  test("savings page does not crash on render", async ({ page }) => {
    // No error overlays
    const errorOverlay = page.locator(
      "#__next-build-error, [data-nextjs-dialog]",
    );
    expect(await errorOverlay.count()).toBe(0);

    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toMatch(/unhandled/i);
    expect(bodyText).not.toMatch(/application error/i);
  });
});
