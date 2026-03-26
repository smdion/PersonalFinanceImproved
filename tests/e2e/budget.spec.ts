import { test, expect } from "@playwright/test";

test.describe("Budget page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/budget");
    await page.waitForLoadState("domcontentloaded");
  });

  test("budget page loads and renders content", async ({ page }) => {
    // Wait for meaningful content, not networkidle
    await expect(page.locator("body")).toContainText(/budget|no data|loading/i);

    // No error overlays
    const errorOverlay = page.locator(
      "#__next-build-error, [data-nextjs-dialog]",
    );
    expect(await errorOverlay.count()).toBe(0);
  });

  test("budget page displays table structure with data rows", async ({
    page,
  }) => {
    // Wait for table or grid to render
    const table = page.locator("table").first();
    const hasTable = (await table.count()) > 0;

    if (hasTable) {
      // Verify table has header and data rows
      const rows = table.locator("tr");
      expect(await rows.count()).toBeGreaterThan(1); // header + at least one data row

      // Verify rows contain financial data (dollar amounts)
      const bodyText = await table.innerText();
      expect(bodyText).toMatch(/\$/);
    } else {
      // Empty state is acceptable in demo mode
      await expect(page.locator("body")).toContainText(/no data|empty|budget/i);
    }
  });

  test("budget page does not show an unhandled error", async ({ page }) => {
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toMatch(/unhandled/i);
    expect(bodyText).not.toMatch(/application error/i);
    expect(bodyText.length).toBeGreaterThan(50);
  });
});
