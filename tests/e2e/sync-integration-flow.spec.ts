import { test, expect } from "@playwright/test";

/**
 * Sync integration journey — v0.5 expert-review M18.
 *
 * Covers the user-facing YNAB connection setup flow in Settings →
 * Integrations, with the YNAB HTTP call stubbed at the tRPC edge so
 * the test is deterministic and never hits api.ynab.com. The existing
 * sync-flow.spec.ts covers page-load smoke; this spec drives the
 * interactive flow: enter token → fetch budgets → verify the dropdown
 * populates from the mocked response.
 *
 * We stub the tRPC *response* rather than the upstream api.ynab.com
 * fetch because fetchYnabBudgets runs server-side — the browser never
 * talks to YNAB directly, so a page.route() on api.ynab.com would not
 * intercept anything. Intercepting the tRPC batch endpoint matches the
 * actual network boundary Playwright can observe.
 *
 * Mock payload mirrors the real YNAB /budgets response shape that
 * src/server/routers/sync-connections.ts#fetchYnabBudgets returns, so
 * the mutation's onSuccess handler populates state the same way it
 * would in production.
 */
test.describe("Sync integration journey (M18)", () => {
  test.beforeEach(async ({ page }) => {
    // Intercept the tRPC endpoint used by the "Fetch" button. Playwright
    // matches against the full URL so we use a glob that tolerates
    // tRPC's batch suffix and input query param.
    await page.route(/\/api\/trpc\/sync\.fetchYnabBudgets/, async (route) => {
      // tRPC's httpBatchLink expects a JSON array keyed by the batch
      // position. Single-mutation calls still come through as an
      // array of length 1. Return a success-shaped response.
      const body = [
        {
          result: {
            data: {
              success: true,
              budgets: [
                {
                  id: "budget-test-uuid-1",
                  name: "Test Budget (E2E mock)",
                  lastModified: "2026-04-12T00:00:00.000Z",
                },
                {
                  id: "budget-test-uuid-2",
                  name: "Secondary Budget (E2E mock)",
                  lastModified: "2026-04-11T00:00:00.000Z",
                },
              ],
            },
          },
        },
      ];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    });
  });

  test("settings → integrations tab renders the YNAB service card", async ({
    page,
  }) => {
    await page.goto("/settings?tab=integrations");
    await page.waitForLoadState("domcontentloaded");

    // The page may or may not open the integrations tab by default
    // depending on URL handling; if not, click the tab.
    const tab = page.getByRole("button", { name: /^Integrations$/i });
    if ((await tab.count()) > 0) {
      await tab.click();
    }

    // Both service cards should be present.
    await expect(page.getByText(/YNAB/).first()).toBeVisible();
  });

  test("entering a token + clicking Fetch populates the budget dropdown", async ({
    page,
  }) => {
    await page.goto("/settings");
    await page.waitForLoadState("domcontentloaded");

    // Click into Integrations tab.
    const tab = page.getByRole("button", { name: /^Integrations$/i });
    if ((await tab.count()) > 0) {
      await tab.click();
    }

    // Find the YNAB token input via its placeholder. If the connection
    // already exists, the form may be collapsed behind "Update Key" —
    // click that first so the inputs are visible.
    const updateKey = page.getByRole("button", { name: /Update Key/i });
    if ((await updateKey.count()) > 0) {
      await updateKey.click();
    }

    const tokenInput = page
      .locator('input[placeholder="Enter YNAB token"]')
      .first();
    await expect(tokenInput).toBeVisible();
    await tokenInput.fill("fake-test-token");

    const fetchBtn = page.getByRole("button", { name: /^Fetch$/i });
    await fetchBtn.click();

    // After the mocked response resolves, the <select> should appear
    // with the mocked budgets as options.
    const budgetSelect = page
      .locator("select")
      .filter({ hasText: /Test Budget \(E2E mock\)/ })
      .first();
    await expect(budgetSelect).toBeVisible({ timeout: 5000 });
    await expect(
      budgetSelect.locator("option", {
        hasText: /Test Budget \(E2E mock\)/,
      }),
    ).toBeAttached();
  });
});
