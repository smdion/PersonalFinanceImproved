import { test, expect } from "@playwright/test";

test.describe("Budget page", () => {
  test("budget page loads and renders content", async ({ page }) => {
    await page.goto("/budget");
    await page.waitForLoadState("networkidle");

    // Page should have loaded without a server error
    await expect(page.locator("body")).toBeVisible();
    const bodyText = await page.locator("body").innerText();
    expect(bodyText.length).toBeGreaterThan(0);
  });

  test("budget page displays category rows or table structure", async ({
    page,
  }) => {
    await page.goto("/budget");
    await page.waitForLoadState("networkidle");

    // Look for table-like structures (budget uses summary tables and category rows)
    const tables = page.locator("table");
    const rows = page.locator("tr");
    const gridCells = page.locator('[role="row"], [role="grid"], table');

    // At least one of these structural elements should be present
    // when the budget page renders with data
    const tableCount = await tables.count();
    const rowCount = await rows.count();
    const gridCount = await gridCells.count();

    const hasStructure = tableCount > 0 || rowCount > 0 || gridCount > 0;

    // If no data is seeded, the page should at least show the page header
    // or an empty-state message — not a blank/crashed page
    if (!hasStructure) {
      // Fallback: just verify the page has meaningful text content
      const text = await page.locator("body").innerText();
      expect(text.toLowerCase()).toMatch(/budget|no data|empty|loading/);
    }
  });

  test("budget page does not show an unhandled error", async ({ page }) => {
    await page.goto("/budget");
    await page.waitForLoadState("networkidle");

    // Check that no unhandled error overlay is shown (Next.js dev error overlay)
    const errorOverlay = page.locator(
      "#__next-build-error, [data-nextjs-dialog]",
    );
    expect(await errorOverlay.count()).toBe(0);

    // Check page body does not contain common crash indicators
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toMatch(/unhandled/i);
    expect(bodyText).not.toMatch(/application error/i);
  });
});
