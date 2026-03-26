import { test, expect } from "@playwright/test";

test.describe("Data pages and sync-related flows", () => {
  test("portfolio page loads and shows account data or empty state", async ({
    page,
  }) => {
    await page.goto("/portfolio");
    await page.waitForLoadState("domcontentloaded");

    const bodyText = await page.locator("body").innerText();
    expect(bodyText.length).toBeGreaterThan(50);

    const hasContent = /portfolio|account|balance|allocation|fund/i.test(
      bodyText,
    );
    const hasEmptyState = /no data|empty|not configured/i.test(bodyText);

    expect(hasContent || hasEmptyState).toBeTruthy();
  });

  test("contributions page loads without errors", async ({ page }) => {
    await page.goto("/contributions");
    await page.waitForLoadState("domcontentloaded");

    const bodyText = await page.locator("body").innerText();
    expect(bodyText.length).toBeGreaterThan(50);
    expect(bodyText).not.toMatch(/application error/i);
  });

  test("expenses page loads without errors", async ({ page }) => {
    await page.goto("/expenses");
    await page.waitForLoadState("domcontentloaded");

    const bodyText = await page.locator("body").innerText();
    expect(bodyText.length).toBeGreaterThan(50);
    expect(bodyText).not.toMatch(/application error/i);
  });

  test("historical page loads without errors", async ({ page }) => {
    await page.goto("/historical");
    await page.waitForLoadState("domcontentloaded");

    const bodyText = await page.locator("body").innerText();
    expect(bodyText.length).toBeGreaterThan(50);
    expect(bodyText).not.toMatch(/application error/i);
  });

  test("data browser page loads without errors", async ({ page }) => {
    await page.goto("/data-browser");
    await page.waitForLoadState("domcontentloaded");

    const bodyText = await page.locator("body").innerText();
    expect(bodyText.length).toBeGreaterThan(50);
    expect(bodyText).not.toMatch(/application error/i);
  });
});
