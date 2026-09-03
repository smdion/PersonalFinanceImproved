/**
 * Enforces DESIGN.md's WCAG 1.4.11 floor: every dark-mode data-carrying
 * chart-line color in `chartLinePalette` must clear 3:1 against the dark
 * card background (and, for mcMedian, against the mcBandMiddle@0.2 fill it
 * is drawn over). Without this the DESIGN.md rule is prose with no teeth.
 */
import { describe, it, expect } from "vitest";
import { chartLinePalette, CHART_COLORS } from "@/lib/utils/colors";

const DARK_CARD = "#1e293b";

function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** hex `fg` at alpha `a` composited over opaque `bg`. */
function over(fg: string, a: number, bg: string): string {
  const f = fg.replace("#", "");
  const g = bg.replace("#", "");
  return (
    "#" +
    [0, 2, 4]
      .map((i) => {
        const v = Math.round(
          parseInt(f.slice(i, i + 2), 16) * a +
            parseInt(g.slice(i, i + 2), 16) * (1 - a),
        );
        return v.toString(16).padStart(2, "0");
      })
      .join("")
  );
}

describe("chartLinePalette — WCAG 1.4.11 (>=3:1 in dark mode)", () => {
  const dark = chartLinePalette(true);

  it.each([["netWorth"], ["perfBalance"], ["withdrawalFlow"]] as const)(
    "%s clears 3:1 vs the dark card",
    (key) => {
      expect(contrast(dark[key], DARK_CARD)).toBeGreaterThanOrEqual(3);
    },
  );

  it("mcMedian clears 3:1 vs the mcBandMiddle@0.2 fill it's drawn over", () => {
    const bandBackdrop = over(CHART_COLORS.mcBandMiddle, 0.2, DARK_CARD);
    expect(contrast(dark.mcMedian, bandBackdrop)).toBeGreaterThanOrEqual(3);
  });

  it("light values are unchanged from the CHART_COLORS originals", () => {
    const light = chartLinePalette(false);
    expect(light.netWorth).toBe(CHART_COLORS.netWorth);
    expect(light.perfBalance).toBe(CHART_COLORS.perfBalance);
    expect(light.withdrawalFlow).toBe(CHART_COLORS.withdrawalFlow);
    expect(light.mcMedian).toBe(CHART_COLORS.mcMedian);
  });
});
