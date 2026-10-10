import { test, expect, type Page } from "@playwright/test";

/**
 * Privacy mode (hide dollar amounts).
 *
 * The leak scan visits every dashboard route with the privacy cookie set and
 * fails on any rendered "$<digit>". It is the safety net for money rendered
 * outside the shared format helpers (format.ts), now or in the future.
 * Elements marked `data-privacy-visible` (the growth-multiplier "per $1"
 * ratios, which aren't account amounts) are exempt.
 */

const PRIVACY_COOKIE = "ledgr-privacy";
const DOLLAR_AMOUNT = /\$\s?-?\d/;

// Mirrors the sidebar. Help and the methodology pages are static prose with
// dollar examples, and /demo is the profile picker.
const ROUTES = [
  "/",
  "/paycheck",
  "/budget",
  "/savings",
  "/expenses",
  "/portfolio",
  "/performance",
  "/brokerage",
  "/house",
  "/assets",
  "/liabilities",
  "/networth",
  "/historical",
  "/upkeep/utilities",
  "/retirement",
  "/contributions",
  "/analytics",
  "/tax-buckets",
  "/tax-optimization",
  "/tools",
  "/budget?tab=whatif",
  "/versions",
  "/settings",
  "/data-browser",
];

/** Visible text of the page, minus anything opted out of privacy masking. */
async function visibleText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const clone = document.body.cloneNode(true) as HTMLElement;
    clone
      .querySelectorAll("[data-privacy-visible], script, style")
      .forEach((el) => el.remove());
    return clone.innerText;
  });
}

async function waitForContent(page: Page) {
  await page.waitForLoadState("networkidle");
  await expect
    .poll(async () => (await visibleText(page)).length, { timeout: 30_000 })
    .toBeGreaterThan(100);
}

test.describe("Privacy mode", () => {
  test("no dollar amount is visible on any route when the cookie is set", async ({
    page,
    context,
    baseURL,
  }) => {
    test.setTimeout(10 * 60_000);
    await context.addCookies([
      { name: PRIVACY_COOKIE, value: "1", url: baseURL! },
    ]);

    const leaks: string[] = [];
    for (const route of ROUTES) {
      await page.goto(route);
      await waitForContent(page);
      const match = (await visibleText(page)).match(
        new RegExp(`.{0,40}${DOLLAR_AMOUNT.source}.{0,20}`),
      );
      if (match) leaks.push(`${route}: …${match[0].replace(/\s+/g, " ")}…`);
    }
    expect(leaks, leaks.join("\n")).toEqual([]);
  });

  test("the server never sends amounts while the cookie is set", async ({
    context,
    baseURL,
  }) => {
    await context.addCookies([
      { name: PRIVACY_COOKIE, value: "1", url: baseURL! },
    ]);
    for (const route of ["/", "/portfolio", "/retirement", "/performance"]) {
      const res = await context.request.get(route);
      const html = (await res.text())
        .replace(/<script[\s\S]*?<\/script>/g, "")
        .replace(/<style[\s\S]*?<\/style>/g, "")
        .replace(/<[^>]+>/g, " ");
      expect(html, route).not.toMatch(DOLLAR_AMOUNT);
    }
  });

  test("the toggle button hides and restores amounts and sets the cookie", async ({
    page,
    context,
  }) => {
    // Not the dashboard: on a fresh install (CI's SQLite demo database has
    // no household) "/" opens the first-run wizard as a full-screen modal
    // that intercepts clicks on the sidebar toggle. Net Worth always renders
    // amounts ($0.00 on an empty database) and has no wizard.
    await page.goto("/networth");
    await waitForContent(page);
    await expect
      .poll(async () => DOLLAR_AMOUNT.test(await visibleText(page)))
      .toBe(true);

    await page.getByRole("button", { name: "Hide amounts" }).first().click();
    await expect
      .poll(async () => DOLLAR_AMOUNT.test(await visibleText(page)))
      .toBe(false);
    const cookies = await context.cookies();
    expect(cookies.find((c) => c.name === PRIVACY_COOKIE)?.value).toBe("1");

    // Survives a reload.
    await page.reload();
    await waitForContent(page);
    expect(DOLLAR_AMOUNT.test(await visibleText(page))).toBe(false);

    await page.getByRole("button", { name: "Show amounts" }).first().click();
    await expect
      .poll(async () => DOLLAR_AMOUNT.test(await visibleText(page)))
      .toBe(true);
    expect(
      (await context.cookies()).find((c) => c.name === PRIVACY_COOKIE),
    ).toBeUndefined();
  });

  test("squiggle font stays reachable through the page font stack", async ({
    page,
    context,
    baseURL,
  }) => {
    // If next/font ever stops registering plain family names or Tailwind
    // changes its font variables, the mask silently renders as empty boxes.
    await context.addCookies([
      { name: PRIVACY_COOKIE, value: "1", url: baseURL! },
    ]);
    await page.goto("/");
    await waitForContent(page);
    const family = await page.evaluate(
      () => getComputedStyle(document.documentElement).fontFamily,
    );
    expect(family).toContain("Ledgr Redacted");
    const loaded = await page.evaluate(
      async () =>
        (await document.fonts.load('16px "Ledgr Redacted"', "")).length,
    );
    expect(loaded).toBeGreaterThan(0);
  });
});
