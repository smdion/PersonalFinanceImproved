/** A gap year's Portfolio saving: what the pay left after spending funds; a draw covers spending only. */
import { isRetirementMoney } from "../../../config/account-types";
import { roundToCents } from "../../../utils/math";
import { shortfallFloor } from "../gap-year-draw";
import type { ContributionSpec } from "../types/contribution-spec";
import type { AccumulationSlot } from "../types/routing";

/** A Portfolio spec's money scaled by `share` (every field that sizes it). */
function scaledSpec(spec: ContributionSpec, share: number): ContributionSpec {
  return {
    ...spec,
    value: spec.value * share,
    baseAnnual: spec.baseAnnual * share,
    ...(spec.configuredAnnual !== undefined && {
      configuredAnnual: spec.configuredAnnual * share,
    }),
    ...(spec.leftThisYear !== undefined && {
      leftThisYear: spec.leftThisYear * share,
    }),
    ...(spec.targetAnnual != null && {
      targetAnnual: spec.targetAnnual * share,
    }),
  };
}

/** The Portfolio specs' part of the slots, plus the ramp's Portfolio part. */
function portfolioSaving(slots: readonly AccumulationSlot[], ramp: number) {
  return roundToCents(
    slots.reduce(
      (sum, s) =>
        s.portfolioContrib === undefined ? sum : sum + s.portfolioContrib,
      ramp,
    ),
  );
}

/** The most re-sizing passes: each leaves only the tax rate's share of the last overlap. */
const MAX_PASSES = 10;

/**
 * A gap year draws for spending only, so its Portfolio saving (Portfolio
 * specs, and the ramp when it lands in a Portfolio brokerage) is cut by the
 * need it would add; the year is re-sized until the need is under the floor.
 */
export function fundGapYearSaving<Sized extends { slots: AccumulationSlot[] }>(
  specs: ContributionSpec[] | undefined,
  ramp: { amount: number; isPortfolio: boolean },
  sized: Sized,
  resize: (specs: ContributionSpec[] | undefined) => Sized,
  needOf: (slots: AccumulationSlot[], ramp: number) => number,
) {
  const rampAt = (share: number) =>
    ramp.isPortfolio ? roundToCents(ramp.amount * share) : ramp.amount;
  const portfolioRamp = (share: number) =>
    ramp.isPortfolio ? rampAt(share) : 0;
  const saving = portfolioSaving(sized.slots, portfolioRamp(1));
  let share = 1;
  let kept = saving;
  let yearSpecs = specs;
  for (let pass = 0; pass < MAX_PASSES && kept > 0; pass++) {
    const need = needOf(sized.slots, rampAt(share));
    if (need < shortfallFloor(need)) break;
    share *= Math.max(0, kept - need) / kept;
    yearSpecs = specs?.map((s) =>
      isRetirementMoney(s.parentCategory) ? s : scaledSpec(s, share),
    );
    sized = resize(yearSpecs);
    kept = portfolioSaving(sized.slots, portfolioRamp(share));
  }
  return {
    specs: yearSpecs,
    sized,
    ramp: rampAt(share),
    skipped: roundToCents(saving - kept),
  };
}
