"use client";

/** Year-by-year projection table with dynamic column headers, accumulation/decumulation row delegation, and Monte Carlo overlay. */
import { useHighIncomeHousehold } from "@/lib/hooks/use-high-income-household";
import { ProjectionTableSkeleton } from "./projection-table-skeleton";
import { QueryBoundary, queryPending } from "@/components/ui/query-boundary";
import { useFocusMatch } from "@/lib/hooks/use-focus";
import { HelpTip } from "@/components/ui/help-tip";
import { useSavingsRateOptions } from "@/lib/hooks/use-savings-rate-options";
import { Toggle } from "@/components/ui/toggle";
import { PillBtn, LabeledPillGroup } from "../pill-btn";
import { accountTextColor, taxTypeTextColor } from "@/lib/utils/colors";
import type { EngineDecumulationYear } from "@/lib/pure/engine/types";
import {
  getAccountSegments,
  getAllCategories,
  getColumnLabel,
  parseColumnKey,
} from "@/lib/config/account-types";
import {
  TAX_BUCKET_DESCRIPTIONS,
  taxTypeLabel,
} from "@/lib/config/display-labels";
import { catDisplayLabel } from "../projection-display";
import { isAccumYear } from "../parent-category-filter";
import { _singleBucketCategories } from "./bucket-slots";
import type { ProjectionTableProps } from "../projection-table-types";
import { type RenderSimulationCellOptions } from "./projection-table-mc-cell";
import { AccumulationRow } from "./projection-table-accum-row";
import { DecumulationRow } from "./projection-table-decum-row";
import { ContributionMethodologySection } from "./projection-table-contrib-methodology";
import { TaxSummaryCard } from "./tax-summary-card";

/**
 * Unified projection table — accumulation + decumulation year-by-year data.
 * Row rendering delegated to AccumulationRow and DecumulationRow components.
 */
