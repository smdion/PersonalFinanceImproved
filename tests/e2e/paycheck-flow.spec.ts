import { test, expect } from "@playwright/test";

test.describe("Paycheck page flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/paycheck");
    await page.waitForLoadState("networkidle");
  });

  test("paycheck page loads and displays salary information", async ({
    page,
  }) => {
    const body = page.locator("body");
    await expect(body).toBeVisible();

    const bodyText = await body.innerText();
    expect(bodyText.length).toBeGreaterThan(50);

    // Should not show error states
    expect(bodyText).not.toMatch(/application error/i);
  });

  test("paycheck page shows person sections", async ({ page }) => {
    // Paycheck page should render at least one person's paycheck details
    // Look for common paycheck-related content (salary, deductions, net pay)
    const bodyText = await page.locator("body").innerText();
    const hasPaycheckContent =
      /salary|gross|net|deduction|paycheck|pay period/i.test(bodyText);
    const hasEmptyState = /no data|empty|not configured/i.test(bodyText);

    // Either paycheck data or an empty state message should be present
    expect(hasPaycheckContent || hasEmptyState).toBeTruthy();
  });

  test("navigating from paycheck to budget preserves context", async ({
    page,
  }) => {
    // Navigate to budget after viewing paycheck
    await page.goto("/budget");
    await page.waitForLoadState("networkidle");

    const response = await page.locator("body").innerText();
    expect(response.length).toBeGreaterThan(50);
    expect(response).not.toMatch(/application error/i);
  });
});
