"use client";

/**
 * Actual vs the plan, under the balance it measures: where the plan
 * expected the money by now, from the last finalized year (a starting point
 * the projection can't move). Only while the plan's first year follows that
 * finalized year and it's still saving — otherwise the two don't line up.
 */
import { HelpTip } from "@/components/ui/help-tip";
import { useDashboardProjection } from "@/lib/hooks/use-dashboard-projection";
import { planExpectedNow, yearFraction } from "@/lib/pure/retirement/plan-pace";
import { formatCurrency, formatPercent } from "@/lib/utils/format";

export function PlanPaceLine({
  actual,
  day,
  lastFinalized,
}: {
  actual: number;
  /** The day `actual` is from (YYYY-MM-DD). */
  day: string | null;
  lastFinalized: { year: number; balance: number } | null;
}) {
  const plan = useDashboardProjection().data?.result?.projectionByYear[0];
  if (
    !lastFinalized ||
    !day ||
    plan?.phase !== "accumulation" ||
    plan.year !== lastFinalized.year + 1 ||
    Number(day.slice(0, 4)) !== plan.year
  )
    return null;
  const contributions =
    (plan.totalEmployee + plan.totalEmployer) / (plan.proRateFraction || 1);
  const expected = planExpectedNow({
    yearStartBalance: lastFinalized.balance,
    annualRate: plan.annualizedReturnRate,
    yearContributions: contributions,
    fraction: yearFraction(day, plan.year),
  });
  const gap = actual - expected;
  return (
    <div className="text-caption text-muted flex justify-between gap-2">
      <span>
        Projected by now
        <HelpTip
          text={`What your retirement projection counted on for today. It starts from your ${lastFinalized.year} year-end balance of ${formatCurrency(lastFinalized.balance, 0)}, grows it at the plan's ${formatPercent(plan.annualizedReturnRate, 1)} a year for the part of ${plan.year} gone by, and adds that part of the ${formatCurrency(contributions, 0)} a year the plan contributes, employer money included. Ahead or behind can come from returns or from contributing more or less than the plan.`}
        />
      </span>
      <span className="whitespace-nowrap">
        {formatCurrency(expected, 0)} ·{" "}
        <span className={gap >= 0 ? "text-green-600" : "text-red-600"}>
          {formatCurrency(Math.abs(gap), 0)} {gap >= 0 ? "ahead" : "behind"}
        </span>
      </span>
    </div>
  );
}
