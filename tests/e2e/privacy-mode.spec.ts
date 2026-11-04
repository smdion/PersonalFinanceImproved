import { useOwnRateLimitBucket } from "./rate-limit-bucket";
import { seedPrivacyHousehold } from "./privacy-household";
import { test, expect, type Page } from "@playwright/test";

/**
 * Privacy mode (hide dollar amounts).
 *
 * The leak scan visits every dashboard route with the privacy cookie set and
 * fails on any rendered "$<digit>". It is the safety net for money rendered
 * outside the shared format helpers (format.ts), now or in the future.
 * Elements marked `data-privacy-visible` (the growth-multiplier "per $1"
 * ratios, which aren't account amounts) are exempt.
 *
 * CI's database starts empty (fresh SQLite, DEMO_ONLY), where a route with
 * no amounts passes the scan trivially: the spec seeds one invented
 * household first (privacy-household.ts, when SQLITE_PATH names the
 * server's database), and the full report is checked to show an amount
 * with privacy off before it is checked to hide them with privacy on.
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
  "/recommendations",
  "/milestones",
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

/** Amounts arrive via client queries after hydration — slow CI runners
 *  need more than expect.poll's 5 s default. */
async function expectAmountsShown(page: Page, shown: boolean) {
  await expect
    .poll(async () => DOLLAR_AMOUNT.test(await visibleText(page)), {
      timeout: 30_000,
    })
    .toBe(shown);
}

/** The report's title. A CSS locator, not a role: the report is hidden
 *  on screen (print-only), and role locators skip hidden elements. */
function reportHeading(page: Page) {
  return page.locator("h1", { hasText: "Retirement Projection Report" });
}

/** The full report's text (print-only, mounted once the report gate
 *  passes), minus anything opted out of privacy masking. */
async function reportText(page: Page): Promise<string> {
  // The report's own root: the nearest print-only block around the title.
  return reportHeading(page)
    .locator(
      "xpath=ancestor::div[contains(concat(' ', @class, ' '), ' print:block ')][1]",
    )
    .evaluate((root) => {
      const clone = root.cloneNode(true) as HTMLElement;
      clone
        .querySelectorAll("[data-privacy-visible], script, style")
        .forEach((el) => el.remove());
      return clone.innerText;
    });
}

/** Open the full report the way a person does: "Print Full Report" on the
 *  Retirement page. Until the projection and the simulation are fresh the
 *  report gate (report-gate-modal.tsx) answers instead; run the simulation
 *  from it when it offers that, close it otherwise, and try again. The
 *  print dialog is stubbed out (see the test). */
async function openFullReport(page: Page) {
  await page.goto("/retirement");
  const print = page.getByRole("button", { name: "Print Full Report" });
  await expect(print).toBeVisible({ timeout: 60_000 });
  const report = reportHeading(page);
  await expect(async () => {
    const gate = page.getByRole("alertdialog");
    if (await gate.isVisible()) {
      const run = gate.getByRole("button", { name: "Run the simulation" });
      if (await run.isVisible()) await run.click({ timeout: 5_000 });
      else
        await gate
          .getByRole("button", { name: "Close" })
          .click({ timeout: 5_000 });
    }
    await print.click({ timeout: 5_000 });
    await expect(report).toBeAttached({ timeout: 5_000 });
  }).toPass({ timeout: 4 * 60_000 });
}

async function waitForContent(page: Page) {
  await page.waitForLoadState("networkidle");
  await expect
    .poll(async () => (await visibleText(page)).length, { timeout: 30_000 })
    .toBeGreaterThan(100);
}

test.describe("Privacy mode", () => {
  useOwnRateLimitBucket(test, "privacy-mode");

  test.beforeAll(() => {
    if (process.env.SQLITE_PATH) seedPrivacyHousehold(process.env.SQLITE_PATH);
  });

  test("the full report shows amounts, and hides them with the cookie set", async ({
    page,
    context,
    baseURL,
  }) => {
    // Two simulation runs at the default trial count on a slow CI runner.
    test.setTimeout(10 * 60_000);
    // The report prints through window.print(): no dialog in a test run.
    await page.addInitScript(() => {
      window.print = () => {};
    });

    // The positive control: without it, a report with no amounts (or no
    // report at all) would pass the privacy check below.
    await openFullReport(page);
    expect(await reportText(page)).toMatch(DOLLAR_AMOUNT);

    await context.addCookies([
      { name: PRIVACY_COOKIE, value: "1", url: baseURL! },
    ]);
    await openFullReport(page);
    const text = await reportText(page);
    const match = text.match(
      new RegExp(`.{0,40}${DOLLAR_AMOUNT.source}.{0,20}`),
    );
    expect(match?.[0].replace(/\s+/g, " ") ?? null).toBeNull();
  });

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
    // Several waits of up to 30 s each (content, then amounts, three times
    // over) — the 30 s default test timeout cut a slow CI run off mid-wait.
    test.setTimeout(3 * 60_000);
    // Not the dashboard: on a fresh install (CI's SQLite demo database has
    // no household) "/" opens the first-run wizard as a full-screen modal
    // that intercepts clicks on the sidebar toggle. Net Worth always renders
    // amounts ($0.00 on an empty database) and has no wizard.
    await page.goto("/networth");
    await waitForContent(page);
    await expectAmountsShown(page, true);

    await page.getByRole("button", { name: "Hide amounts" }).first().click();
    await expectAmountsShown(page, false);
    const cookies = await context.cookies();
    expect(cookies.find((c) => c.name === PRIVACY_COOKIE)?.value).toBe("1");

    // Survives a reload.
    await page.reload();
    await waitForContent(page);
    expect(DOLLAR_AMOUNT.test(await visibleText(page))).toBe(false);

    await page.getByRole("button", { name: "Show amounts" }).first().click();
    await expectAmountsShown(page, true);
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
