"use client";

/**
 * Household taxes for the selected view — two lines on the Household
 * Income card (the gap between gross and net pay); the breakdown and notes
 * are on the Taxes page. Projected / year-end use the
 * household-level tax (one standard deduction, SS capped per person); Actual
 * YTD uses paycheck withholding so far.
 */
import { HelpTip } from "@/components/ui/help-tip";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { sumBy } from "@/lib/utils/math";
import { withheldThroughPeriod } from "@/lib/calculators/paycheck";
import type { RouterOutputs } from "@/lib/trpc";
import type { ViewMode } from "@/lib/calculators/types/shared";

type PaycheckSummary = RouterOutputs["paycheck"]["computeSummary"];

export function TaxesSummary({
  data,
  viewMode,
}: {
  data: PaycheckSummary | undefined;
  viewMode: ViewMode;
}) {
  const isYtd = viewMode === "ytd";
  const isBlended = viewMode === "blended";
  const people = data?.people?.filter((d) => d.paycheck) ?? [];
  const householdTax = data?.householdTax ?? null;
  if (people.length === 0 || (!isYtd && !householdTax)) return null;

  // Projected and year-end: the household tax on household annual income
  // (salary + the resolved bonus — one standard deduction, FICA per person,
  // Additional Medicare on the household). YTD: paycheck withholding so far.
  let totalFederal: number;
  let totalFica: number;
  if (isYtd) {
    // From the year schedule, which charges full Social Security until the
    // wage base is reached (the per-check figure is the year's average).
    const withheld = people.map((d) =>
      withheldThroughPeriod(
        d.paycheck!.yearSchedule,
        d.paycheck!.periodsElapsedYtd,
      ),
    );
    totalFederal = sumBy(withheld, (w) => w.federal);
    totalFica = sumBy(withheld, (w) => w.fica);
  } else {
    totalFederal = householdTax!.federalTax;
    totalFica = householdTax!.ficaSS + householdTax!.ficaMedicare;
  }

  return (
    <div className="border-subtle mt-2 border-t pt-2 text-xs">
      <div className="flex justify-between">
        <span className="text-muted">
          Taxes{" "}
          {isYtd ? "withheld YTD" : isBlended ? "(year-end est.)" : "(annual)"}
        </span>
        <span className="text-primary font-medium">
          {formatCurrency(totalFederal + totalFica)}
        </span>
      </div>
      <div className="text-faint mt-0.5 flex flex-wrap justify-between gap-x-2">
        <span>
          {isYtd ? "Federal W/H" : "Federal"} {formatCurrency(totalFederal)} ·
          FICA {formatCurrency(totalFica)}
        </span>
        {householdTax && (
          <span className="inline-flex items-center gap-1">
            {formatPercent(householdTax.effectiveRate, 1)} effective
            <HelpTip text="Federal income tax as a share of AGI (salary + bonus minus pre-tax money) — the same way your tax history is figured. FICA isn't included; it's its own line." />
            · {formatPercent(householdTax.marginalRate, 1)} marginal
            <HelpTip text="Tax rate on your next dollar of income. This is the bracket your top earnings fall into." />
          </span>
        )}
      </div>
    </div>
  );
}
