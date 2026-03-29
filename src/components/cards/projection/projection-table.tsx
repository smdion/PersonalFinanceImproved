"use client";

/** Year-by-year projection table with dynamic column headers, accumulation/decumulation row delegation, and Monte Carlo overlay. */
import { HelpTip } from "@/components/ui/help-tip";
import {
  accountTextColor,
  taxTypeTextColor,
  taxTypeLabel,
} from "@/lib/utils/colors";
import type { EngineDecumulationYear } from "@/lib/calculators/types";
import {
  getAccountSegments,
  getAllCategories,
  getColumnLabel,
  parseColumnKey,
} from "@/lib/config/account-types";
import { TAX_BUCKET_DESCRIPTIONS } from "@/lib/config/display-labels";
import { catDisplayLabel, _singleBucketCategories, isAccumYear } from "./utils";
export {
  type ProjectionTableProps,
  type ProjectionState,
} from "./projection-table-types";
import type { ProjectionTableProps } from "./projection-table-types";
import { type RenderMcCellOptions } from "./projection-table-mc-cell";
import { AccumulationRow } from "./projection-table-accum-row";
import { DecumulationRow } from "./projection-table-decum-row";
import { ContribMethodologySection } from "./projection-table-contrib-methodology";

/**
 * Unified projection table — accumulation + decumulation year-by-year data.
 * Row rendering delegated to AccumulationRow and DecumulationRow components.
 */
