"use client";

/**
 * Household taxes for the selected view — part of the Household Income
 * card (the gap between gross and net pay). Projected / year-end use the
 * household-level tax (one standard deduction, SS capped per person); Actual
 * YTD uses paycheck withholding so far.
 */
import { HelpTip } from "@/components/ui/help-tip";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { sumBy } from "@/lib/utils/math";
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
  const people = data?.people?.filter((d) => d.paycheck && d.tax) ?? [];
  if (people.length === 0) return null;

  // Household-level tax (combined federal, per-person FICA) for annual projection.
  // Per-person calculateTax double-counts the MFJ standard deduction — the router
  // computes a combined household result with one standard deduction applied once.
  const householdTax = data?.householdTax;
  const taxResult = householdTax ?? people[0]?.tax;

  // For annual projection (projected or blended): use the household-level tax calculation
  // which correctly combines incomes, applies ONE standard deduction, and caps SS per-person.
  // Blended household tax is a future enhancement — for now, projected tax is acceptable.
  // For YTD: use paycheck-based withholding since it reflects actual amounts withheld.
  let totalFederal: number;
  let totalFica: number;
  if (isYtd) {
    const periods = (d: (typeof people)[0]) => d.paycheck!.periodsElapsedYtd;
    totalFederal = sumBy(
      people,
      (d) => d.paycheck!.federalWithholding * periods(d),
    );
    totalFica = sumBy(
      people,
      (d) => (d.paycheck!.ficaSS + d.paycheck!.ficaMedicare) * periods(d),
    );
  } else if (householdTax) {
    totalFederal = householdTax.federalTax;
    totalFica = householdTax.ficaSS + householdTax.ficaMedicare;
  } else {
    // Fallback to per-person sum if household calc unavailable
    totalFederal = sumBy(people, (d) => d.tax?.federalTax ?? 0);
    totalFica = sumBy(
      people,
      (d) => (d.tax?.ficaSS ?? 0) + (d.tax?.ficaMedicare ?? 0),
    );
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
        {taxResult && (
          <span className="inline-flex items-center gap-1">
            {formatPercent(taxResult.effectiveRate, 1)} effective
            <HelpTip text="Actual percentage of total income paid in federal tax. Lower than marginal due to progressive brackets." />
            · {formatPercent(taxResult.marginalRate, 1)} marginal
            <HelpTip text="Tax rate on your next dollar of income. This is the bracket your top earnings fall into." />
          </span>
        )}
      </div>
    </div>
  );
}
