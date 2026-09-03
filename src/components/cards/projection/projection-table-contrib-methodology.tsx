/** Expandable section below the projection table showing contribution specs, methodology links, and engine validation evidence. */
import React from "react";
import { HelpTip } from "@/components/ui/help-tip";
import {
  accountColor,
  taxTypeTextColor,
  taxTypeLabel,
} from "@/lib/utils/colors";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import {
  type AccountCategory,
  getAccountTypeConfig,
  ACCOUNT_TYPE_CONFIG,
} from "@/lib/config/account-types";
import { TAX_TREATMENT_TO_BUCKET } from "./utils";
import type { ProjectionState } from "./projection-table-types";

export type ContribMethodologyProps = {
  state: ProjectionState;
};

export function ContribMethodologySection({ state }: ContribMethodologyProps) {
  const {
    showModels,
    setShowModels,
    setShowValidation,
    setShowAccumMethodology,
    setShowDecumMethodology,
    withdrawalRoutingMode,
    withdrawalOrder,
    personFilter,
    isPersonFiltered,
    personFilterName,
    engineSettings,
    realDefaults,
    contribSpecs,
    budgetProfileSummaries: _budgetProfileSummaries,
    result,
    baseYear,
    deflate,
  } = state;

  if (!result) return null;

  return (
    <>
      <div>
        <button
          type="button"
          onClick={() => setShowModels(!showModels)}
          className="text-label text-faint hover:text-secondary mb-2 flex items-center gap-1.5 font-medium tracking-wide uppercase transition-colors"
        >
          How contributions &amp; distributions are projected
          <svg
            aria-hidden="true"
            className={`h-3.5 w-3.5 transition-transform ${showModels ? "rotate-180" : ""}`}
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
        {showModels && (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {/* How Contributions Are Projected */}
            {contribSpecs && contribSpecs.length > 0 && (
              <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-3 text-xs">
                <h5 className="text-secondary mb-2 font-medium uppercase">
                  How {isPersonFiltered ? `${personFilterName}'s` : ""}{" "}
                  Contributions Are Projected
                  <HelpTip
                    text={
                      isPersonFiltered
                        ? `Based on ${personFilterName}'s paycheck/contributions settings. Includes Retirement (401k, IRA, Retirement Brokerage) and HSA categories. Brokerage-category accounts (ESPP, Long Term Brokerage) are excluded.`
                        : "Based on your paycheck/contributions settings. Includes Retirement (401k, IRA, Retirement Brokerage) and HSA categories. Brokerage-category accounts (ESPP, Long Term Brokerage) are excluded."
                    }
                  />
                </h5>
                <table className="text-muted w-full">
                  <thead>
                    <tr className="text-caption text-faint uppercase">
                      <th className="pb-1 text-left font-medium">Account</th>
                      <th className="pb-1 text-left font-medium">Tax Type</th>
                      <th className="pb-1 text-right font-medium">Amount</th>
                      <th className="pb-1 text-right font-medium">Match</th>
                      <th className="pb-1 pl-2 text-left font-medium">
                        Scaling
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {contribSpecs!
                      .filter(
                        (spec) =>
                          personFilter === "all" ||
                          spec.personId === personFilter,
                      )
                      .map((spec) => {
                        const bucket =
                          TAX_TREATMENT_TO_BUCKET[spec.taxTreatment] ??
                          spec.taxTreatment;
                        return (
                          <tr
                            key={`${spec.category}-${spec.taxTreatment}-${spec.personId ?? spec.ownerName}`}
                            className="border-t border-blue-100/60"
                          >
                            <td className="py-1 pr-2">
                              <div className="flex items-center gap-1.5">
                                <span
                                  className={`inline-block h-1.5 w-1.5 rounded-full ${accountColor(spec.category)}`}
                                />
                                <span className="font-medium">
                                  {spec.accountDisplayName ?? spec.name}
                                </span>
                              </div>
                            </td>
                            <td
                              className={`text-caption py-1 whitespace-nowrap ${taxTypeTextColor(bucket)}`}
                            >
                              {taxTypeLabel(bucket)}
                            </td>
                            <td className="py-1 text-right whitespace-nowrap">
                              {spec.method === "percent_of_salary"
                                ? `${formatPercent(spec.value, 1)} of salary`
                                : `${formatCurrency(spec.baseAnnual)}/yr`}
                            </td>
                            <td className="py-1 text-right whitespace-nowrap text-emerald-600">
                              {(spec.matchAnnual ?? 0) > 0 ? (
                                `+${formatCurrency(spec.matchAnnual!)}`
                              ) : (
                                <span className="text-faint">—</span>
                              )}
                            </td>
                            <td className="text-faint py-1 pl-2 whitespace-nowrap">
                              {(() => {
                                const scalesWithSalary =
                                  spec.method === "percent_of_salary" ||
                                  (spec.category in ACCOUNT_TYPE_CONFIG &&
                                    ACCOUNT_TYPE_CONFIG[
                                      spec.category as AccountCategory
                                    ].fixedContribScalesWithSalary);
                                const hasIrsLimit =
                                  spec.category in ACCOUNT_TYPE_CONFIG &&
                                  ACCOUNT_TYPE_CONFIG[
                                    spec.category as AccountCategory
                                  ].hasIrsLimit;
                                if (scalesWithSalary && hasIrsLimit)
                                  return "Salary + IRS cap";
                                if (scalesWithSalary) return "Scales w/ salary";
                                if (hasIrsLimit) return "Scales w/ IRS limits";
                                return "Fixed";
                              })()}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
                {realDefaults &&
                  (() => {
                    const totalMatch = Object.values(
                      realDefaults.employerMatchByCategory ?? {},
                    ).reduce((s: number, v: number) => s + v, 0);
                    if (totalMatch <= 0) return null;
                    return (
                      <div className="text-caption text-faint mt-2 border-t border-blue-100 pt-1.5">
                        Match grows with salary. Look for{" "}
                        <span className="font-bold text-green-600">+m</span> in
                        the table and hover for breakdown.
                      </div>
                    );
                  })()}
                {result.firstOverflowYear && (
                  <div className="mt-1.5 border-t border-blue-100 pt-1.5 font-medium text-amber-600">
                    Contributions exceed IRS limits starting age{" "}
                    {result.firstOverflowAge} ({result.firstOverflowYear}) —{" "}
                    {formatCurrency(
                      deflate(
                        result.firstOverflowAmount ?? 0,
                        result.firstOverflowYear ?? baseYear,
                      ),
                    )}
                    /yr overflows to brokerage
                  </div>
                )}
              </div>
            )}

            {/* Methodology Links */}
            <div className="space-y-3">
              <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-3 text-xs">
                <h5 className="text-secondary mb-1.5 font-medium uppercase">
                  Accumulation Engine
                  <HelpTip text="How salary, contributions, IRS limits, employer matches, and routing work during working years." />
                </h5>
                <p className="text-muted mb-2">
                  Routes contributions across 401k, IRA, HSA, and brokerage
                  using waterfall, percentage, or per-account specs. Handles IRS
                  limit growth, catch-up contributions (SECURE 2.0), employer
                  matches, Roth/Traditional splits, and overflow to brokerage.
                </p>
                <button
                  type="button"
                  onClick={() => setShowAccumMethodology(true)}
                  className="font-medium text-blue-600 underline hover:text-blue-700"
                >
                  Full methodology &rarr;
                </button>
              </div>
              <div className="rounded-lg border border-amber-100 bg-amber-50/50 p-3 text-xs">
                <h5 className="text-secondary mb-1.5 font-medium uppercase">
                  Decumulation Engine
                  <HelpTip text="How withdrawals, taxes, RMDs, Roth conversions, and dynamic spending work during retirement." />
                </h5>
                <p className="text-muted mb-2">
                  Computes annual need (budget × inflation &minus; Social
                  Security at age {engineSettings?.ssStartAge ?? "?"}), grosses
                  up for taxes, and routes withdrawals via{" "}
                  {withdrawalRoutingMode === "bracket_filling"
                    ? "bracket filling (Traditional to bracket cap, then whichever of Roth or Brokerage is cheaper that year, HSA last)"
                    : withdrawalRoutingMode === "waterfall"
                      ? `waterfall (${withdrawalOrder.map((c) => getAccountTypeConfig(c).displayLabel).join(" →")})`
                      : "percentage split"}
                  . Enforces RMDs, optional Roth conversions, 8 dynamic spending
                  strategies (Morningstar), and IRMAA/ACA cliff awareness.
                </p>
                <button
                  type="button"
                  onClick={() => setShowDecumMethodology(true)}
                  className="font-medium text-amber-600 underline hover:text-amber-700"
                >
                  Full methodology &rarr;
                </button>
                {result.portfolioDepletionYear && (
                  <div className="mt-2 border-t border-amber-100 pt-1.5 font-medium text-red-600">
                    Portfolio depleted at age {result.portfolioDepletionAge} (
                    {result.portfolioDepletionYear})
                  </div>
                )}
              </div>
              <div className="rounded-lg border border-green-100 bg-green-50/50 p-3 text-xs">
                <h5 className="text-secondary mb-1.5 font-medium uppercase">
                  Why Trust These Numbers?
                  <HelpTip text="How the engine is validated against published research, IRS tax law, and mathematical invariants." />
                </h5>
                <p className="text-muted mb-2">
                  Calibrated against the Trinity Study, cFIREsim backtesting,
                  IRS 2025 tax tables, and institutional asset data. Backed by
                  362 automated tests including 29 mathematical invariants
                  proven for any input.
                </p>
                <button
                  type="button"
                  onClick={() => setShowValidation(true)}
                  className="font-medium text-green-600 underline hover:text-green-700"
                >
                  Full validation evidence &rarr;
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Warnings */}
      {result.warnings.length > 0 && (
        <div className="space-y-1">
          {result.warnings.map((w) => (
            <div
              key={w}
              className="rounded bg-amber-50 px-3 py-1.5 text-xs text-amber-600"
            >
              {w}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
