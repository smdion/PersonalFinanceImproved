import { test, expect } from "@playwright/test";

test.describe("Savings page flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/savings");
    await page.waitForLoadState("domcontentloaded");
  });

  test("savings page loads with fund cards or empty state", async ({
    page,
  }) => {
    await expect(page.locator("body")).toContainText(
      /savings|fund|goal|emergency|target|balance|no data|empty|create/i,
    );

    const bodyText = await page.locator("body").innerText();
    expect(bodyText.length).toBeGreaterThan(50);
  });

  test("savings page displays financial data", async ({ page }) => {
    const bodyText = await page.locator("body").innerText();

    // Should have dollar amounts or percentage progress
    const hasFinancialData = /\$[\d,]+|%/.test(bodyText);
    const hasEmptyState = /no data|empty|no funds|create/i.test(bodyText);

    expect(hasFinancialData || hasEmptyState).toBeTruthy();
  });

  test("savings page does not crash on render", async ({ page }) => {
    const errorOverlay = page.locator(
      "#__next-build-error, [data-nextjs-dialog]",
    );
    expect(await errorOverlay.count()).toBe(0);

    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toMatch(/unhandled/i);
    expect(bodyText).not.toMatch(/application error/i);
  });
});
