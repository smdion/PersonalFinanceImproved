/**
 * Regression guard, 2026-08-30 (UI/UX pass) — every projection tooltip
 * accent color (`tipColorClass` in cards/projection/utils.ts) must be a
 * STATIC shade: one with NO `--c-<color>-<shade>` override in
 * globals.css's `:root` block.
 *
 * This is the OPPOSITE of the usual rule for page content. Both
 * projection tooltip surfaces (this chart's own hand-rolled Recharts
 * tooltip, and the table's shared `Tooltip` UI primitive — see
 * ui/tooltip.tsx's TOOLTIP_SURFACE_CLASSES) are deliberately dark
 * REGARDLESS of the page's own light/dark setting (bg-slate-900 /
 * dark:bg-slate-700, both dark). A `--c-*`-remapped shade changes value
 * based on the PAGE's theme, which is decoupled from this always-dark
 * container — so routing tooltip text through the page-theme system
 * produces exactly the "hard to read depending on theme" bug this guards
 * against, regardless of which specific shade number is chosen. This
 * file's own history is the cautionary tale: a first pass "fixed" broken
 * shades by moving them TO `--c-*`-remapped alternatives, which was
 * wrong; this test encodes the corrected, opposite rule so that mistake
 * can't quietly repeat.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { tipColorClass } from "@/components/cards/projection/utils";
import { CHART_COLORS } from "@/lib/utils/colors";
import { TOOLTIP_SURFACE_CLASSES } from "@/components/ui/tooltip";

function themedShades(): Set<string> {
  const css = readFileSync(
    resolve(__dirname, "../../src/app/globals.css"),
    "utf-8",
  );
  const rootBlock = css.slice(
    css.indexOf(":root {"),
    css.indexOf("\n}", css.indexOf(":root {")),
  );
  const matches = rootBlock.matchAll(/--c-([a-z]+-\d+):/g);
  return new Set(Array.from(matches, (m) => m[1]!));
}

describe("tipColorClass — every accent is a STATIC (non-page-theme-remapped) shade", () => {
  const themed = themedShades();

  it("globals.css actually defines a real set of --c-<color>-<shade> tokens (sanity check the parser works)", () => {
    expect(themed.size).toBeGreaterThan(30);
    expect(themed.has("blue-600")).toBe(true);
  });

  for (const [name, className] of Object.entries(tipColorClass)) {
    it(`${name} ("${className}") is NOT page-theme-remapped -- "red" is the sole allowed exception (see below)`, () => {
      const match = className.match(/text-([a-z]+-\d+)/);
      expect(
        match,
        `couldn't parse a color/shade out of "${className}"`,
      ).not.toBeNull();
      const shade = match![1]!;
      if (name === "red") {
        // Every red-* shade IS remapped in this app (no static option
        // exists) -- red-400 is used deliberately anyway (see
        // tipColorClass's own docblock for why). Assert it's still
        // exactly red-400, not some other remapped shade someone reached
        // for later.
        expect(shade).toBe("red-400");
        return;
      }
      expect(
        themed.has(shade),
        `text-${shade} DOES have a --c-${shade} override in globals.css -- ` +
          `it will change color based on the PAGE's theme, but this text ` +
          `renders inside an always-dark tooltip surface that does NOT ` +
          `track the page theme. Pick a shade with no --c-* override ` +
          `instead (see tipColorClass's docblock).`,
      ).toBe(false);
    });
  }

  it("CHART_COLORS.withdrawalFlow and .ssMarker are raw hex for the chart's SVG line stroke (a light/theme-adaptive canvas context) -- never reused as inline tooltip TEXT color (that was the exact bug this session found and fixed: slate-600, chosen for a light chart background, is nearly invisible as text on the dark tooltip surface)", () => {
    expect(CHART_COLORS.withdrawalFlow).toMatch(/^#[0-9a-f]{6}$/i);
    expect(CHART_COLORS.ssMarker).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("the shared tooltip surface (table + chart) stays genuinely dark in both className strings, not accidentally theme-adaptive", () => {
    expect(TOOLTIP_SURFACE_CLASSES).toContain("bg-slate-900");
    expect(TOOLTIP_SURFACE_CLASSES).toContain("dark:bg-slate-700");
    expect(TOOLTIP_SURFACE_CLASSES).not.toContain("bg-surface-primary");
  });
});

/**
 * Structural enforcement, not a one-time hunt-and-patch: tooltip-renderer.tsx
 * is ENTIRELY tooltip-popup content (its own docblock: "call sites supply a
 * TooltipData shape and this module handles all layout, formatting" — no
 * page content lives in this file at all), so a raw `text-<color>-<shade>`
 * Tailwind literal anywhere in it is never legitimate: every color must
 * come from `tipColorClass`. This test scans the file's actual source text
 * on every run, so a future edit that reaches for a literal class instead
 * of `tipColorClass.<name>` fails here automatically — the same class of
 * bug (colors that silently drifted from the centralized map, found
 * repeatedly across several rounds of manual review in this same session)
 * can't quietly reappear.
 */
describe("tooltip-renderer.tsx — every color is centralized through tipColorClass (no raw literals)", () => {
  const source = readFileSync(
    resolve(
      __dirname,
      "../../src/components/cards/projection/tooltip-renderer.tsx",
    ),
    "utf-8",
  );

  it("contains zero raw text-<color>-<shade> Tailwind literals", () => {
    // Excludes text-caption/text-label/text-xs/etc (size/weight utilities,
    // not colors) by requiring a numeric shade suffix.
    const literals = source.match(/text-(?!caption|label)[a-z]+-\d{2,3}\b/g);
    expect(
      literals,
      `found raw color literal(s) in tooltip-renderer.tsx: ${JSON.stringify(literals)}. ` +
        `Route through tipColorClass instead (see its docblock in cards/projection/utils.ts).`,
    ).toBeNull();
  });

  it("contains zero unguarded border-t dividers (must pair with border-white/10, or they're invisible on the dark tooltip surface)", () => {
    const bareBorders = source.match(/border-t(?!\s+border-white\/10)/g);
    expect(
      bareBorders,
      `found border-t without border-white/10 in tooltip-renderer.tsx: ${JSON.stringify(bareBorders)}`,
    ).toBeNull();
  });
});
