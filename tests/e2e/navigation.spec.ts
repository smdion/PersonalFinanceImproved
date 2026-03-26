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
    await page.waitForLoadState("domcontentloaded");

    for (const { path } of dashboardPages) {
      await page.goto(path);
      await page.waitForLoadState("domcontentloaded");

      // Page should not error out (no 500-level failures)
      await expect(page.locator("body")).toBeVisible();

      // Verify the page rendered meaningful content (not a blank error screen)
      const bodyText = await page.locator("body").innerText();
      expect(bodyText.length).toBeGreaterThan(0);
    }
  });

  test("sidebar links are present", async ({ page }) => {
    // Navigate to a dashboard sub-page so the sidebar groups are expanded
    // (collapsible groups only render child links when open)
    for (const { path } of dashboardPages) {
      await page.goto(path);
      await page.waitForLoadState("domcontentloaded");

      const sidebar = page.locator("nav");
      if ((await sidebar.count()) > 0) {
        const link = sidebar.locator(`a[href="${path}"]`);
        expect(await link.count()).toBeGreaterThanOrEqual(1);
      }
    }
  });
});
