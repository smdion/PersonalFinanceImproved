/** The wealth journey: net worth past zero, $100k, $1M and liquid $1M,
 *  the growth points, and financial independence. */
import { FIRST_100K, ONE_MILLION } from "@/lib/config/milestones";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import {
  amountMilestone,
  definition,
  expectedNote,
  firstReachedYear,
  growthMilestone,
  projectedFiYear,
  reachedNote,
  result,
} from "@/lib/pure/advice/milestones/milestones.shared";
import type {
  MilestoneInput,
  MilestoneResult,
  MilestoneValue,
  MilestoneYear,
} from "@/lib/pure/advice/milestones/milestones.types";

export function journey(
  input: MilestoneInput,
  now: MilestoneYear,
): MilestoneResult[] {
  const nonLiquid = now.netWorth - now.liquid;
  const out: MilestoneResult[] = [];

  out.push(
    amountMilestone("zero", input, {
      current: now.netWorth,
      target: 0,
      history: (y) => y.netWorth,
      projected: (y) => y.liquid + nonLiquid,
      estimate: true,
    }),
  );
  out.push(
    amountMilestone("first100k", input, {
      current: now.liquid,
      target: FIRST_100K,
      history: (y) => y.liquid,
      projected: (y) => y.liquid,
    }),
  );

  out.push(
    growthMilestone("investmentsSaveHarder", input, now, {
      // A year of saving includes employer money: Money Guy counts all
      // money saved.
      past: (y) => y.contributions,
      current: input.savings?.savedWithMatch ?? null,
      projected: (y) => y.contributions,
      label: "saved",
      matches: "growth matches what you save",
    }),
  );

  out.push(
    amountMilestone("twoComma", input, {
      current: now.netWorth,
      target: ONE_MILLION,
      history: (y) => y.netWorth,
      projected: (y) => y.liquid + nonLiquid,
      estimate: true,
    }),
  );
  out.push(
    amountMilestone("liquidMillionaire", input, {
      current: now.liquid,
      target: ONE_MILLION,
      history: (y) => y.liquid,
      projected: (y) => y.liquid,
    }),
  );

  // Finalized years use gross income (salary + bonus); projected years only have
  // projected salary, so "on pace" can come early for a large-bonus household.
  out.push(
    growthMilestone("moneyWorksHarder", input, now, {
      past: (y) => y.grossIncome,
      current: now.grossIncome,
      projected: (y) => y.salary,
      label: "pay",
      matches: "growth matches your pay",
    }),
  );

  out.push(fi(input, now));
  return out;
}

function fi(input: MilestoneInput, now: MilestoneYear): MilestoneResult {
  if (input.fiTarget <= 0) {
    return result("fi", {
      status: "unknown",
      headline: "Set a budget and withdrawal rate to get an FI number",
    });
  }
  // FI is a state, not a one-time step: it counts as reached only while
  // today's figure is there. The first year it was reached stays on the
  // timeline either way.
  const reachedYear = firstReachedYear(input.years, (y) => y.fiProgress >= 1);
  const achievements =
    reachedYear !== null
      ? [{ year: reachedYear, label: definition("fi").title }]
      : [];
  const value: MilestoneValue = { kind: "percent", amount: now.fiProgress };
  const headline = `${formatPercent(now.fiProgress)} of ${formatCurrency(input.fiTarget)}`;
  if (now.fiProgress >= 1) {
    return result("fi", {
      status: "reached",
      value,
      progress: 1,
      headline,
      short: "FI reached",
      reachedYear,
      note:
        reachedYear !== null
          ? reachedNote(reachedYear, input.years, true)
          : null,
      achievements,
    });
  }
  const expected = input.projection
    ? projectedFiYear(
        input.projection.years,
        input.fiTarget,
        input.projection.inflationRate,
        input.asOfYear,
      )
    : null;
  return result("fi", {
    status: !input.projection ? "unknown" : expected ? "onTrack" : "behind",
    alert: Boolean(input.projection) && !expected,
    value,
    progress: Math.max(0, Math.min(1, now.fiProgress)),
    headline,
    short: !input.projection
      ? `${formatPercent(now.fiProgress)} there`
      : expected
        ? `On pace for ${expected.year}`
        : "Not reached in projection",
    note:
      [
        reachedYear !== null
          ? reachedNote(reachedYear, input.years, false)
          : null,
        expectedNote(expected, input),
      ]
        .filter(Boolean)
        .join(" · ") || null,
    nextStep: `${formatCurrency(Math.max(0, input.fiTarget - now.liquid))} to go in today's dollars`,
    reachedYear,
    expectedYear: expected?.year ?? null,
    expectedAge: expected?.age ?? null,
    achievements,
  });
}
