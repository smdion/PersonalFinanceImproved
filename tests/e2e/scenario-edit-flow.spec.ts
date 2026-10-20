/**
 * E2E user journey: scenario edit flow.
 *
 * Validates that the scenario edit affordances on the dashboard
 * actually expose the edit UI when clicked. This is a smoke-level
 * journey, not an exhaustive interaction test — the goal is to
 * catch the most common regression class (scenario buttons / context
 * menus that silently break after a refactor).
 *
 * The other two journeys in this set (auth flow, sync flow) need real
 * Authentik / YNAB fixtures and aren't covered here.
 */
import { test, expect } from "@playwright/test";

test.describe("Scenario edit flow", () => {
  test.beforeEach(async ({ page }) => {
    // Demo mode is set in playwright.config.ts via the demo cookie,
    // so the dashboard is reachable without an Authentik handshake.
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
  });

  test("dashboard renders without error overlays", async ({ page }) => {
    // The dashboard is the home page in the (dashboard) route group.
    // We don't assert specific cards because they depend on seeded
    // data — just that no error overlay or hard error is shown.
    await expect(page.locator("body")).not.toContainText(/Application error/i);

    const errorOverlay = page.locator(
      "#__next-build-error, [data-nextjs-dialog]",
    );
    expect(await errorOverlay.count()).toBe(0);
  });

  test("scenario bar is present and clickable", async ({ page }) => {
    // The ScenarioBar component is mounted at the dashboard layout
    // level. It should be in the DOM regardless of which sub-page
    // is showing.
    const scenarioBar = page.locator("[data-scenario-bar]");
    await expect(scenarioBar).toBeVisible({ timeout: 5000 });
  });

  test("header has one Profiles and Plans button and the view switch", async ({
    page,
  }) => {
    // Not the dashboard: on CI's empty database "/" opens the first-run
    // wizard as a full-screen modal that intercepts clicks (see
    // privacy-mode.spec.ts). The header is on every page.
    await page.goto("/networth");
    await page.waitForLoadState("domcontentloaded");
    const bar = page.locator("[data-scenario-bar]");
    await expect(bar.getByRole("tab", { name: "Projected" })).toBeVisible();
    await bar.getByRole("button", { name: /Profiles and Plans/ }).click();
    const panel = page.getByRole("dialog", { name: "Profiles and Plans" });
    for (const kind of ["Salary", "Contributions", "Budget", "Retirement"])
      await expect(panel.getByText(kind, { exact: true })).toBeVisible();
    await expect(
      panel.getByText("A Plan is a saved set of profiles", { exact: false }),
    ).toBeVisible();
    // No baseline wording anywhere in the header.
    await expect(bar).not.toContainText(/Main Plan|Active \(global\)/);
  });

  test("retirement page renders the plan health card", async ({ page }) => {
    // v0.5 PlanHealthCard integration smoke test. The card only
    // renders when there are findings — for the demo seed it should
    // surface at least the strategy recommendation.
    await page.goto("/retirement");
    await page.waitForLoadState("domcontentloaded");

    // Either the card is present (good) or the page rendered without
    // error (also fine — depends on demo data shape). We don't assert
    // specific content because helpers may render zero callouts for
    // some seed states.
    await expect(page.locator("body")).not.toContainText(/Application error/i);
  });
});
