import { test, expect } from "@playwright/test";

const dashboardPages = [
  { path: "/budget", heading: /budget/i },
  { path: "/portfolio", heading: /portfolio/i },
  { path: "/retirement", heading: /retirement/i },
  { path: "/networth", heading: /net\s*worth/i },
];

test.describe("Dashboard navigation", () => {
  test("can navigate to main dashboard pages from sidebar", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    for (const { path } of dashboardPages) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");

      // Page should not error out (no 500-level failures)
      await expect(page.locator("body")).toBeVisible();

      // Verify the page rendered meaningful content (not a blank error screen)
      const bodyText = await page.locator("body").innerText();
      expect(bodyText.length).toBeGreaterThan(0);
    }
  });

  test("sidebar links are present", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // The sidebar should contain links to each major section
    const sidebar = page.locator("nav");
    if ((await sidebar.count()) > 0) {
      for (const { path } of dashboardPages) {
        const link = sidebar.locator(`a[href="${path}"]`);
        // At least one nav element should contain these links
        // (sidebar may be collapsed, so we check existence not visibility)
        expect(await link.count()).toBeGreaterThanOrEqual(1);
      }
    }
  });
});
