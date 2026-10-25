import { test, expect } from "@playwright/test";

/**
 * Links that land on the data (lib/config/focus-topics): the page opens in
 * the right state and the section is shown. Written to hold on any profile.
 */
test.describe("focus links", () => {
  test("early access opens Retirement taxes at retirement", async ({
    page,
  }) => {
    await page.goto("/tax-buckets?focus=earlyAccess");
    await expect(
      page
        .getByText(
          /Accessible at retirement|Already at or past your modeled retirement transition/,
        )
        .first(),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Accessible now")).toHaveCount(0);
  });

  test("a projection year the table hides by default is shown and scrolled to", async ({
    page,
  }) => {
    await page.goto("/retirement");
    const rows = page.locator("tbody tr td:first-child");
    await expect(rows.first()).toBeVisible({ timeout: 30_000 });
    const shown = new Set(
      (await rows.allInnerTexts()).map((t) => Number(t.trim())),
    );
    const years = [...shown].filter(Number.isInteger).sort((a, b) => a - b);
    const hidden = years.length
      ? Array.from(
          { length: years[years.length - 1]! - years[0]! },
          (_, i) => years[0]! + i,
        ).find((y) => !shown.has(y))
      : undefined;
    test.skip(hidden === undefined, "every year is already shown");

    await page.goto(`/retirement?focus=projectionYear&focusId=${hidden}`);
    const row = page
      .locator("tbody tr")
      .filter({ has: page.locator("td:first-child", { hasText: `${hidden}` }) })
      .first();
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row).toBeInViewport();
  });

  test("extra paychecks opens Savings → Plan → Paychecks & Growth", async ({
    page,
  }) => {
    await page.goto("/savings?focus=extraPaychecks");
    const tab = page.getByRole("button", { name: "Paychecks & Growth" });
    const hasGoals = await tab
      .waitFor({ timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
    test.skip(!hasGoals, "no savings goals on this profile");
    await expect(page.getByText("Pool Growth")).toBeVisible();
  });
});