export function ProjectionTable({
  state,
  people,
  parentCategoryFilter,
  accumulationBudgetProfileId,
  accumulationBudgetColumn,
  accumulationExpenseOverride,
  decumulationBudgetProfileId,
  decumulationBudgetColumn,
  decumulationExpenseOverride,
}: ProjectionTableProps) {
  const focusedYear = useFocusMatch("projectionYear")?.year ?? null;
  const {
    accumOverrides,
    decumOverrides,
    balanceView,
    setBalanceView,
    contributionView,
    setContributionView,
    showAllYears,
    setShowAllYears,
    diagMode,
    isPersonFiltered,
    personFilterName,
    dbSalaryOverrides,
    dbBudgetOverrides,
    simulationBandsByYear,
    simulationDetByYear,
    getFilteredYears,
    visibleColumns,
    columnLabel,
    contributionHeaderTooltip,
    balanceHeaderTooltip,
    result,
    deflate,
    renderTooltip,
    hasIndividualAccountData,
  } = state;

  // The Rate column counts the match as the shared savings-rate switch says.
  const { highIncome, queries: highIncomeQueries } = useHighIncomeHousehold();
  const { excludeMatch } = useSavingsRateOptions(highIncome === true);

  // Shared MC cell rendering options — passed to row components
  const simulationCellOpts: RenderSimulationCellOptions = {
    simulationBandsByYear,
    simulationDetByYear,
    deflate,
    isPersonFiltered,
    parentCategoryFilter,
    diagMode,
    renderTooltip,
  };
  const skeleton = <ProjectionTableSkeleton />;
  if (queryPending(highIncomeQueries) || highIncome === undefined)
    return <QueryBoundary query={highIncomeQueries} fallback={skeleton} />;

  return (
    <>
      {result && isPersonFiltered && (
        <div className="text-caption text-faint mb-1">
          Showing {personFilterName}&apos;s accounts only.
        </div>
      )}
      {result && !hasIndividualAccountData && (
        <div className="text-caption text-faint mb-1">
          This scenario uses Simple tax mode, which doesn&apos;t track
          individual accounts — the Balance column below is your real total, but
          a Traditional/Roth/HSA/After-tax breakdown isn&apos;t available.
          Switch to Advanced tax mode to see your real account split.
        </div>
      )}
      {result && (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-2 print:hidden">
            <LabeledPillGroup label="Contributions">
              <PillBtn
                active={contributionView === "account"}
                onClick={() => setContributionView("account")}
                label="Account"
              />
              <PillBtn
                active={contributionView === "taxType"}
                onClick={() => setContributionView("taxType")}
                label="Tax Type"
              />
            </LabeledPillGroup>
            {hasIndividualAccountData && (
              <LabeledPillGroup label="Balances">
                <PillBtn
                  active={balanceView === "taxType"}
                  onClick={() => setBalanceView("taxType")}
                  label="Tax Type"
                />
                <PillBtn
                  active={balanceView === "account"}
                  onClick={() => setBalanceView("account")}
                  label="Account"
                />
              </LabeledPillGroup>
            )}
            <Toggle
              label="All years"
              isChecked={showAllYears}
              onChange={setShowAllYears}
              size="xs"
            />
          </div>
          <div className="projection-table-scroll max-h-[28rem] overflow-x-auto overflow-y-auto print:max-h-none print:overflow-visible">
            <table
              className="projection-table text-xs print:text-[7px]"
              aria-label="Year-by-year retirement projection table with contributions, balances by tax bucket, and withdrawals"
              style={{
                minWidth:
                  (balanceView === "account" || contributionView === "account"
                    ? 1400
                    : 1100) + (simulationBandsByYear ? 120 : 0),
              }}
            >
              <caption className="sr-only">
                Year-by-year retirement projection. Columns include age, salary,
                contributions split by tax treatment, account balances, return
                rate, and withdrawal amounts in retirement years. Use Tab to
                navigate; column headers indicate sort order via aria-sort.
              </caption>
              <thead className="bg-surface-primary sticky top-0 z-10">
                {/* Column group headers */}
                <tr className="border-subtle border-b">
                  <th
                    colSpan={2}
                    className="text-caption text-faint py-1 text-center font-semibold tracking-wider uppercase"
                  >
                    Timeline
                  </th>
                  <th
                    colSpan={
                      3 +
                      (contributionView === "account"
                        ? getAllCategories().filter((c) =>
                            visibleColumns.contributionCats.has(c),
                          ).length
                        : (
                            ["preTax", "taxFree", "hsa", "afterTax"] as const
                          ).filter((t) =>
                            visibleColumns.contributionTaxTypes.has(t),
                          ).length)
                    }
                    className="text-caption text-faint border-subtle border-l py-1 text-center font-semibold tracking-wider uppercase"
                  >
                    Contributions{" "}
                    {contributionView === "taxType" ? "(by Tax Type)" : ""}
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
                            .filter((a) =>
                              visibleColumns.balanceAccounts.has(a),
                            ).length)
                    }
                    className="text-caption text-faint border-subtle border-l py-1 text-center font-semibold tracking-wider uppercase"
                  >
                    Balances{" "}
                    {hasIndividualAccountData
                      ? balanceView === "account"
                        ? "(by Account)"
                        : "(by Tax Type)"
                      : ""}
                  </th>
                  {simulationBandsByYear && (
                    <th className="text-caption text-faint border-subtle border-l py-1 text-center font-semibold tracking-wider uppercase">
                      Simulation
                    </th>
                  )}
                  <th className="text-caption text-faint border-subtle border-l py-1 text-center font-semibold tracking-wider uppercase">
                    Notes
                  </th>
                </tr>
                <tr className="border-b">
                  <th className="text-muted py-1.5 pr-2 text-left font-medium">
                    Year
                    <HelpTip text="Calendar year of the projection. Hover a year to see each person's age." />
                  </th>
                  <th className="text-muted px-2 py-1.5 text-left font-medium">
                    Phase
                    <HelpTip text="Accumulation (saving/investing) or Decumulation (withdrawing in retirement)" />
                  </th>
                  <th className="text-muted border-subtle border-l px-2 py-1.5 text-right font-medium">
                    Salary
                    <HelpTip text="Gross annual salary before deductions, growing by the configured raise rate" />
                  </th>
                  <th className="text-faint px-2 py-1.5 text-right font-medium">
                    Rate
                    <HelpTip text="Contribution rate as % of salary — total employee contributions divided by gross salary" />
                  </th>
                  {contributionView === "account"
                    ? getAllCategories()
                        .filter((c) => visibleColumns.contributionCats.has(c))
                        .map((cat) => (
                          <th
                            key={cat}
                            className={`px-2 py-1.5 text-right ${accountTextColor(cat)} font-medium`}
                          >
                            {catDisplayLabel[cat] ?? cat}
                            <HelpTip
                              text={
                                contributionHeaderTooltip[cat] ??
                                `Contributions to ${catDisplayLabel[cat] ?? cat}`
                              }
                            />
                          </th>
                        ))
                    : (["preTax", "taxFree", "hsa", "afterTax"] as const)
                        .filter((t) =>
                          visibleColumns.contributionTaxTypes.has(t),
                        )
                        .map((bucket) => (
                          <th
                            key={bucket}
                            className={`px-2 py-1.5 text-right ${taxTypeTextColor(bucket)} font-medium`}
                          >
                            {taxTypeLabel(bucket)}
                            <HelpTip
                              text={TAX_BUCKET_DESCRIPTIONS[bucket] ?? bucket}
                            />
                          </th>
                        ))}
                  <th className="text-muted px-2 py-1.5 text-right font-medium">
                    In / Out
                    <HelpTip text="Saving years: contributions and employer match going in. Withdrawal years: the total withdrawn. A year a paycheck is gone shows both: what went in, and below it what came out. Hover for the money in and out." />
                  </th>
                  {balanceView === "taxType" ? (
                    <>
                      {(["preTax", "taxFree", "hsa", "afterTax"] as const)
                        .filter((t) => visibleColumns.balanceTaxTypes.has(t))
                        .map((bucket, i) => (
                          <th
                            key={bucket}
                            className={`px-2 py-1.5 text-right ${taxTypeTextColor(bucket)} font-medium${i === 0 ? "border-subtle border-l" : ""}`}
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
                        .filter((a) => visibleColumns.balanceAccounts.has(a))
                        .map((accountKey, i) => {
                          const parsed = parseColumnKey(accountKey);
                          const catKey = parsed?.category ?? accountKey;
                          return (
                            <th
                              key={accountKey}
                              className={`px-2 py-1.5 text-right ${accountTextColor(catKey)} font-medium whitespace-nowrap${i === 0 ? "border-subtle border-l" : ""}`}
                            >
                              {columnLabel[accountKey] ??
                                getColumnLabel(accountKey)}
                              <HelpTip
                                text={
                                  balanceHeaderTooltip.account[accountKey] ??
                                  columnLabel[accountKey] ??
                                  getColumnLabel(accountKey)
                                }
                              />
                            </th>
                          );
                        })}
                    </>
                  )}
                  <th className="text-muted px-2 py-1.5 text-right font-semibold">
                    Balance
                    <HelpTip text="Total portfolio balance across all accounts and tax types at year end" />
                  </th>
                  {simulationBandsByYear && (
                    <th className="text-muted border-subtle border-l px-2 py-1.5 text-right font-medium whitespace-nowrap">
                      Sim. Median
                      <HelpTip text="Simulation median (50th percentile) — half of simulated outcomes are above, half below. Hover for p5–p95 range." />
                    </th>
                  )}
                  <th className="text-faint border-subtle border-l py-1.5 pl-2 text-left font-medium whitespace-nowrap">
                    Info
                    <HelpTip text="Year-specific events: phase transitions, brokerage goal withdrawals, changes by year, and milestone markers" />
                  </th>
                </tr>
              </thead>
              <tbody>
                {getFilteredYears(result.projectionByYear).map((yearRow) => {
                  const focused = yearRow.year === focusedYear;
                  const isPhaseTransition =
                    yearRow.phase === "decumulation" &&
                    result.projectionByYear.findIndex(
                      (y) => y.phase === "decumulation",
                    ) === result.projectionByYear.indexOf(yearRow);
                  const hasOverride =
                    accumOverrides.some((o) => o.year === yearRow.year) ||
                    decumOverrides.some((o) => o.year === yearRow.year);

                  const accumOverrideNotes = accumOverrides.find(
                    (o) => o.year === yearRow.year,
                  )?.notes;
                  const decumOverrideNotes = decumOverrides.find(
                    (o) => o.year === yearRow.year,
                  )?.notes;
                  const salaryOverrideNotes = dbSalaryOverrides?.find(
                    (o) => o.projectionYear === yearRow.year,
                  )?.notes;
                  const budgetOverrideNotes = dbBudgetOverrides?.find(
                    (o) => o.projectionYear === yearRow.year,
                  )?.notes;

                  if (isAccumYear(yearRow)) {
                    return (
                      <AccumulationRow
                        key={yearRow.year}
                        yr={yearRow}
                        focused={focused}
                        state={state}
                        parentCategoryFilter={parentCategoryFilter}
                        rateIncludesMatch={!excludeMatch}
                        isPhaseTransition={isPhaseTransition}
                        hasOverride={hasOverride}
                        accumOverrideNotes={accumOverrideNotes}
                        salaryOverrideNotes={salaryOverrideNotes}
                        budgetOverrideNotes={budgetOverrideNotes}
                        accumulationBudgetProfileId={
                          accumulationBudgetProfileId
                        }
                        accumulationBudgetColumn={accumulationBudgetColumn}
                        accumulationExpenseOverride={
                          accumulationExpenseOverride
                        }
                        people={people}
                        simulationCellOpts={simulationCellOpts}
                      />
                    );
                  }

                  return (
                    <DecumulationRow
                      key={yearRow.year}
                      yearRow={yearRow as EngineDecumulationYear}
                      focused={focused}
                      state={state}
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
                      simulationCellOpts={simulationCellOpts}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Lifetime tax summary — below the table, above the methodology
          blurb. Decumulation only, see the card's own docblock. */}
      {result && (
        <div className="mt-2 print:hidden">
          <TaxSummaryCard state={state} />
        </div>
      )}

      {/* Methodology links/validation-evidence are engine-internal
          detail, not report content — the print report's own "Behind the
          Scenes" section covers assumptions instead. */}
      <div className="print:hidden">
        <ContributionMethodologySection state={state} />
      </div>
    </>
  );
}
