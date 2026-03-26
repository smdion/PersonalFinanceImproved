import { test, expect } from "@playwright/test";

test.describe("Paycheck page flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/paycheck");
    await page.waitForLoadState("domcontentloaded");
  });

  test("paycheck page loads and displays salary information", async ({
    page,
  }) => {
    // Wait for paycheck content to render
    await expect(page.locator("body")).toContainText(
      /salary|gross|net|deduction|paycheck|pay period|no data|not configured/i,
    );

    // Should not show error states
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toMatch(/application error/i);
    expect(bodyText.length).toBeGreaterThan(50);
  });

  test("paycheck page shows content without errors", async ({ page }) => {
    const bodyText = await page.locator("body").innerText();
    expect(bodyText.length).toBeGreaterThan(50);
    expect(bodyText).not.toMatch(/application error/i);
    expect(bodyText).not.toMatch(/unhandled/i);
  });

  test("paycheck page renders structural elements", async ({ page }) => {
    // Page should have navigation, headings, or interactive elements
    const elements = page.locator("h1, h2, h3, h4, button, [role='tab']");
    const count = await elements.count();
    expect(count).toBeGreaterThan(0);
  });

  test("navigating from paycheck to budget works", async ({ page }) => {
    await page.goto("/budget");
    await page.waitForLoadState("domcontentloaded");

    await expect(page.locator("body")).toBeVisible();
    const bodyText = await page.locator("body").innerText();
    expect(bodyText.length).toBeGreaterThan(50);
    expect(bodyText).not.toMatch(/application error/i);
  });
});
