"use client";

/** Key metrics cards + recommendation banner + warnings for the Relocation
 *  calculator. Extracted from tools/page.tsx during the v0.5.2 file-split
 *  refactor. Stateless — reads only from the `result` prop.
 */

import { HelpTip } from "@/components/ui/help-tip";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import type { RelocationResult } from "./types";

type Props = {
  result: RelocationResult;
  displayAge: (year: number) => number | null;
};

export function RelocationMetricsAndBanner({ result: r, displayAge }: Props) {
  return (
    <>
      {/* Key metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-surface-sunken rounded-lg p-3">
          <div className="text-xs text-muted uppercase">
            Monthly Delta
            <HelpTip text="How much more (or less) you'd spend each month after relocating" />
          </div>
          <div
            className={`text-lg font-bold ${r.monthlyExpenseDelta > 0 ? "text-red-600" : r.monthlyExpenseDelta < 0 ? "text-green-600" : ""}`}
          >
            {r.monthlyExpenseDelta > 0 ? "+" : ""}
            {formatCurrency(r.monthlyExpenseDelta)}
          </div>
          <div className="text-xs text-faint">
            {r.percentExpenseIncrease > 0 ? "+" : ""}
            {r.percentExpenseIncrease}%{" "}
            {r.percentExpenseIncrease > 0
              ? "increase"
              : r.percentExpenseIncrease < 0
                ? "decrease"
                : ""}
          </div>
        </div>

        <div className="bg-surface-sunken rounded-lg p-3">
          <div className="text-xs text-muted uppercase">
            Additional Nest Egg Needed
            <HelpTip text="Extra savings required to maintain the same retirement readiness with higher expenses" />
          </div>
          <div
            className={`text-lg font-bold ${r.additionalNestEggNeeded > 0 ? "text-red-600" : "text-green-600"}`}
          >
            {r.additionalNestEggNeeded > 0 ? "+" : ""}
            {formatCurrency(r.additionalNestEggNeeded)}
          </div>
          <div className="text-xs text-faint">
            FI: {formatCurrency(r.currentFiTarget)} →{" "}
            {formatCurrency(r.relocationFiTarget)}
          </div>
        </div>

        <div className="bg-surface-sunken rounded-lg p-3">
          <div className="text-xs text-muted uppercase">
            Savings Rate Impact
            <HelpTip text="How much your monthly savings rate would change after relocating" />
          </div>
          <div
            className={`text-lg font-bold ${r.savingsRateDrop > 0 ? "text-red-600" : "text-green-600"}`}
          >
            {r.savingsRateDrop > 0 ? "−" : "+"}
            {formatPercent(Math.abs(r.savingsRateDrop))}
          </div>
          <div className="text-xs text-faint">
            {formatPercent(r.currentSavingsRate)} →{" "}
            {formatPercent(r.relocationSavingsRate)}
          </div>
        </div>

        <div className="bg-surface-sunken rounded-lg p-3">
          <div className="text-xs text-muted uppercase">
            FI Age Impact
            <HelpTip text="How many years earlier or later you'd reach financial independence" />
          </div>
          <div
            className={`text-lg font-bold ${r.fiAgeDelay !== null && r.fiAgeDelay > 0 ? "text-red-600" : "text-green-600"}`}
          >
            {r.fiAgeDelay !== null
              ? `${r.fiAgeDelay > 0 ? "+" : ""}${r.fiAgeDelay} yr${Math.abs(r.fiAgeDelay) !== 1 ? "s" : ""}`
              : "—"}
          </div>
          <div className="text-xs text-faint">
            {r.currentFiYear != null
              ? `Age ${displayAge(r.currentFiYear) ?? r.currentFiAge ?? "?"}`
              : r.currentFiAge != null
                ? `Age ${r.currentFiAge}`
                : `Not by ${r.retirementAge}`}{" "}
            →{" "}
            {r.relocationFiYear != null
              ? `Age ${displayAge(r.relocationFiYear) ?? r.relocationFiAge ?? "?"}`
              : r.relocationFiAge != null
                ? `Age ${r.relocationFiAge}`
                : `Not by ${r.retirementAge}`}
          </div>
        </div>
      </div>

      {/* Recommendation banner */}
      {r.earliestRelocateAge !== null ? (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm">
          <span className="font-semibold text-blue-800">Recommendation:</span>{" "}
          <span className="text-blue-700">
            Target a portfolio of at least{" "}
            <strong>{formatCurrency(r.recommendedPortfolioToRelocate)}</strong>{" "}
            before relocating.
            {(() => {
              const displayMoveAge =
                r.earliestRelocateYear != null
                  ? (displayAge(r.earliestRelocateYear) ??
                    r.earliestRelocateAge)
                  : r.earliestRelocateAge;
              const displayCurrentFiAge =
                r.currentFiYear != null
                  ? (displayAge(r.currentFiYear) ?? r.currentFiAge)
                  : r.currentFiAge;
              return (displayMoveAge ?? 999) <= (displayCurrentFiAge ?? 999)
                ? ` You can relocate as early as age ${displayMoveAge} and still reach FI by retirement.`
                : ` Earliest safe relocation age: ${displayMoveAge}.`;
            })()}
          </span>
        </div>
      ) : (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm">
          <span className="font-semibold text-amber-800">Warning:</span>{" "}
          <span className="text-amber-700">
            With the relocation budget, your portfolio may not reach the FI
            target ({formatCurrency(r.relocationFiTarget)}) by retirement.
            Consider reducing expenses, increasing income, or extending the
            timeline.
          </span>
        </div>
      )}

      {/* Warnings from calculator */}
      {r.warnings.length > 0 && (
        <div className="space-y-1">
          {r.warnings.map((w) => (
            <div
              key={w}
              className="text-xs text-amber-600 bg-amber-50 rounded p-2"
            >
              {w}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
