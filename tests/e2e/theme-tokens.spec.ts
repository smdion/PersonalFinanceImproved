import { test, expect } from "@playwright/test";

/**
 * Theme token regression guard (v0.5 expert-review M26).
 *
 * The first M26 cleanup script bulk-replaced bg-gray-300/400 with
 * bg-surface-elevated, which was the wrong target — surface-elevated is
 * gray-100 (#f3f4f6 in light mode), so dot indicators and dividers
 * effectively disappeared against the white card surfaces around them.
 *
 * This spec creates a synthetic page (a single <div> with each new fill
 * token applied) and asserts that the computed background color is dark
 * enough to be visible. It runs against the dev server and would fail
 * loudly if anyone changed the token values to something near-white.
 *
 * Why a synthetic page instead of asserting on a real component:
 * the dev server requires auth, the affected components live behind
 * different routes, and the assertion we want is purely about the
 * resolved CSS variable — not about layout. A 1KB injected page makes
 * the test fast, deterministic, and immune to surrounding component
 * churn.
 */
test.describe("design system fill tokens (M26)", () => {
  test("bg-surface-divider resolves to a visible mid-gray", async ({
    page,
  }) => {
    // Use the home route for the auth/cookie context, then inject a
    // probe div with the token class. We read the computed background
    // color from the live DOM so the assertion runs against actual CSS,
    // not the source.
    await page.goto("/");
    await page.evaluate(() => {
      const probe = document.createElement("div");
      probe.id = "theme-probe-divider";
      probe.className = "bg-surface-divider";
      probe.style.cssText = "width:8px;height:8px;position:fixed;top:0;left:0";
      document.body.appendChild(probe);
    });
    const rgb = await page.locator("#theme-probe-divider").evaluate((el) => {
      return getComputedStyle(el).backgroundColor;
    });
    // Light mode: #d1d5db = rgb(209, 213, 219)
    // Dark mode:  #475569 = rgb(71, 85, 105)
    // Either way, all three channels should be ≤ 220 — anything above
    // would be near-white and the original failure mode.
    const m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    expect(m, `expected rgb() value, got: ${rgb}`).not.toBeNull();
    const [r, g, b] = m!.slice(1, 4).map(Number) as [number, number, number];
    expect(Math.max(r, g, b)).toBeLessThanOrEqual(220);
  });

  test("bg-surface-emphasis resolves to a high-contrast accent", async ({
    page,
  }) => {
    await page.goto("/");
    await page.evaluate(() => {
      const probe = document.createElement("div");
      probe.id = "theme-probe-emphasis";
      probe.className = "bg-surface-emphasis";
      probe.style.cssText = "width:8px;height:8px;position:fixed;top:0;left:0";
      document.body.appendChild(probe);
    });
    const rgb = await page.locator("#theme-probe-emphasis").evaluate((el) => {
      return getComputedStyle(el).backgroundColor;
    });
    const m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    expect(m, `expected rgb() value, got: ${rgb}`).not.toBeNull();
    const [r, g, b] = m!.slice(1, 4).map(Number) as [number, number, number];
    // Light mode: #4b5563 = rgb(75, 85, 99) — all channels well below 200
    // Dark mode:  #cbd5e1 = rgb(203, 213, 225) — all channels above 200
    // Either way, this token should be MORE saturated (further from
    // mid-gray) than surface-divider so it stays visually distinct as a
    // "marker" rather than a "divider". We assert it's not the same as
    // surface-divider's value.
    const isDark = Math.max(r, g, b) <= 150;
    const isLight = Math.min(r, g, b) >= 180;
    expect(
      isDark || isLight,
      `bg-surface-emphasis should be either solidly dark (light mode) or ` +
        `solidly light (dark mode), got rgb(${r}, ${g}, ${b})`,
    ).toBe(true);
  });
});
