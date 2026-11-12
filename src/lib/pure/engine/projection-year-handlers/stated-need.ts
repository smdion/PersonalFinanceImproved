/**
 * The household's stated need for the first decumulation year, in that
 * year's dollars, before any spending strategy adjusts it: what Coast FIRE
 * tests the first year's actual spending against.
 */
import { roundToCents } from "../../../utils/math";
import type { ProjectionContext, ProjectionLoopState } from "./types";

/** The stated need, once the first decumulation year's budget is set: the
 *  budget the loop seeded, after this year's override and any loan ending;
 *  rate-seeded (no budget seed), the inflated budget; null without a budget. */
export function recordStatedNeed(
  state: ProjectionLoopState,
  ctx: ProjectionContext,
  yearIndex: number,
): void {
  const { input, inflation } = ctx;
  if (input.decumulationAnnualExpenses == null) {
    state.firstDecumulationYearStatedNeed = null;
    return;
  }
  state.firstDecumulationYearStatedNeed = roundToCents(
    input.rateSeededDecumulationYear1 === true
      ? input.decumulationAnnualExpenses * inflation.growth(yearIndex)
      : state.budgetOnlyExpenses,
  );
}
