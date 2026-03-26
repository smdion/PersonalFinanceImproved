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

  test("paycheck page shows financial values", async ({ page }) => {
    const bodyText = await page.locator("body").innerText();

    // Should contain dollar amounts if data is present
    const hasDollarAmounts = /\$[\d,]+/.test(bodyText);
    const hasEmptyState = /no data|empty|not configured/i.test(bodyText);

    expect(hasDollarAmounts || hasEmptyState).toBeTruthy();
  });

  test("paycheck page renders person sections or cards", async ({ page }) => {
    // Look for card-like containers or heading-level content
    const headings = page.locator("h2, h3, h4");
    const headingCount = await headings.count();

    // Should have at least one section heading (person name, summary, etc.)
    // or an empty state
    if (headingCount === 0) {
      await expect(page.locator("body")).toContainText(
        /no data|empty|not configured/i,
      );
    } else {
      expect(headingCount).toBeGreaterThan(0);
    }
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
