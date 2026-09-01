"use client";

/**
 * Lifetime Tax Paid card — decumulation only for now.
 *
 * EngineDecumulationYear.taxCost/effectiveTaxRate are computed per year and
 * ready to sum; EngineAccumulationYear has no equivalent field at all —
 * accumulation-year taxes are only ever handled implicitly via paycheck
 * withholding, never tracked as a projected per-year bill. Extending this
 * card to accumulation needs real new calculator work (projecting income
 * tax against inflation-grown salary/brackets for every future working
 * year), not just wiring up existing numbers — see
 * .scratch/docs/plans/TODO.md's "Accumulation-phase tax data doesn't exist
 * in the engine" entry. Ship what's real now rather than fake the rest.
 */
import { useState } from "react";
import { HelpTip } from "@/components/ui/help-tip";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { KpiCard } from "./projection-hero-kpis";
import type { ProjectionState } from "./projection-table-types";
import type { EngineDecumulationYear } from "@/lib/calculators/types/engine-projection";
import {
  computeLifetimeTaxSummary,
  type LifetimeTaxSummary,
} from "@/lib/pure/report/lifetime-tax-summary";

export function TaxSummaryCard({ state }: { state: ProjectionState }) {
  const { result, deflate } = state;
  if (!result) return null;

  const decumYears = result.projectionByYear.filter(
    (y): y is EngineDecumulationYear => y.phase === "decumulation",
  );
  const summary = computeLifetimeTaxSummary(decumYears, deflate);
  if (!summary) return null;

  return <TaxSummaryCardBody summary={summary} />;
}

function TaxSummaryCardBody({ summary }: { summary: LifetimeTaxSummary }) {
  const {
    totalTaxToday,
    weightedRate,
    totalWithdrawalToday,
    yearsCovered,
    decades,
  } = summary;
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="print:hidden rounded-lg border bg-surface-primary/40">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs text-muted hover:bg-surface-elevated rounded-lg transition-colors"
      >
        <span className="font-medium">
          Lifetime Tax Paid (Retirement)
          <span className="text-primary font-semibold ml-1.5">
            {formatCurrency(totalTaxToday)}
          </span>
          <span className="text-faint ml-1.5">
            ({formatPercent(weightedRate, 1)} effective)
          </span>
        </span>
        <svg
          aria-hidden="true"
          className={`w-3.5 h-3.5 transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <KpiCard
              label="Lifetime Tax Paid"
              tooltip={[
                "Sum of every retirement year's estimated withdrawal tax, in today's purchasing power — traditional withdrawals taxed at ordinary rates plus brokerage gains at capital-gains rates.",
                "Accumulation-phase (working years) taxes aren't included — those are paid via paycheck withholding, which this projection doesn't model as a separate year-by-year bill yet.",
              ]}
            >
              <div className="text-xl font-bold tabular-nums text-primary">
                {formatCurrency(totalTaxToday)}
              </div>
              <div className="text-caption text-faint mt-1 leading-tight">
                Over {yearsCovered} retirement year
                {yearsCovered === 1 ? "" : "s"}
              </div>
            </KpiCard>

            <KpiCard
              label="Effective Tax Rate"
              tooltip={[
                "Lifetime tax paid divided by lifetime withdrawals, both in today's dollars — a single weighted-average rate across your entire retirement, not any one year's marginal bracket.",
              ]}
            >
              <div className="text-xl font-bold tabular-nums text-primary">
                {formatPercent(weightedRate, 1)}
              </div>
              <div className="text-caption text-faint mt-1 leading-tight">
                of {formatCurrency(totalWithdrawalToday)} withdrawn
              </div>
            </KpiCard>

            <KpiCard
              label="Avg Tax / Year"
              tooltip={[
                "Lifetime tax paid divided by the number of retirement years — a simple average, not accounting for RMD-heavy later years typically costing more than early bracket-filled ones.",
              ]}
            >
              <div className="text-xl font-bold tabular-nums text-primary">
                {formatCurrency(totalTaxToday / yearsCovered)}
              </div>
              <div className="text-caption text-faint mt-1 leading-tight">
                in today&apos;s dollars
              </div>
            </KpiCard>
          </div>

          {decades.length > 1 && (
            <div className="rounded-lg border border-subtle bg-surface-primary/40 px-3 py-2.5">
              <div className="text-caption font-semibold uppercase tracking-wider text-faint flex items-center gap-1 mb-2">
                Tax Paid by Decade
                <HelpTip text="Each decade's share of lifetime tax paid, and that decade's own weighted effective rate — useful for spotting whether RMDs push later decades to a noticeably higher rate than your bracket-filled early retirement years." />
              </div>
              <table className="w-full text-label border-collapse">
                <thead>
                  <tr className="border-b">
                    <th className="text-left text-muted font-medium py-1 pr-2">
                      Ages
                    </th>
                    <th className="text-right text-muted font-medium py-1 px-1.5">
                      Tax Paid
                    </th>
                    <th className="text-right text-muted font-medium py-1 px-1.5">
                      Effective Rate
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {decades.map((d) => (
                    <tr key={d.label} className="border-b border-subtle">
                      <td className="py-1 pr-2 text-secondary">{d.label}</td>
                      <td className="text-right py-1 px-1.5 font-medium tabular-nums text-primary">
                        {formatCurrency(d.taxToday)}
                      </td>
                      <td className="text-right py-1 px-1.5 tabular-nums text-muted">
                        {formatPercent(
                          d.withdrawalToday > 0
                            ? d.taxToday / d.withdrawalToday
                            : 0,
                          1,
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
