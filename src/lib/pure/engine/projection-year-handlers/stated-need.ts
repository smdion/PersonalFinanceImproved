/**
 * The household's stated need for the first decumulation year, in that
 * year's dollars, before any spending strategy adjusts it: what Coast FIRE
 * tests the first year's actual spending against.
 */
import { roundToCents } from "../../../utils/math";
import { expenseEndingFactor } from "../expense-endings";
import type { ProjectionContext } from "./types";

/** Null without a decumulation budget. This year's budget override replaces
 *  the inflated budget, unless rate-seeded (that scenario ignores a
 *  same-year override); a loan paid off by then takes the seed's cut. */
export function firstYearStatedNeed(
  ctx: ProjectionContext,
  year: number,
  yearIndex: number,
): number | null {
  const { input, inflation, budgetOverrideMap } = ctx;
  if (input.decumulationAnnualExpenses == null) return null;
  const firstYearOverride =
    input.rateSeededDecumulationYear1 !== true
      ? budgetOverrideMap.get(year)
      : undefined;
  return roundToCents(
    firstYearOverride ??
      input.decumulationAnnualExpenses *
        inflation.growth(yearIndex) *
        (input.rateSeededDecumulationYear1
          ? 1
          : expenseEndingFactor({
              endings: input.expenseEndings,
              phase: "decumulation",
              year,
              seeded: true,
            })),
  );
}
