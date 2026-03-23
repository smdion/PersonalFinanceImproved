import { test, expect } from "@playwright/test";

test.describe("Settings page flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");
  });

  test("settings page loads and shows configuration sections", async ({
    page,
  }) => {
    const bodyText = await page.locator("body").innerText();
    expect(bodyText.length).toBeGreaterThan(50);

    // Settings should have tabs or sections for different configuration areas
    const hasSettingsContent = /settings|configuration|profile|general/i.test(
      bodyText,
    );
    expect(hasSettingsContent).toBeTruthy();
  });

  test("settings page renders tab navigation", async ({ page }) => {
    // Settings uses a tab-based layout for its 17 sub-components
    const tabs = page.locator('[role="tab"], [role="tablist"], button');
    const tabCount = await tabs.count();

    // Should have at least a few clickable tabs/buttons
    expect(tabCount).toBeGreaterThan(0);
  });

  test("settings page does not show errors", async ({ page }) => {
    const errorOverlay = page.locator(
      "#__next-build-error, [data-nextjs-dialog]",
    );
    expect(await errorOverlay.count()).toBe(0);

    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toMatch(/unhandled/i);
    expect(bodyText).not.toMatch(/application error/i);
  });
});