export function ProjectionTable({
  state: s,
  people,
  parentCategoryFilter,
  accumulationBudgetProfileId,
  accumulationBudgetColumn,
  accumulationExpenseOverride,
  decumulationBudgetProfileId,
  decumulationBudgetColumn,
  decumulationExpenseOverride,
}: ProjectionTableProps) {
  const {
    accumOverrides,
    decumOverrides,
    balanceView,
    contribView,
    diagMode,
    isPersonFiltered,
    personFilterName,
    dbSalaryOverrides,
    dbBudgetOverrides,
    mcBandsByYear,
    mcDetByYear,
    getFilteredYears,
    visibleColumns,
    columnLabel,
    contribHeaderTooltip,
    balanceHeaderTooltip,
    result,
    deflate,
    renderTooltip,
  } = s;

  // Shared MC cell rendering options — passed to row components
  const mcCellOpts: RenderMcCellOptions = {
    mcBandsByYear,
    mcDetByYear,
    deflate,
    isPersonFiltered,
    parentCategoryFilter,
    diagMode,
    renderTooltip,
  };

  return (
    <>
      {result && isPersonFiltered && (
        <div className="text-[10px] text-faint mb-1">
          Showing {personFilterName}&apos;s accounts only.
        </div>
      )}
      {result && (
        <div className="overflow-x-auto max-h-[28rem] overflow-y-auto">
          <table
            className="text-xs"
            style={{
              minWidth:
                (balanceView === "account" || contribView === "account"
                  ? 1400
                  : 1100) + (mcBandsByYear ? 120 : 0),
            }}
          >
            <thead className="sticky top-0 bg-surface-primary z-10">
              {/* Column group headers */}
              <tr className="border-b border-subtle">
                <th
                  colSpan={3}
                  className="text-center py-1 text-[10px] text-faint font-semibold uppercase tracking-wider"
                >
                  Timeline
                </th>
                <th
                  colSpan={
                    3 +
                    (contribView === "account"
                      ? getAllCategories().filter((c) =>
                          visibleColumns.contribCats.has(c),
                        ).length
                      : (
                          ["preTax", "taxFree", "hsa", "afterTax"] as const
                        ).filter((t) => visibleColumns.contribTaxTypes.has(t))
                          .length)
                  }
                  className="text-center py-1 text-[10px] text-faint font-semibold uppercase tracking-wider border-l border-subtle"
                >
                  Contributions{" "}
                  {contribView === "taxType" ? "(by Tax Type)" : ""}
                </th>
                <th
                  colSpan={
                    1 +
                    (balanceView === "taxType"
                      ? (
                          ["preTax", "taxFree", "hsa", "afterTax"] as const
                        ).filter((t) => visibleColumns.balanceTaxTypes.has(t))
                          .length
                      : getAccountSegments()
                          .map((s) => s.key)
                          .filter((a) => visibleColumns.balanceAccts.has(a))
                          .length)
                  }
                  className="text-center py-1 text-[10px] text-faint font-semibold uppercase tracking-wider border-l border-subtle"
                >
                  Balances{" "}
                  {balanceView === "account" ? "(by Account)" : "(by Tax Type)"}
                </th>
                {mcBandsByYear && (
                  <th className="text-center py-1 text-[10px] text-faint font-semibold uppercase tracking-wider border-l border-subtle">
                    Monte Carlo
                  </th>
                )}
                <th className="text-center py-1 text-[10px] text-faint font-semibold uppercase tracking-wider border-l border-subtle">
                  Notes
                </th>
              </tr>
              <tr className="border-b">
                <th className="text-left py-1.5 pr-2 text-muted font-medium">
                  Year
                  <HelpTip text="Calendar year of the projection" />
                </th>
                <th className="text-left py-1.5 px-2 text-muted font-medium whitespace-nowrap">
                  Avg Age
                  <HelpTip text="Average age across all people in the plan — used to determine retirement eligibility and phase transitions" />
                </th>
                <th className="text-left py-1.5 px-2 text-muted font-medium">
                  Phase
                  <HelpTip text="Accumulation (saving/investing) or Decumulation (withdrawing in retirement)" />
                </th>
                <th className="text-right py-1.5 px-2 text-muted font-medium border-l border-subtle">
                  Salary
                  <HelpTip text="Gross annual salary before deductions, growing by the configured raise rate" />
                </th>
                <th className="text-right py-1.5 px-2 text-faint font-medium">
                  Rate
                  <HelpTip text="Contribution rate as % of salary — total employee contributions divided by gross salary" />
                </th>
                {contribView === "account"
                  ? getAllCategories()
                      .filter((c) => visibleColumns.contribCats.has(c))
                      .map((cat) => (
                        <th
                          key={cat}
                          className={`text-right py-1.5 px-2 ${accountTextColor(cat)} font-medium`}
                        >
                          {catDisplayLabel[cat] ?? cat}
                          <HelpTip
                            text={
                              contribHeaderTooltip[cat] ??
                              `Contributions to ${catDisplayLabel[cat] ?? cat}`
                            }
                          />
                        </th>
                      ))
                  : (["preTax", "taxFree", "hsa", "afterTax"] as const)
                      .filter((t) => visibleColumns.contribTaxTypes.has(t))
                      .map((bucket) => (
                        <th
                          key={bucket}
                          className={`text-right py-1.5 px-2 ${taxTypeTextColor(bucket)} font-medium`}
                        >
                          {taxTypeLabel(bucket)}
                          <HelpTip
                            text={TAX_BUCKET_DESCRIPTIONS[bucket] ?? bucket}
                          />
                        </th>
                      ))}
                <th className="text-right py-1.5 px-2 text-muted font-medium">
                  In / Out
                  <HelpTip text="Saving phase: total contributions + employer match flowing in. Withdrawal phase: total amount withdrawn across all accounts" />
                </th>
                {balanceView === "taxType" ? (
                  <>
                    {(["preTax", "taxFree", "hsa", "afterTax"] as const)
                      .filter((t) => visibleColumns.balanceTaxTypes.has(t))
                      .map((bucket, i) => (
                        <th
                          key={bucket}
                          className={`text-right py-1.5 px-2 ${taxTypeTextColor(bucket)} font-medium${i === 0 ? " border-l border-subtle" : ""}`}
                        >
                          {taxTypeLabel(bucket)}
                          <HelpTip
                            text={
                              balanceHeaderTooltip.taxType[bucket] ??
                              `${taxTypeLabel(bucket)} balance`
                            }
                          />
                        </th>
                      ))}
                  </>
                ) : (
                  <>
                    {getAccountSegments()
                      .map((s) => s.key)
                      .filter((a) => visibleColumns.balanceAccts.has(a))
                      .map((acctKey, i) => {
                        const parsed = parseColumnKey(acctKey);
                        const catKey = parsed?.category ?? acctKey;
                        return (
                          <th
                            key={acctKey}
                            className={`text-right py-1.5 px-2 ${accountTextColor(catKey)} font-medium whitespace-nowrap${i === 0 ? " border-l border-subtle" : ""}`}
                          >
                            {columnLabel[acctKey] ?? getColumnLabel(acctKey)}
                            <HelpTip
                              text={
                                balanceHeaderTooltip.account[acctKey] ??
                                columnLabel[acctKey] ??
                                getColumnLabel(acctKey)
                              }
                            />
                          </th>
                        );
                      })}
                  </>
                )}
                <th className="text-right py-1.5 px-2 text-muted font-semibold">
                  Balance
                  <HelpTip text="Total portfolio balance across all accounts and tax types at year end" />
                </th>
                {mcBandsByYear && (
                  <th className="text-right py-1.5 px-2 text-muted font-medium whitespace-nowrap border-l border-subtle">
                    MC Median
                    <HelpTip text="Monte Carlo median (50th percentile) — half of simulated outcomes are above, half below. Hover for p5–p95 range." />
                  </th>
                )}
                <th className="text-left py-1.5 pl-2 text-faint font-medium whitespace-nowrap border-l border-subtle">
                  Info
                  <HelpTip text="Year-specific events: phase transitions, brokerage goal withdrawals, overrides, and milestone markers" />
                </th>
              </tr>
            </thead>
            <tbody>
              {getFilteredYears(result.projectionByYear).map((yr) => {
                const isPhaseTransition =
                  yr.phase === "decumulation" &&
                  result.projectionByYear.findIndex(
                    (y) => y.phase === "decumulation",
                  ) === result.projectionByYear.indexOf(yr);
                const hasOverride =
                  accumOverrides.some((o) => o.year === yr.year) ||
                  decumOverrides.some((o) => o.year === yr.year);

                const accumOverrideNotes = accumOverrides.find(
                  (o) => o.year === yr.year,
                )?.notes;
                const decumOverrideNotes = decumOverrides.find(
                  (o) => o.year === yr.year,
                )?.notes;
                const salaryOverrideNotes = dbSalaryOverrides?.find(
                  (o) => o.projectionYear === yr.year,
                )?.notes;
                const budgetOverrideNotes = dbBudgetOverrides?.find(
                  (o) => o.projectionYear === yr.year,
                )?.notes;

                if (isAccumYear(yr)) {
                  return (
                    <AccumulationRow
                      key={yr.year}
                      yr={yr}
                      state={s}
                      parentCategoryFilter={parentCategoryFilter}
                      isPhaseTransition={isPhaseTransition}
                      hasOverride={hasOverride}
                      accumOverrideNotes={accumOverrideNotes}
                      salaryOverrideNotes={salaryOverrideNotes}
                      budgetOverrideNotes={budgetOverrideNotes}
                      accumulationBudgetProfileId={accumulationBudgetProfileId}
                      accumulationBudgetColumn={accumulationBudgetColumn}
                      accumulationExpenseOverride={accumulationExpenseOverride}
                      people={people}
                      mcCellOpts={mcCellOpts}
                    />
                  );
                }

                return (
                  <DecumulationRow
                    key={yr.year}
                    yr={yr as EngineDecumulationYear}
                    state={s}
                    parentCategoryFilter={parentCategoryFilter}
                    isPhaseTransition={isPhaseTransition}
                    hasOverride={hasOverride}
                    decumOverrideNotes={decumOverrideNotes}
                    salaryOverrideNotes={salaryOverrideNotes}
                    budgetOverrideNotes={budgetOverrideNotes}
                    decumulationBudgetProfileId={decumulationBudgetProfileId}
                    decumulationBudgetColumn={decumulationBudgetColumn}
                    decumulationExpenseOverride={decumulationExpenseOverride}
                    people={people}
                    mcCellOpts={mcCellOpts}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <ContribMethodologySection state={s} />
    </>
  );
}
