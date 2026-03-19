"use client";

import { HelpTip } from "@/components/ui/help-tip";
import { Tooltip } from "@/components/ui/tooltip";
import {
  accountColor,
  accountTextColor,
  taxTypeTextColor,
  taxTypeLabel,
} from "@/lib/utils/colors";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import type {
  AccountCategory,
  EngineYearProjection,
  EngineAccumulationYear,
  EngineDecumulationYear,
  AccumulationSlot,
  DecumulationSlot,
} from "@/lib/calculators/types";
import {
  type AccountCategory as AcctCat,
  getAccountSegments,
  getSegmentBalance,
  getAllCategories,
  categoriesWithTaxPreference,
  getAccountTypeConfig,
  getDisplayConfig,
  getColumnLabel,
  parseColumnKey,
  ACCOUNT_TYPE_CONFIG,
} from "@/lib/config/account-types";
import { TAX_BUCKET_DESCRIPTIONS } from "@/lib/config/display-labels";
import type { TipColor, TooltipLineItem } from "./types";
import {
  catDisplayLabel,
  TAX_TREATMENT_TO_BUCKET,
  bucketSlotMap,
  _singleBucketCategories,
  isAccumYear,
  itemTaxType,
  colKeyParts,
  colBalance,
  safeDivide,
  colWithdrawal,
  colEngineTaxType,
  slotBucketWithdrawal,
  slotBucketContrib,
  slotsColumnBalanceInflow,
  slotsBucketBalanceInflow,
  filterSpecsForBucket,
  iaBelongsToBucket,
  pctOf,
  proRateMonths,
  specFrac,
  matchFracOf,
  computeColumnChange,
  computeAccountSplits,
} from "./utils";
import type { useProjectionState } from "./use-projection-state";

type ProjectionState = ReturnType<typeof useProjectionState>;

export type ProjectionTableProps = {
  state: ProjectionState;
  people?: { id: number; name: string; birthYear: number }[];
  parentCategoryFilter?: string;
  accumulationBudgetProfileId?: number;
  accumulationBudgetColumn?: number;
  accumulationExpenseOverride?: number;
  decumulationBudgetProfileId?: number;
  decumulationBudgetColumn?: number;
  decumulationExpenseOverride?: number;
};

/**
 * Unified projection table — accumulation + decumulation year-by-year data.
 * Extracted from ProjectionCard to reduce file size.
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
    accumOverrides, decumOverrides,
    balanceView, contribView,
    diagMode,
    showModels, setShowModels,
    setShowValidation,
    setShowAccumMethodology,
    setShowDecumMethodology,
    withdrawalRoutingMode,
    withdrawalOrder,
    personFilter, isPersonFiltered, personFilterName,
    dbSalaryOverrides, dbBudgetOverrides,
    enginePeople, engineSettings, realDefaults,
    mcBandsByYear, mcDetByYear,
    getPersonYearTotals, getFilteredYears,
    visibleColumns, columnLabel,
    contribHeaderTooltip, balanceHeaderTooltip,
    contribSpecs, budgetProfileSummaries,
    result, baseYear, deflate, displayAge, renderTooltip,
  } = s;

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
                                  [
                                    "preTax",
                                    "taxFree",
                                    "hsa",
                                    "afterTax",
                                  ] as const
                                ).filter((t) =>
                                  visibleColumns.contribTaxTypes.has(t),
                                ).length)
                          }
                          className="text-center py-1 text-[10px] text-faint font-semibold uppercase tracking-wider border-l border-subtle"
                        >
                          Contributions{""}
                          {contribView === "taxType" ? "(by Tax Type)" : ""}
                        </th>
                        <th
                          colSpan={
                            1 +
                            (balanceView === "taxType"
                              ? (
                                  [
                                    "preTax",
                                    "taxFree",
                                    "hsa",
                                    "afterTax",
                                  ] as const
                                ).filter((t) =>
                                  visibleColumns.balanceTaxTypes.has(t),
                                ).length
                              : getAccountSegments()
                                  .map((s) => s.key)
                                  .filter((a) =>
                                    visibleColumns.balanceAccts.has(a),
                                  ).length)
                          }
                          className="text-center py-1 text-[10px] text-faint font-semibold uppercase tracking-wider border-l border-subtle"
                        >
                          Balances{""}
                          {balanceView === "account"
                            ? "(by Account)"
                            : "(by Tax Type)"}
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
                              .filter((t) =>
                                visibleColumns.contribTaxTypes.has(t),
                              )
                              .map((bucket) => (
                                <th
                                  key={bucket}
                                  className={`text-right py-1.5 px-2 ${taxTypeTextColor(bucket)} font-medium`}
                                >
                                  {taxTypeLabel(bucket)}
                                  <HelpTip
                                    text={
                                      TAX_BUCKET_DESCRIPTIONS[bucket] ?? bucket
                                    }
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
                              .filter((t) =>
                                visibleColumns.balanceTaxTypes.has(t),
                              )
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
                                    {columnLabel[acctKey] ??
                                      getColumnLabel(acctKey)}
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
                    {/* MC cell renderer — shared between accumulation and decumulation rows */}
                    {(() => {
                      const renderMcCell = (
                        yr: EngineYearProjection,
                        detBal: number,
                      ) => {
                        if (!mcBandsByYear) return null;
                        const band = mcBandsByYear.get(yr.year);
                        if (!band)
                          return (
                            <td className="text-right py-1.5 px-2 text-faint">
                              ---
                            </td>
                          );
                        const mcP50 = deflate(band.p50, yr.year);
                        const showDelta =
                          !isPersonFiltered && !parentCategoryFilter;
                        const delta = mcP50 - detBal;
                        const deltaColor =
                          delta >= 0 ? "text-green-600" : "text-red-500";
                        // Proof: show MC's own deterministic year data to verify overrides are applied (diag mode only)
                        const mcDetYr = diagMode
                          ? mcDetByYear?.get(yr.year)
                          : undefined;
                        let proofNote: string | undefined;
                        if (mcDetYr) {
                          const parts: string[] = [];
                          parts.push(
                            `MC det. bal: ${formatCurrency(deflate(mcDetYr.endBalance, yr.year))}`,
                          );
                          parts.push(`Standalone: ${formatCurrency(detBal)}`);
                          parts.push(
                            `Expenses: ${formatCurrency(deflate(mcDetYr.projectedExpenses, yr.year))}/yr`,
                          );
                          if (mcDetYr.phase === "accumulation") {
                            const accYr = mcDetYr as EngineAccumulationYear;
                            parts.push(
                              `Salary: ${formatCurrency(deflate(accYr.projectedSalary, yr.year))}`,
                            );
                            parts.push(
                              `Contribs: ${formatCurrency(deflate(accYr.totalEmployee + accYr.totalEmployer, yr.year))}`,
                            );
                          } else {
                            const decYr = mcDetYr as EngineDecumulationYear;
                            parts.push(
                              `Withdrawals: ${formatCurrency(deflate(decYr.totalWithdrawal, yr.year))}`,
                            );
                            parts.push(
                              `Tax rate: ${formatPercent(decYr.effectiveTaxRate, 1)}`,
                            );
                          }
                          proofNote = `MC Engine: ${parts.join(" ·")}`;
                        }
                        return (
                          <Tooltip
                            content={renderTooltip({
                              kind: "money",
                              header: "MC Percentiles",
                              items: [
                                {
                                  label: "95th",
                                  amount: deflate(band.p95, yr.year),
                                },
                                {
                                  label: "75th",
                                  amount: deflate(band.p75, yr.year),
                                },
                                { label: "Median", amount: mcP50 },
                                {
                                  label: "25th",
                                  amount: deflate(band.p25, yr.year),
                                },
                                {
                                  label: "5th",
                                  amount: deflate(band.p5, yr.year),
                                },
                              ],
                              ...(isPersonFiltered || proofNote
                                ? {
                                    overrideNote: [
                                      isPersonFiltered
                                        ? "MC values are household aggregate"
                                        : "",
                                      proofNote ?? "",
                                    ]
                                      .filter(Boolean)
                                      .join("\n"),
                                  }
                                : {}),
                            })}
                            side="top"
                          >
                            <td className="text-right py-1.5 px-2 text-purple-700 tabular-nums border-l border-subtle">
                              {formatCurrency(Math.max(0, mcP50))}
                              {showDelta && Math.abs(delta) > 1 && (
                                <div className={`text-[9px] ${deltaColor}`}>
                                  {delta >= 0 ? "+" : ""}
                                  {formatCurrency(delta)}
                                </div>
                              )}
                            </td>
                          </Tooltip>
                        );
                      };
                      return (
                        <tbody>
                          {getFilteredYears(result.projectionByYear).map(
                            (yr) => {
                              const isPhaseTransition =
                                yr.phase === "decumulation" &&
                                result.projectionByYear.findIndex(
                                  (y) => y.phase === "decumulation",
                                ) === result.projectionByYear.indexOf(yr);
                              const hasOverride =
                                accumOverrides.some(
                                  (o) => o.year === yr.year,
                                ) ||
                                decumOverrides.some((o) => o.year === yr.year);

                              // Find override notes for this year (accumulation or decumulation)
                              const accumOverrideNotes = accumOverrides.find(
                                (o) => o.year === yr.year,
                              )?.notes;
                              const decumOverrideNotes = decumOverrides.find(
                                (o) => o.year === yr.year,
                              )?.notes;
                              const salaryOverrideNotes =
                                dbSalaryOverrides?.find(
                                  (o) => o.projectionYear === yr.year,
                                )?.notes;
                              const budgetOverrideNotes =
                                dbBudgetOverrides?.find(
                                  (o) => o.projectionYear === yr.year,
                                )?.notes;

                              if (isAccumYear(yr)) {
                                const slotMap = new Map<
                                  AccountCategory,
                                  AccumulationSlot
                                >(yr.slots.map((s) => [s.category, s]));
                                const pt = getPersonYearTotals(yr); // real per-person balances
                                return (
                                  <tr
                                    key={yr.year}
                                    className={`border-b border-subtle hover:bg-surface-elevated/60 transition-colors ${
                                      isPhaseTransition
                                        ? "bg-blue-50 font-medium"
                                        : hasOverride
                                          ? "bg-emerald-50"
                                          : yr.overflowToBrokerage > 0
                                            ? "bg-amber-50/50"
                                            : ""
                                    }`}
                                  >
                                    <td className="py-1.5 pr-2 whitespace-nowrap">
                                      {yr.year}
                                      {yr.proRateFraction != null && (
                                        <Tooltip
                                          content={`Partial year: only ${proRateMonths(yr.proRateFraction)} of 12 months remain. All values in this row reflect the remaining months, not the full year.`}
                                          side="right"
                                          maxWidth={220}
                                        >
                                          <span className="text-[9px] text-blue-500 align-super">
                                            *
                                          </span>
                                        </Tooltip>
                                      )}
                                    </td>
                                    <Tooltip
                                      content={(() => {
                                        const pp = people ?? enginePeople;
                                        if (!pp || pp.length < 2)
                                          return undefined;
                                        return renderTooltip({
                                          kind: "info",
                                          lines: pp.map((p) => ({
                                            text: `${p.name}: ${yr.year - p.birthYear}`,
                                            style: "header" as const,
                                          })),
                                        });
                                      })()}
                                      side="top"
                                    >
                                      <td className="py-1.5 px-2">
                                        {displayAge(yr.year) ?? yr.age}
                                      </td>
                                    </Tooltip>
                                    <td className="py-1.5 px-2">
                                      <span className="text-green-600 text-[10px] font-medium">
                                        SAVE
                                      </span>
                                    </td>
                                    <Tooltip
                                      content={(() => {
                                        const prevYr =
                                          result.projectionByYear.find(
                                            (y) => y.year === yr.year - 1,
                                          );
                                        const prevSalary =
                                          prevYr &&
                                          prevYr.phase === "accumulation"
                                            ? (prevYr as EngineAccumulationYear)
                                                .projectedSalary
                                            : null;
                                        const pctChange =
                                          prevSalary && prevSalary > 0
                                            ? (yr.projectedSalary -
                                                prevSalary) /
                                              prevSalary
                                            : null;
                                        const lines: {
                                          text: string;
                                          style: "header" | "meta" | "note";
                                          color?: TipColor;
                                        }[] = [];
                                        if (yr.hasSalaryOverride) {
                                          lines.push({
                                            text: `Salary overridden for this year${salaryOverrideNotes ? ` — ${salaryOverrideNotes}` : ""}`,
                                            style: "note",
                                            color: "emerald",
                                          });
                                        } else if (pctChange !== null) {
                                          lines.push({
                                            text: `${pctChange >= 0 ? "+" : ""}${formatPercent(pctChange, 1)} from prior year`,
                                            style: "header",
                                          });
                                        } else {
                                          lines.push({
                                            text: "Base salary (year 1)",
                                            style: "header",
                                          });
                                        }
                                        if (
                                          !yr.hasSalaryOverride &&
                                          engineSettings
                                        ) {
                                          lines.push({
                                            text: `Annual raise: ${formatPercent(Number(engineSettings.salaryAnnualIncrease), 1)}/yr`,
                                            style: "meta",
                                          });
                                        }
                                        return renderTooltip({
                                          kind: "info",
                                          lines,
                                        });
                                      })()}
                                      side="top"
                                    >
                                      <td className="text-right py-1.5 px-2 text-muted">
                                        {(() => {
                                          let displaySalary =
                                            yr.projectedSalary;
                                          if (
                                            isPersonFiltered &&
                                            yr.projectedSalaryByPerson &&
                                            enginePeople
                                          ) {
                                            const person = enginePeople.find(
                                              (p) => p.id === personFilter,
                                            );
                                            if (
                                              person &&
                                              yr.projectedSalaryByPerson[
                                                person.id
                                              ] != null
                                            ) {
                                              displaySalary =
                                                yr.projectedSalaryByPerson[
                                                  person.id
                                                ]!;
                                            }
                                          }
                                          return formatCurrency(
                                            deflate(displaySalary, yr.year),
                                          );
                                        })()}
                                      </td>
                                    </Tooltip>
                                    <Tooltip
                                      content={
                                        yr.projectedSalary > 0
                                          ? (() => {
                                              const effectiveSalary =
                                                yr.proRateFraction != null &&
                                                yr.proRateFraction > 0
                                                  ? yr.projectedSalary *
                                                    yr.proRateFraction
                                                  : yr.projectedSalary;
                                              const effectiveRate = safeDivide(
                                                yr.totalEmployee,
                                                effectiveSalary,
                                              );
                                              const lines: {
                                                text: string;
                                                style:
                                                  | "header"
                                                  | "meta"
                                                  | "note";
                                                color?: TipColor;
                                              }[] = [
                                                {
                                                  text: `${formatCurrency(deflate(yr.totalEmployee, yr.year))} / ${formatCurrency(deflate(effectiveSalary, yr.year))} = ${formatPercent(effectiveRate, 1)}`,
                                                  style: "header",
                                                },
                                                {
                                                  text: `Target rate: ${formatPercent(yr.config.contributionRate, 1)}`,
                                                  style: "meta",
                                                },
                                              ];
                                              if (yr.proRateFraction != null) {
                                                lines.push({
                                                  text: `${proRateMonths(yr.proRateFraction)}/12 mo — salary pro-rated from ${formatCurrency(deflate(yr.projectedSalary, yr.year))}/yr`,
                                                  style: "meta",
                                                });
                                              }
                                              if (
                                                yr.rateCeilingScale != null &&
                                                yr.rateCeilingScale < 1 &&
                                                yr.rateCeilingScale > 0
                                              ) {
                                                lines.push({
                                                  text: `Uncapped rate: ${formatPercent(safeDivide(yr.totalEmployee, effectiveSalary * yr.rateCeilingScale), 1)} → ${formatPercent(effectiveRate, 1)} (ceiling applied)`,
                                                  style: "note",
                                                  color: "amber",
                                                });
                                              }
                                              if (yr.rateCeilingScale == null) {
                                                const diff =
                                                  effectiveRate -
                                                  yr.config.contributionRate;
                                                if (Math.abs(diff) > 0.001) {
                                                  lines.push({
                                                    text: `Actual ${diff > 0 ? "higher" : "lower"} — per-account specs${diff < 0 ? " / IRS limits" : ""}`,
                                                    style: "note",
                                                    color: "amber",
                                                  });
                                                }
                                              }
                                              if (
                                                accumOverrides.some(
                                                  (o) =>
                                                    o.year === yr.year &&
                                                    o.contributionRate !==
                                                      undefined,
                                                )
                                              ) {
                                                lines.push({
                                                  text: `Overridden for this year${accumOverrideNotes ? ` — ${accumOverrideNotes}` : ""}`,
                                                  style: "note",
                                                  color: "emerald",
                                                });
                                              }
                                              return renderTooltip({
                                                kind: "info",
                                                lines,
                                              });
                                            })()
                                          : undefined
                                      }
                                      side="top"
                                    >
                                      <td className="text-right py-1.5 px-2 text-faint">
                                        {yr.projectedSalary > 0
                                          ? formatPercent(
                                              safeDivide(
                                                yr.totalEmployee,
                                                yr.proRateFraction != null &&
                                                  yr.proRateFraction > 0
                                                  ? yr.projectedSalary *
                                                      yr.proRateFraction
                                                  : yr.projectedSalary,
                                              ),
                                              1,
                                            )
                                          : "---"}
                                      </td>
                                    </Tooltip>
                                    {contribView === "account" ? (
                                      <>
                                        {getAllCategories()
                                          .filter(
                                            (c) =>
                                              !ACCOUNT_TYPE_CONFIG[c]
                                                .isOverflowTarget &&
                                              visibleColumns.contribCats.has(c),
                                          )
                                          .map((cat) => {
                                            const slot = slotMap.get(cat);
                                            const rawEmp =
                                              slot?.employeeContrib ?? 0;
                                            const rawMatch =
                                              slot?.employerMatch ?? 0;
                                            const catContrib =
                                              pt?.byCategoryContrib[cat];
                                            const emp = catContrib
                                              ? catContrib.employee
                                              : rawEmp;
                                            const match = catContrib
                                              ? catContrib.match
                                              : rawMatch;
                                            const total = emp + match;
                                            // Build per-person breakdown for tooltip
                                            const catSpecs =
                                              contribSpecs?.filter(
                                                (s) => s.category === cat,
                                              ) ?? [];
                                            const specTotal = catSpecs.reduce(
                                              (s, sp) =>
                                                s + (sp.baseAnnual || 0),
                                              0,
                                            );
                                            const catLabel =
                                              catDisplayLabel[cat] ?? cat;
                                            const finalTooltip =
                                              emp > 0 || match > 0
                                                ? (() => {
                                                    const items: TooltipLineItem[] =
                                                      catSpecs.length > 1
                                                        ? catSpecs
                                                            .filter(
                                                              (sp) =>
                                                                !isPersonFiltered ||
                                                                sp.personId ===
                                                                  personFilter,
                                                            )
                                                            .map((sp) => {
                                                              const frac =
                                                                specFrac({
                                                                  baseAnnual:
                                                                    sp.baseAnnual ||
                                                                    0,
                                                                  specTotal,
                                                                  specCount:
                                                                    catSpecs.length,
                                                                });
                                                              const personEmp =
                                                                rawEmp * frac;
                                                              const label =
                                                                sp.ownerName
                                                                  ? `${sp.ownerName} (${sp.name})`
                                                                  : sp.name;
                                                              const matchTotal =
                                                                catSpecs.reduce(
                                                                  (s2, s2p) =>
                                                                    s2 +
                                                                    (s2p.matchAnnual ??
                                                                      0),
                                                                  0,
                                                                );
                                                              const mFrac =
                                                                matchFracOf({
                                                                  matchAnnual:
                                                                    sp.matchAnnual ??
                                                                    0,
                                                                  allMatchAnnual:
                                                                    matchTotal,
                                                                });
                                                              return {
                                                                label,
                                                                amount: deflate(
                                                                  personEmp,
                                                                  yr.year,
                                                                ),
                                                                taxType:
                                                                  itemTaxType(
                                                                    cat,
                                                                    sp.taxTreatment,
                                                                  ),
                                                                match:
                                                                  (sp.matchAnnual ??
                                                                    0) > 0
                                                                    ? deflate(
                                                                        rawMatch *
                                                                          mFrac,
                                                                        yr.year,
                                                                      )
                                                                    : undefined,
                                                                matchLabel:
                                                                  getDisplayConfig(
                                                                    cat,
                                                                    sp.name !==
                                                                      cat
                                                                      ? sp.name
                                                                      : undefined,
                                                                  )
                                                                    .employerMatchLabel,
                                                              };
                                                            })
                                                        : [
                                                            {
                                                              label:
                                                                catSpecs[0]
                                                                  ?.ownerName ??
                                                                (isPersonFiltered
                                                                  ? personFilterName
                                                                  : "Employee"),
                                                              amount: deflate(
                                                                emp,
                                                                yr.year,
                                                              ),
                                                              taxType:
                                                                itemTaxType(
                                                                  cat,
                                                                  catSpecs[0]
                                                                    ?.taxTreatment,
                                                                ),
                                                              match:
                                                                match > 0
                                                                  ? deflate(
                                                                      match,
                                                                      yr.year,
                                                                    )
                                                                  : undefined,
                                                              matchLabel:
                                                                getDisplayConfig(
                                                                  cat,
                                                                  catSpecs[0]
                                                                    ?.name !==
                                                                    cat
                                                                    ? catSpecs[0]
                                                                        ?.name
                                                                    : undefined,
                                                                )
                                                                  .employerMatchLabel,
                                                            },
                                                          ];
                                                    return renderTooltip({
                                                      kind: "money",
                                                      header: `${catLabel} Contributions`,
                                                      items,
                                                      taxSplit:
                                                        getAccountTypeConfig(
                                                          cat,
                                                        ).supportsRothSplit &&
                                                        slot &&
                                                        (slot.rothContrib > 0 ||
                                                          slot.traditionalContrib >
                                                            0)
                                                          ? {
                                                              traditional:
                                                                deflate(
                                                                  slot.traditionalContrib,
                                                                  yr.year,
                                                                ),
                                                              roth: deflate(
                                                                slot.rothContrib,
                                                                yr.year,
                                                              ),
                                                            }
                                                          : undefined,
                                                      rateCeiling:
                                                        yr.rateCeilingScale !=
                                                          null &&
                                                        yr.rateCeilingScale <
                                                          1 &&
                                                        yr.rateCeilingScale > 0
                                                          ? {
                                                              uncapped: deflate(
                                                                safeDivide(
                                                                  emp,
                                                                  yr.rateCeilingScale,
                                                                ),
                                                                yr.year,
                                                              ),
                                                              capped: deflate(
                                                                emp,
                                                                yr.year,
                                                              ),
                                                              pct:
                                                                1 -
                                                                yr.rateCeilingScale,
                                                            }
                                                          : undefined,
                                                      irsLimit: slot
                                                        ? {
                                                            category: catLabel,
                                                            limit: deflate(
                                                              slot.irsLimit,
                                                              yr.year,
                                                            ),
                                                            used: deflate(
                                                              emp,
                                                              yr.year,
                                                            ),
                                                          }
                                                        : undefined,
                                                      proRate:
                                                        yr.proRateFraction !=
                                                        null
                                                          ? {
                                                              months:
                                                                proRateMonths(
                                                                  yr.proRateFraction,
                                                                ),
                                                              annualAmount:
                                                                deflate(
                                                                  specTotal,
                                                                  yr.year,
                                                                ),
                                                              proRatedAmount:
                                                                deflate(
                                                                  emp,
                                                                  yr.year,
                                                                ),
                                                            }
                                                          : undefined,
                                                    });
                                                  })()
                                                : undefined;
                                            return (
                                              <Tooltip
                                                key={cat}
                                                content={finalTooltip}
                                                side="top"
                                              >
                                                <td
                                                  className={`text-right py-1.5 px-2 ${accountTextColor(cat)}`}
                                                >
                                                  {formatCurrency(
                                                    deflate(total, yr.year),
                                                  )}
                                                  {match > 0 && (
                                                    <span className="text-[9px] text-green-600 align-super ml-px">
                                                      +m
                                                    </span>
                                                  )}
                                                  {getAccountTypeConfig(cat)
                                                    .hasIrsLimit &&
                                                    slot?.cappedByAccount && (
                                                      <Tooltip
                                                        content="Account cap hit"
                                                        side="top"
                                                      >
                                                        <span className="text-amber-500 ml-0.5">
                                                          ^
                                                        </span>
                                                      </Tooltip>
                                                    )}
                                                </td>
                                              </Tooltip>
                                            );
                                          })}
                                        {getAllCategories()
                                          .filter(
                                            (c) =>
                                              ACCOUNT_TYPE_CONFIG[c]
                                                .isOverflowTarget &&
                                              visibleColumns.contribCats.has(c),
                                          )
                                          .map((ofCat) => {
                                            const bSlot = slotMap.get(ofCat);
                                            const ofSpecs =
                                              contribSpecs?.filter(
                                                (s) => s.category === ofCat,
                                              ) ?? [];
                                            const ofLabel =
                                              getAccountTypeConfig(
                                                ofCat,
                                              ).displayLabel;
                                            const ofRawMatch =
                                              bSlot?.employerMatch ?? 0;
                                            const ofContrib =
                                              pt?.byCategoryContrib[ofCat];
                                            const ofEmp = ofContrib
                                              ? ofContrib.employee
                                              : (bSlot?.employeeContrib ?? 0);
                                            const ofMatch = ofContrib
                                              ? ofContrib.match
                                              : ofRawMatch;
                                            const finalOfTooltip =
                                              bSlot &&
                                              (ofEmp > 0 || ofMatch > 0)
                                                ? (() => {
                                                    const allMatchAnnual =
                                                      ofSpecs.reduce(
                                                        (s, sp) =>
                                                          s +
                                                          (sp.matchAnnual ?? 0),
                                                        0,
                                                      );
                                                    const items: TooltipLineItem[] =
                                                      ofSpecs.length > 0
                                                        ? ofSpecs.map((sp) => {
                                                            const bSpecTotal =
                                                              ofSpecs.reduce(
                                                                (s, s2) =>
                                                                  s +
                                                                  (s2.baseAnnual ||
                                                                    0),
                                                                0,
                                                              );
                                                            const frac =
                                                              specFrac({
                                                                baseAnnual:
                                                                  sp.baseAnnual ||
                                                                  0,
                                                                specTotal:
                                                                  bSpecTotal,
                                                                specCount:
                                                                  ofSpecs.length,
                                                              });
                                                            const label =
                                                              sp.ownerName
                                                                ? `${sp.ownerName} (${sp.name})`
                                                                : sp.name;
                                                            const personOf =
                                                              ofEmp * frac;
                                                            const mFrac =
                                                              matchFracOf({
                                                                matchAnnual:
                                                                  sp.matchAnnual ??
                                                                  0,
                                                                allMatchAnnual,
                                                              });
                                                            const spMatch =
                                                              ofRawMatch *
                                                              mFrac;
                                                            return {
                                                              label,
                                                              amount: deflate(
                                                                personOf,
                                                                yr.year,
                                                              ),
                                                              match:
                                                                spMatch > 0
                                                                  ? deflate(
                                                                      spMatch,
                                                                      yr.year,
                                                                    )
                                                                  : undefined,
                                                              matchLabel:
                                                                getDisplayConfig(
                                                                  ofCat,
                                                                  sp.name !==
                                                                    ofCat
                                                                    ? sp.name
                                                                    : undefined,
                                                                )
                                                                  .employerMatchLabel,
                                                            };
                                                          })
                                                        : [
                                                            {
                                                              label: "Employee",
                                                              amount: deflate(
                                                                ofEmp,
                                                                yr.year,
                                                              ),
                                                              match:
                                                                ofMatch > 0
                                                                  ? deflate(
                                                                      ofMatch,
                                                                      yr.year,
                                                                    )
                                                                  : undefined,
                                                              matchLabel:
                                                                getDisplayConfig(
                                                                  ofCat,
                                                                )
                                                                  .employerMatchLabel,
                                                            },
                                                          ];
                                                    const ofAnnual =
                                                      ofSpecs.reduce(
                                                        (s, sp) =>
                                                          s +
                                                          (sp.baseAnnual || 0),
                                                        0,
                                                      );
                                                    return renderTooltip({
                                                      kind: "money",
                                                      header: `${ofLabel} Contributions`,
                                                      items,
                                                      rateCeiling:
                                                        yr.rateCeilingScale !=
                                                          null &&
                                                        yr.rateCeilingScale < 1
                                                          ? {
                                                              uncapped: deflate(
                                                                bSlot.employeeContrib /
                                                                  yr.rateCeilingScale,
                                                                yr.year,
                                                              ),
                                                              capped: deflate(
                                                                bSlot.employeeContrib,
                                                                yr.year,
                                                              ),
                                                              pct:
                                                                1 -
                                                                yr.rateCeilingScale,
                                                            }
                                                          : undefined,
                                                      proRate:
                                                        yr.proRateFraction !=
                                                          null && ofAnnual > 0
                                                          ? {
                                                              months:
                                                                proRateMonths(
                                                                  yr.proRateFraction,
                                                                ),
                                                              annualAmount:
                                                                deflate(
                                                                  ofAnnual,
                                                                  yr.year,
                                                                ),
                                                              proRatedAmount:
                                                                deflate(
                                                                  ofEmp,
                                                                  yr.year,
                                                                ),
                                                            }
                                                          : undefined,
                                                    });
                                                  })()
                                                : undefined;
                                            return (
                                              <Tooltip
                                                key={ofCat}
                                                content={finalOfTooltip}
                                                side="top"
                                              >
                                                <td
                                                  className={`text-right py-1.5 px-2 ${accountTextColor(ofCat)}${yr.overflowToBrokerage > 0 ? " font-medium" : ""}`}
                                                >
                                                  {(bSlot?.employeeContrib ??
                                                    0) > 0
                                                    ? formatCurrency(
                                                        deflate(
                                                          pt?.byCategoryContrib[
                                                            ofCat
                                                          ]?.employee ??
                                                            bSlot!
                                                              .employeeContrib,
                                                          yr.year,
                                                        ),
                                                      )
                                                    : "---"}
                                                </td>
                                              </Tooltip>
                                            );
                                          })}
                                      </>
                                    ) : (
                                      /* Contribution columns by tax type */
                                      (
                                        [
                                          "preTax",
                                          "taxFree",
                                          "hsa",
                                          "afterTax",
                                        ] as const
                                      )
                                        .filter((t) =>
                                          visibleColumns.contribTaxTypes.has(t),
                                        )
                                        .map((bucket) => {
                                          // Build per-spec items for this tax bucket
                                          let bucketTotal = 0;
                                          let bucketMatch = 0;
                                          let bucketAssocMatch = 0;
                                          const items: TooltipLineItem[] = [];
                                          for (const slot of yr.slots) {
                                            const cat = slot.category;
                                            const allCatSpecs =
                                              contribSpecs?.filter(
                                                (s) => s.category === cat,
                                              ) ?? [];
                                            const allMatchAnnual =
                                              allCatSpecs.reduce(
                                                (s, sp) =>
                                                  s + (sp.matchAnnual ?? 0),
                                                0,
                                              );
                                            // Determine which specs and slot amounts apply to this bucket (data-driven via bucketSlotMap)
                                            const slotEmp = slotBucketContrib(
                                              slot,
                                              bucket,
                                            );
                                            const bucketSpecs =
                                              filterSpecsForBucket(
                                                allCatSpecs,
                                                bucket,
                                              );
                                            const isAssoc =
                                              bucketSlotMap[bucket]
                                                ?.matchIsAssociated ?? false;
                                            if (
                                              slotEmp === 0 &&
                                              slot.employerMatch === 0
                                            )
                                              continue;
                                            if (bucketSpecs.length === 0)
                                              continue;
                                            // Distribute slot amounts proportionally across specs
                                            const specBaseTotal =
                                              bucketSpecs.reduce(
                                                (s, sp) =>
                                                  s + (sp.baseAnnual || 0),
                                                0,
                                              );
                                            const catLabel =
                                              catDisplayLabel[cat] ?? cat;
                                            for (const sp of bucketSpecs) {
                                              if (
                                                isPersonFiltered &&
                                                sp.personId !== personFilter
                                              )
                                                continue;
                                              const frac = specFrac({
                                                baseAnnual: sp.baseAnnual || 0,
                                                specTotal: specBaseTotal,
                                                specCount: bucketSpecs.length,
                                              });
                                              const emp = slotEmp * frac;
                                              const mFrac = matchFracOf({
                                                matchAnnual:
                                                  sp.matchAnnual ?? 0,
                                                allMatchAnnual,
                                              });
                                              let mtch = 0;
                                              let assocMtch = 0;
                                              if (isAssoc) {
                                                assocMtch =
                                                  slot.employerMatch * mFrac;
                                              } else {
                                                mtch =
                                                  slot.employerMatch * mFrac;
                                              }
                                              if (
                                                emp > 0 ||
                                                mtch > 0 ||
                                                assocMtch > 0
                                              ) {
                                                items.push({
                                                  label: sp.ownerName
                                                    ? `${sp.ownerName} ${catLabel}`
                                                    : catLabel,
                                                  amount: deflate(emp, yr.year),
                                                  taxType: itemTaxType(
                                                    cat,
                                                    sp.taxTreatment,
                                                  ),
                                                  match:
                                                    mtch > 0
                                                      ? deflate(mtch, yr.year)
                                                      : undefined,
                                                  matchLabel: getDisplayConfig(
                                                    cat,
                                                    sp.name !== cat
                                                      ? sp.name
                                                      : undefined,
                                                  ).employerMatchLabel,
                                                  associatedMatch:
                                                    assocMtch > 0
                                                      ? deflate(
                                                          assocMtch,
                                                          yr.year,
                                                        )
                                                      : undefined,
                                                });
                                                bucketTotal += emp;
                                                bucketMatch += mtch;
                                                bucketAssocMatch += assocMtch;
                                              }
                                            }
                                          }
                                          const total =
                                            bucketTotal + bucketMatch;
                                          // Compute annual (full-year) amount from specs for this bucket (data-driven)
                                          let bucketAnnual = 0;
                                          const bMap = bucketSlotMap[bucket];
                                          for (const slot of yr.slots) {
                                            // Skip slots that don't contribute to this bucket
                                            if (
                                              bMap?.categoryFilter &&
                                              slot.category !==
                                                bMap.categoryFilter
                                            )
                                              continue;
                                            if (
                                              !bMap?.categoryFilter &&
                                              _singleBucketCategories.has(
                                                slot.category,
                                              )
                                            )
                                              continue;
                                            const catSpAll =
                                              contribSpecs?.filter(
                                                (s) =>
                                                  s.category === slot.category,
                                              ) ?? [];
                                            const filtered =
                                              filterSpecsForBucket(
                                                catSpAll,
                                                bucket,
                                              );
                                            bucketAnnual += filtered.reduce(
                                              (s, sp) =>
                                                s + (sp.baseAnnual || 0),
                                              0,
                                            );
                                          }
                                          return (
                                            <Tooltip
                                              key={bucket}
                                              content={
                                                items.length > 0
                                                  ? (() => {
                                                      return renderTooltip({
                                                        kind: "money",
                                                        header: `${taxTypeLabel(bucket)} Contributions`,
                                                        items,
                                                        total:
                                                          items.length > 1
                                                            ? {
                                                                label: "Total",
                                                                amount: deflate(
                                                                  bucketTotal,
                                                                  yr.year,
                                                                ),
                                                                match:
                                                                  bucketMatch +
                                                                    bucketAssocMatch >
                                                                  0
                                                                    ? deflate(
                                                                        bucketMatch +
                                                                          bucketAssocMatch,
                                                                        yr.year,
                                                                      )
                                                                    : undefined,
                                                              }
                                                            : undefined,
                                                        routingNote:
                                                          bucketAssocMatch > 0
                                                            ? `Match flows to ${taxTypeLabel("preTax")}`
                                                            : undefined,
                                                        proRate:
                                                          yr.proRateFraction !=
                                                            null &&
                                                          bucketAnnual > 0
                                                            ? {
                                                                months:
                                                                  proRateMonths(
                                                                    yr.proRateFraction,
                                                                  ),
                                                                annualAmount:
                                                                  deflate(
                                                                    bucketAnnual,
                                                                    yr.year,
                                                                  ),
                                                                proRatedAmount:
                                                                  deflate(
                                                                    bucketTotal,
                                                                    yr.year,
                                                                  ),
                                                              }
                                                            : undefined,
                                                      });
                                                    })()
                                                  : undefined
                                              }
                                              side="top"
                                            >
                                              <td
                                                className={`text-right py-1.5 px-2 ${taxTypeTextColor(bucket)}`}
                                              >
                                                {total > 0
                                                  ? formatCurrency(
                                                      deflate(total, yr.year),
                                                    )
                                                  : "---"}
                                                {(bucketMatch > 0 ||
                                                  bucketAssocMatch > 0) && (
                                                  <span className="text-[9px] text-green-600 align-super ml-px">
                                                    +m
                                                  </span>
                                                )}
                                              </td>
                                            </Tooltip>
                                          );
                                        })
                                    )}
                                    <Tooltip
                                      content={(() => {
                                        const iabs =
                                          yr.individualAccountBalances ?? [];
                                        const totalGrowth = (
                                          pt
                                            ? iabs.filter(
                                                (ia) =>
                                                  ia.ownerPersonId ===
                                                  personFilter,
                                              )
                                            : iabs
                                        ).reduce((s, ia) => s + ia.growth, 0);
                                        const accBudgetProfile =
                                          accumulationBudgetProfileId != null
                                            ? budgetProfileSummaries?.find(
                                                (p) =>
                                                  p.id ===
                                                  accumulationBudgetProfileId,
                                              )
                                            : undefined;
                                        const mine = pt
                                          ? iabs.filter(
                                              (ia) =>
                                                ia.ownerPersonId ===
                                                personFilter,
                                            )
                                          : [];
                                        const empAmount = deflate(
                                          pt
                                            ? pt.contribution
                                            : yr.totalEmployee,
                                          yr.year,
                                        );
                                        const matchAmount = pt
                                          ? deflate(
                                              mine.reduce(
                                                (s, ia) => s + ia.employerMatch,
                                                0,
                                              ),
                                              yr.year,
                                            )
                                          : yr.totalEmployer > 0
                                            ? deflate(yr.totalEmployer, yr.year)
                                            : 0;
                                        const budgetProfileName =
                                          accumulationExpenseOverride != null
                                            ? `Manual override${yr.hasBudgetOverride && budgetOverrideNotes ? ` (${budgetOverrideNotes})` : ""}`
                                            : accBudgetProfile
                                              ? `${accBudgetProfile.name}${accumulationBudgetColumn != null && accBudgetProfile.columnLabels[accumulationBudgetColumn] ? ` (${accBudgetProfile.columnLabels[accumulationBudgetColumn]})` : ""}${yr.hasBudgetOverride && budgetOverrideNotes ? ` (${budgetOverrideNotes})` : ""}`
                                              : undefined;
                                        // Build per-bucket items from slots (shows all tax types that have contributions)
                                        const inOutItems: TooltipLineItem[] =
                                          [];
                                        if (matchAmount > 0)
                                          inOutItems.push({
                                            label: "Match",
                                            amount: matchAmount,
                                            color: "green",
                                          });
                                        if (!pt) {
                                          const bucketTotals: {
                                            label: string;
                                            amount: number;
                                            color: TipColor;
                                          }[] = [];
                                          if (yr.totalTraditional > 0)
                                            bucketTotals.push({
                                              label: taxTypeLabel("preTax"),
                                              amount: deflate(
                                                yr.totalTraditional,
                                                yr.year,
                                              ),
                                              color: "blue",
                                            });
                                          if (yr.totalRoth > 0)
                                            bucketTotals.push({
                                              label: taxTypeLabel("taxFree"),
                                              amount: deflate(
                                                yr.totalRoth,
                                                yr.year,
                                              ),
                                              color: "violet",
                                            });
                                          // Single-bucket categories (HSA, brokerage, etc.)
                                          for (const sbCat of getAllCategories().filter(
                                            (c) =>
                                              !ACCOUNT_TYPE_CONFIG[c]
                                                .supportsRothSplit,
                                          )) {
                                            const sbSlot = yr.slots.find(
                                              (s) => s.category === sbCat,
                                            );
                                            if (
                                              sbSlot &&
                                              sbSlot.employeeContrib > 0
                                            ) {
                                              bucketTotals.push({
                                                label:
                                                  getAccountTypeConfig(sbCat)
                                                    .displayLabel,
                                                amount: deflate(
                                                  sbSlot.employeeContrib,
                                                  yr.year,
                                                ),
                                                color:
                                                  sbCat ===
                                                  getAllCategories().find(
                                                    (c) =>
                                                      ACCOUNT_TYPE_CONFIG[c]
                                                        .isOverflowTarget,
                                                  )
                                                    ? "amber"
                                                    : "emerald",
                                              });
                                            }
                                          }
                                          inOutItems.push(...bucketTotals);
                                        } else {
                                          // Person-filtered: build tax-type breakdown from individual accounts
                                          const bucketTotals: {
                                            label: string;
                                            amount: number;
                                            color: TipColor;
                                          }[] = [];
                                          let ptTrad = 0,
                                            ptRoth = 0;
                                          const ptSingleBucket = new Map<
                                            string,
                                            number
                                          >();
                                          for (const ia of mine) {
                                            const cfg =
                                              ACCOUNT_TYPE_CONFIG[ia.category];
                                            if (cfg?.supportsRothSplit) {
                                              if (ia.taxType === "preTax")
                                                ptTrad += ia.contribution;
                                              else ptRoth += ia.contribution;
                                            } else {
                                              ptSingleBucket.set(
                                                ia.category,
                                                (ptSingleBucket.get(
                                                  ia.category,
                                                ) ?? 0) + ia.contribution,
                                              );
                                            }
                                          }
                                          if (ptTrad > 0)
                                            bucketTotals.push({
                                              label: taxTypeLabel("preTax"),
                                              amount: deflate(ptTrad, yr.year),
                                              color: "blue",
                                            });
                                          if (ptRoth > 0)
                                            bucketTotals.push({
                                              label: taxTypeLabel("taxFree"),
                                              amount: deflate(ptRoth, yr.year),
                                              color: "violet",
                                            });
                                          Array.from(
                                            ptSingleBucket.entries(),
                                          ).forEach(([sbCat, sbAmt]) => {
                                            if (sbAmt > 0) {
                                              const cfg = getAccountTypeConfig(
                                                sbCat as AccountCategory,
                                              );
                                              bucketTotals.push({
                                                label: cfg.displayLabel,
                                                amount: deflate(sbAmt, yr.year),
                                                color: cfg.isOverflowTarget
                                                  ? "amber"
                                                  : "emerald",
                                              });
                                            }
                                          });
                                          inOutItems.push(...bucketTotals);
                                        }
                                        return renderTooltip({
                                          kind: "money",
                                          header: `${isPersonFiltered ? personFilterName : "Employee"}: ${formatCurrency(empAmount)}`,
                                          items:
                                            inOutItems.length > 0
                                              ? inOutItems
                                              : undefined,
                                          growth:
                                            Math.abs(totalGrowth) > 1
                                              ? {
                                                  amount: deflate(
                                                    totalGrowth,
                                                    yr.year,
                                                  ),
                                                }
                                              : undefined,
                                          budget: budgetProfileName
                                            ? {
                                                profile: budgetProfileName,
                                                amount: deflate(
                                                  yr.projectedExpenses,
                                                  yr.year,
                                                ),
                                              }
                                            : undefined,
                                          overrideNote:
                                            accumOverrideNotes &&
                                            !accumOverrides.some(
                                              (o) =>
                                                o.year === yr.year &&
                                                o.contributionRate !==
                                                  undefined,
                                            )
                                              ? `Override: ${accumOverrideNotes}`
                                              : undefined,
                                          proRate:
                                            yr.proRateFraction != null
                                              ? (() => {
                                                  const totalAnnual =
                                                    contribSpecs?.reduce(
                                                      (s, sp) =>
                                                        s +
                                                        (sp.baseAnnual || 0),
                                                      0,
                                                    ) ?? 0;
                                                  return totalAnnual > 0
                                                    ? {
                                                        months: proRateMonths(
                                                          yr.proRateFraction,
                                                        ),
                                                        annualAmount: deflate(
                                                          totalAnnual,
                                                          yr.year,
                                                        ),
                                                        proRatedAmount:
                                                          empAmount,
                                                      }
                                                    : undefined;
                                                })()
                                              : undefined,
                                        });
                                      })()}
                                      side="top"
                                    >
                                      <td className="text-right py-1.5 px-2 font-medium">
                                        {formatCurrency(
                                          deflate(
                                            pt
                                              ? pt.contribution
                                              : yr.totalEmployee +
                                                  yr.totalEmployer,
                                            yr.year,
                                          ),
                                        )}
                                        {yr.totalEmployer > 0 && (
                                          <span className="text-[9px] text-green-600 align-super ml-px">
                                            +m
                                          </span>
                                        )}
                                      </td>
                                    </Tooltip>
                                    {balanceView === "taxType" ? (
                                      (
                                        [
                                          "preTax",
                                          "taxFree",
                                          "hsa",
                                          "afterTax",
                                        ] as const
                                      )
                                        .filter((t) =>
                                          visibleColumns.balanceTaxTypes.has(t),
                                        )
                                        .map((bucket) => {
                                          const bal = pt
                                            ? pt.byTaxType[bucket]
                                            : yr.balanceByTaxType[bucket];
                                          const totalBal = pt
                                            ? pt.balance
                                            : yr.endBalance;
                                          const pct = pctOf(bal, totalBal);
                                          // Compute authoritative total change from engine's year-over-year balance
                                          const prevYr =
                                            result.projectionByYear.find(
                                              (y) => y.year === yr.year - 1,
                                            );
                                          const prevPt = prevYr
                                            ? getPersonYearTotals(prevYr)
                                            : null;
                                          const prevBucketBal = prevYr
                                            ? prevPt
                                              ? prevPt.byTaxType[bucket]
                                              : prevYr.balanceByTaxType[bucket]
                                            : 0;
                                          // Compute splitContrib from authoritative slot data (mirrors engine balance routing)
                                          const splitContrib =
                                            slotsBucketBalanceInflow(
                                              yr.slots,
                                              bucket,
                                            );
                                          // Build per-account items from individual account balances (for balance/growth detail)
                                          const bucketAccts = (
                                            yr.individualAccountBalances ?? []
                                          ).filter(
                                            (ia) =>
                                              iaBelongsToBucket(ia, bucket) &&
                                              (!isPersonFiltered ||
                                                ia.ownerPersonId ===
                                                  personFilter),
                                          );
                                          const {
                                            splits: bucketSplits,
                                            splitGrowth,
                                          } = computeAccountSplits(bucketAccts);
                                          const acctItems: TooltipLineItem[] =
                                            bucketSplits.map((sp) => {
                                              const subItems: TooltipLineItem[] =
                                                [];
                                              if (sp.contribution > 1)
                                                subItems.push({
                                                  label: "contrib",
                                                  amount: deflate(
                                                    sp.contribution,
                                                    yr.year,
                                                  ),
                                                  prefix: "+",
                                                  color: "green",
                                                });
                                              if (Math.abs(sp.growth) > 1)
                                                subItems.push({
                                                  label: "growth",
                                                  amount: deflate(
                                                    sp.growth,
                                                    yr.year,
                                                  ),
                                                  prefix:
                                                    sp.growth >= 0
                                                      ? "+"
                                                      : undefined,
                                                  color:
                                                    sp.growth >= 0
                                                      ? "blue"
                                                      : "red",
                                                });
                                              return {
                                                label: sp.name,
                                                amount: deflate(
                                                  sp.balance,
                                                  yr.year,
                                                ),
                                                taxType: itemTaxType(
                                                  sp.category,
                                                  sp.taxType,
                                                ),
                                                sub:
                                                  subItems.length > 0
                                                    ? subItems
                                                    : undefined,
                                              };
                                            });
                                          const deflatedBal = deflate(
                                            bal,
                                            yr.year,
                                          );
                                          const {
                                            displayChange,
                                            displayContrib,
                                            displayGrowth,
                                            boyBal,
                                          } = computeColumnChange({
                                            deflate,
                                            bal,
                                            year: yr.year,
                                            prev: prevYr
                                              ? {
                                                  bal: prevBucketBal,
                                                  year: prevYr.year,
                                                }
                                              : null,
                                            splitContrib,
                                            splitGrowth,
                                          });
                                          const changeParts: {
                                            label: string;
                                            amount: number;
                                            color: TipColor;
                                          }[] = [];
                                          if (displayContrib > 0)
                                            changeParts.push({
                                              label: "contrib",
                                              amount: displayContrib,
                                              color: "green",
                                            });
                                          if (Math.abs(displayGrowth) > 1)
                                            changeParts.push({
                                              label: "growth",
                                              amount: displayGrowth,
                                              color:
                                                displayGrowth >= 0
                                                  ? "blue"
                                                  : "red",
                                            });
                                          const tooltipContent =
                                            acctItems.length > 0
                                              ? renderTooltip({
                                                  kind: "money",
                                                  header: `${taxTypeLabel(bucket)}: ${pct}% of portfolio`,
                                                  meta: `${yr.year} · ${formatPercent(yr.returnRate, 1)} return${yr.proRateFraction != null && yr.proRateFraction > 0 ? ` (${formatPercent(yr.annualizedReturnRate, 1)} annual)` : ""}`,
                                                  meta2: `BoY: ${formatCurrency(boyBal)} → EoY: ${formatCurrency(deflatedBal)}`,
                                                  items: acctItems,
                                                  yearChange: {
                                                    total: deflatedBal,
                                                    change: displayChange,
                                                    parts:
                                                      changeParts.length > 0
                                                        ? changeParts
                                                        : undefined,
                                                  },
                                                  proRate:
                                                    yr.proRateFraction !=
                                                      null &&
                                                    yr.proRateFraction > 0
                                                      ? {
                                                          months: proRateMonths(
                                                            yr.proRateFraction,
                                                          ),
                                                          annualAmount: deflate(
                                                            safeDivide(
                                                              splitContrib,
                                                              yr.proRateFraction,
                                                            ),
                                                            yr.year,
                                                          ),
                                                          proRatedAmount:
                                                            deflate(
                                                              splitContrib,
                                                              yr.year,
                                                            ),
                                                        }
                                                      : undefined,
                                                  legend: [
                                                    {
                                                      label:
                                                        "Green = contributions",
                                                      color: "green",
                                                    },
                                                    {
                                                      label: "Blue = growth",
                                                      color: "blue",
                                                    },
                                                  ],
                                                })
                                              : undefined;
                                          return (
                                            <Tooltip
                                              key={bucket}
                                              content={tooltipContent}
                                              side="top"
                                            >
                                              <td
                                                className={`text-right py-1.5 px-2 ${taxTypeTextColor(bucket)}`}
                                              >
                                                {formatCurrency(
                                                  deflate(bal, yr.year),
                                                )}
                                              </td>
                                            </Tooltip>
                                          );
                                        })
                                    ) : (
                                      <>
                                        {getAccountSegments()
                                          .map((seg) => ({
                                            key: seg.key,
                                            val: getSegmentBalance(
                                              yr.balanceByAccount,
                                              seg,
                                            ),
                                            color: accountTextColor(
                                              seg.category,
                                            ),
                                            label: seg.label,
                                          }))
                                          .filter((col) =>
                                            visibleColumns.balanceAccts.has(
                                              col.key,
                                            ),
                                          )
                                          .map((col) => {
                                            const catKey = colKeyParts(
                                              col.key,
                                            ).category;
                                            const bal = pt
                                              ? (pt.byAccount[col.key] ?? 0)
                                              : col.val;
                                            const totalBal = pt
                                              ? pt.balance
                                              : yr.endBalance;
                                            const pct = pctOf(bal, totalBal);
                                            // Filter by the exact taxType this column represents
                                            const colTaxType = colEngineTaxType(
                                              col.key,
                                            );
                                            // Use engine's individualAccountBalances — includes all accounts
                                            // (not just snapshot), so contributions to new tax types appear.
                                            const colIabs = (
                                              yr.individualAccountBalances ?? []
                                            ).filter(
                                              (ia) =>
                                                ia.category === catKey &&
                                                (colTaxType == null ||
                                                  ia.taxType === colTaxType) &&
                                                (!isPersonFiltered ||
                                                  ia.ownerPersonId ===
                                                    personFilter),
                                            );
                                            // Get previous year's value for this column from the engine
                                            const colPrevYr =
                                              result.projectionByYear.find(
                                                (y) => y.year === yr.year - 1,
                                              );
                                            const colPrevPt = colPrevYr
                                              ? getPersonYearTotals(colPrevYr)
                                              : null;
                                            const colPrevVal = colPrevYr
                                              ? colPrevPt
                                                ? (colPrevPt.byAccount[
                                                    col.key
                                                  ] ?? 0)
                                                : colBalance(
                                                    colPrevYr.balanceByAccount,
                                                    col.key,
                                                  )
                                              : 0;
                                            // splitContrib from authoritative slot data (mirrors engine balance routing)
                                            const colSplitContrib =
                                              slotsColumnBalanceInflow(
                                                yr.slots,
                                                col.key,
                                              );
                                            // Per-account splits for balance/growth detail
                                            const {
                                              splits,
                                              splitGrowth: colSplitGrowth,
                                            } = computeAccountSplits(colIabs);
                                            const colSplitsTotal =
                                              splits.reduce(
                                                (s, sp) => s + sp.balance,
                                                0,
                                              );
                                            // Total change = difference of deflated balances (matches table rows)
                                            const {
                                              displayChange: colDisplayChange,
                                              displayContrib: colDisplayContrib,
                                              displayGrowth: colDisplayGrowth,
                                              boyBal: colBoyBal,
                                            } = computeColumnChange({
                                              deflate,
                                              bal,
                                              year: yr.year,
                                              prev: colPrevYr
                                                ? {
                                                    bal: colPrevVal,
                                                    year: colPrevYr.year,
                                                  }
                                                : null,
                                              splitContrib: colSplitContrib,
                                              splitGrowth: colSplitGrowth,
                                            });
                                            const colDeflatedBal = deflate(
                                              bal,
                                              yr.year,
                                            );
                                            const tooltipContent =
                                              splits.length > 0
                                                ? (() => {
                                                    const colChangeParts: {
                                                      label: string;
                                                      amount: number;
                                                      color: TipColor;
                                                    }[] = [];
                                                    if (colDisplayContrib > 0)
                                                      colChangeParts.push({
                                                        label: "contrib",
                                                        amount:
                                                          colDisplayContrib,
                                                        color: "green",
                                                      });
                                                    if (
                                                      Math.abs(
                                                        colDisplayGrowth,
                                                      ) > 1
                                                    )
                                                      colChangeParts.push({
                                                        label: "growth",
                                                        amount:
                                                          colDisplayGrowth,
                                                        color:
                                                          colDisplayGrowth >= 0
                                                            ? "blue"
                                                            : "red",
                                                      });
                                                    const splitItems: TooltipLineItem[] =
                                                      splits.map(
                                                        ({
                                                          name: acctName,
                                                          taxType: spTaxType,
                                                          balance: spBal,
                                                          contribution:
                                                            spContrib,
                                                          growth: spGrowth,
                                                        }) => {
                                                          const entryPct =
                                                            pctOf(
                                                              spBal,
                                                              colSplitsTotal,
                                                            );
                                                          const subItems: TooltipLineItem[] =
                                                            [];
                                                          if (spContrib > 1)
                                                            subItems.push({
                                                              label: "contrib",
                                                              amount: deflate(
                                                                spContrib,
                                                                yr.year,
                                                              ),
                                                              prefix: "+",
                                                              color: "green",
                                                            });
                                                          if (
                                                            Math.abs(spGrowth) >
                                                            1
                                                          )
                                                            subItems.push({
                                                              label: "growth",
                                                              amount: deflate(
                                                                spGrowth,
                                                                yr.year,
                                                              ),
                                                              prefix:
                                                                spGrowth >= 0
                                                                  ? "+"
                                                                  : undefined,
                                                              color:
                                                                spGrowth >= 0
                                                                  ? "blue"
                                                                  : "red",
                                                            });
                                                          return {
                                                            label: acctName,
                                                            amount: deflate(
                                                              spBal,
                                                              yr.year,
                                                            ),
                                                            pct: entryPct,
                                                            taxType:
                                                              itemTaxType(
                                                                catKey,
                                                                spTaxType,
                                                              ),
                                                            sub:
                                                              subItems.length >
                                                              0
                                                                ? subItems
                                                                : undefined,
                                                          };
                                                        },
                                                      );
                                                    return renderTooltip({
                                                      kind: "money",
                                                      header: `${col.label}: ${pct}% of portfolio`,
                                                      meta: `${yr.year} · BoY: ${formatCurrency(colBoyBal)} → EoY: ${formatCurrency(colDeflatedBal)} · ${formatPercent(yr.returnRate, 1)} return${yr.proRateFraction != null && yr.proRateFraction > 0 ? ` (${formatPercent(yr.annualizedReturnRate, 1)} annual)` : ""}`,
                                                      items: splitItems,
                                                      yearChange: {
                                                        total: colDeflatedBal,
                                                        change:
                                                          colDisplayChange,
                                                        parts:
                                                          colChangeParts.length >
                                                          0
                                                            ? colChangeParts
                                                            : undefined,
                                                      },
                                                      legend: [
                                                        {
                                                          label:
                                                            "Green = contributions",
                                                          color: "green",
                                                        },
                                                        {
                                                          label:
                                                            "Blue = growth",
                                                          color: "blue",
                                                        },
                                                      ],
                                                    });
                                                  })()
                                                : undefined;
                                            return (
                                              <Tooltip
                                                key={col.key}
                                                content={tooltipContent}
                                                side="top"
                                              >
                                                <td
                                                  className={`text-right py-1.5 px-2 ${col.color}`}
                                                >
                                                  {formatCurrency(
                                                    deflate(bal, yr.year),
                                                  )}
                                                </td>
                                              </Tooltip>
                                            );
                                          })}
                                      </>
                                    )}
                                    <Tooltip
                                      content={
                                        yr.endBalance > 0
                                          ? (() => {
                                              const ptBal = pt
                                                ? pt.balance
                                                : yr.endBalance;
                                              const items: TooltipLineItem[] = (
                                                [
                                                  "preTax",
                                                  "taxFree",
                                                  "hsa",
                                                  "afterTax",
                                                ] as const
                                              ).map((b) => {
                                                const bVal = pt
                                                  ? pt.byTaxType[b]
                                                  : yr.balanceByTaxType[b];
                                                return {
                                                  label: taxTypeLabel(b),
                                                  amount: deflate(
                                                    bVal,
                                                    yr.year,
                                                  ),
                                                  pct: pctOf(bVal, ptBal),
                                                };
                                              });
                                              return renderTooltip({
                                                kind: "money",
                                                header: "Portfolio Balance",
                                                items,
                                                proRate:
                                                  yr.proRateFraction != null
                                                    ? (() => {
                                                        const totalAnnual =
                                                          contribSpecs?.reduce(
                                                            (s, sp) =>
                                                              s +
                                                              (sp.baseAnnual ||
                                                                0),
                                                            0,
                                                          ) ?? 0;
                                                        return totalAnnual > 0
                                                          ? {
                                                              months:
                                                                proRateMonths(
                                                                  yr.proRateFraction,
                                                                ),
                                                              annualAmount:
                                                                deflate(
                                                                  totalAnnual,
                                                                  yr.year,
                                                                ),
                                                              proRatedAmount:
                                                                deflate(
                                                                  yr.totalEmployee,
                                                                  yr.year,
                                                                ),
                                                            }
                                                          : undefined;
                                                      })()
                                                    : undefined,
                                              });
                                            })()
                                          : undefined
                                      }
                                      side="top"
                                    >
                                      <td className="text-right py-1.5 px-2 font-semibold">
                                        {formatCurrency(
                                          deflate(
                                            pt ? pt.balance : yr.endBalance,
                                            yr.year,
                                          ),
                                        )}
                                      </td>
                                    </Tooltip>
                                    {renderMcCell(
                                      yr,
                                      deflate(
                                        pt ? pt.balance : yr.endBalance,
                                        yr.year,
                                      ),
                                    )}
                                    <td className="py-1.5 pl-2 text-[10px] text-faint whitespace-nowrap border-l border-subtle">
                                      {yr.proRateFraction != null && (
                                        <Tooltip
                                          content={`Partial year — only ${proRateMonths(yr.proRateFraction)} months remain. All dollar values in this row show what's left for the year, not a full 12-month amount.`}
                                          side="left"
                                          maxWidth={240}
                                        >
                                          <span className="text-blue-500">
                                            {proRateMonths(yr.proRateFraction)}
                                            /12 mo remaining
                                          </span>
                                        </Tooltip>
                                      )}
                                      {yr.overflowToBrokerage > 0 && (
                                        <Tooltip
                                          content={`Contributions exceeded tax-advantaged limits by ${formatCurrency(deflate(yr.overflowToBrokerage, yr.year))} — excess routed to brokerage`}
                                          side="left"
                                          maxWidth={240}
                                        >
                                          <span className="text-amber-600">
                                            ↗{""}
                                            {formatCurrency(
                                              deflate(
                                                yr.overflowToBrokerage,
                                                yr.year,
                                              ),
                                            )}
                                            {""}
                                            overflow
                                          </span>
                                        </Tooltip>
                                      )}
                                      {yr.warnings.length > 0 && (
                                        <Tooltip
                                          content={renderTooltip({
                                            kind: "info",
                                            lines: yr.warnings.map((w) => ({
                                              text: w,
                                              style: "note" as const,
                                            })),
                                          })}
                                          side="left"
                                        >
                                          <span className="text-amber-500 ml-1">
                                            {yr.warnings.length} warning
                                            {yr.warnings.length > 1 ? "s" : ""}
                                          </span>
                                        </Tooltip>
                                      )}
                                    </td>
                                  </tr>
                                );
                              }

                              // Decumulation year
                              const dyr = yr as EngineDecumulationYear;
                              const dSlotMap = new Map<
                                AccountCategory,
                                DecumulationSlot
                              >(dyr.slots.map((s) => [s.category, s]));
                              const dpt = getPersonYearTotals(yr); // real per-person data
                              return (
                                <tr
                                  key={yr.year}
                                  className={`border-b border-subtle hover:bg-surface-elevated/60 transition-colors ${
                                    isPhaseTransition
                                      ? "bg-blue-50 font-medium"
                                      : hasOverride
                                        ? "bg-amber-50"
                                        : yr.endBalance < 1
                                          ? "bg-red-50"
                                          : ""
                                  }`}
                                >
                                  <td className="py-1.5 pr-2">{yr.year}</td>
                                  <Tooltip
                                    content={(() => {
                                      const pp = people ?? enginePeople;
                                      if (!pp || pp.length < 2)
                                        return undefined;
                                      return renderTooltip({
                                        kind: "info",
                                        lines: pp.map((p) => ({
                                          text: `${p.name}: ${yr.year - p.birthYear}`,
                                          style: "header" as const,
                                        })),
                                      });
                                    })()}
                                    side="top"
                                  >
                                    <td className="py-1.5 px-2">
                                      {displayAge(yr.year) ?? yr.age}
                                    </td>
                                  </Tooltip>
                                  <td className="py-1.5 px-2">
                                    <span className="text-amber-600 text-[10px] font-medium">
                                      DRAW
                                    </span>
                                  </td>
                                  <Tooltip
                                    content="No salary income during retirement"
                                    side="top"
                                  >
                                    <td className="text-right py-1.5 px-2 text-faint">
                                      ---
                                    </td>
                                  </Tooltip>
                                  <Tooltip
                                    content="No contribution rate during retirement"
                                    side="top"
                                  >
                                    <td className="text-right py-1.5 px-2 text-faint">
                                      ---
                                    </td>
                                  </Tooltip>
                                  {contribView === "account"
                                    ? getAllCategories()
                                        .filter((c) =>
                                          visibleColumns.contribCats.has(c),
                                        )
                                        .map((cat) => {
                                          const dSlot = dSlotMap.get(cat);
                                          const wd = dSlot?.withdrawal ?? 0;
                                          // Get growth from individualAccountBalances for this category
                                          const iabs =
                                            yr.individualAccountBalances ?? [];
                                          const catAccts = dpt
                                            ? iabs.filter(
                                                (ia) =>
                                                  ia.ownerPersonId ===
                                                    personFilter &&
                                                  ia.category === cat,
                                              )
                                            : iabs.filter(
                                                (ia) => ia.category === cat,
                                              );
                                          const catGrowth = catAccts.reduce(
                                            (s, ia) => s + ia.growth,
                                            0,
                                          );
                                          const catBal = catAccts.reduce(
                                            (s, ia) => s + ia.balance,
                                            0,
                                          );
                                          return (
                                            <Tooltip
                                              key={cat}
                                              content={(() => {
                                                const dSlot = dSlotMap.get(cat);
                                                const items: TooltipLineItem[] =
                                                  [];
                                                const catCfg =
                                                  getAccountTypeConfig(cat);
                                                if (
                                                  wd > 0 &&
                                                  catCfg.supportsRothSplit &&
                                                  dSlot &&
                                                  (dSlot.traditionalWithdrawal >
                                                    0 ||
                                                    dSlot.rothWithdrawal > 0)
                                                ) {
                                                  if (
                                                    dSlot.traditionalWithdrawal >
                                                    0
                                                  )
                                                    items.push({
                                                      label:
                                                        catCfg.displayLabel,
                                                      amount: deflate(
                                                        dSlot.traditionalWithdrawal,
                                                        yr.year,
                                                      ),
                                                      prefix: "-",
                                                      taxType: "traditional",
                                                      color: "red",
                                                    });
                                                  if (dSlot.rothWithdrawal > 0)
                                                    items.push({
                                                      label:
                                                        catCfg.displayLabel,
                                                      amount: deflate(
                                                        dSlot.rothWithdrawal,
                                                        yr.year,
                                                      ),
                                                      prefix: "-",
                                                      taxType: "roth",
                                                      color: "red",
                                                    });
                                                }
                                                return renderTooltip({
                                                  kind: "money",
                                                  header: `${catDisplayLabel[cat] ?? cat} Withdrawals`,
                                                  items:
                                                    items.length > 0
                                                      ? items
                                                      : undefined,
                                                  withdrawals:
                                                    wd > 0 && items.length === 0
                                                      ? {
                                                          amount: deflate(
                                                            wd,
                                                            yr.year,
                                                          ),
                                                        }
                                                      : undefined,
                                                  growth:
                                                    Math.abs(catGrowth) > 1
                                                      ? {
                                                          amount: deflate(
                                                            catGrowth,
                                                            yr.year,
                                                          ),
                                                        }
                                                      : undefined,
                                                  balance: deflate(
                                                    catBal,
                                                    yr.year,
                                                  ),
                                                });
                                              })()}
                                              side="top"
                                            >
                                              <td
                                                className={`text-right py-1.5 px-2 ${accountTextColor(cat)}`}
                                              >
                                                {wd > 0
                                                  ? `-${formatCurrency(deflate(wd, yr.year))}`
                                                  : "---"}
                                              </td>
                                            </Tooltip>
                                          );
                                        })
                                    : /* Withdrawal columns by tax type */
                                      (
                                        [
                                          "preTax",
                                          "taxFree",
                                          "hsa",
                                          "afterTax",
                                        ] as const
                                      )
                                        .filter((t) =>
                                          visibleColumns.contribTaxTypes.has(t),
                                        )
                                        .map((bucket) => {
                                          let bucketWd = 0;
                                          const parts: {
                                            cat: string;
                                            wd: number;
                                          }[] = [];
                                          for (const slot of dyr.slots) {
                                            const wd = slotBucketWithdrawal(
                                              slot,
                                              bucket,
                                            );
                                            if (wd > 0) {
                                              parts.push({
                                                cat: slot.category,
                                                wd,
                                              });
                                              bucketWd += wd;
                                            }
                                          }
                                          return (
                                            <Tooltip
                                              key={bucket}
                                              content={
                                                parts.length > 0
                                                  ? (() => {
                                                      const taxPrefCat =
                                                        categoriesWithTaxPreference()[0]!;
                                                      const wdTaxType =
                                                        bucketSlotMap[bucket]
                                                          ?.taxField
                                                          ? itemTaxType(
                                                              taxPrefCat,
                                                              bucketSlotMap[
                                                                bucket
                                                              ]!.taxField,
                                                            )
                                                          : undefined;
                                                      return renderTooltip({
                                                        kind: "money",
                                                        header: `${taxTypeLabel(bucket)} Withdrawals`,
                                                        items: parts.map(
                                                          (p) => ({
                                                            label:
                                                              catDisplayLabel[
                                                                p.cat
                                                              ] ?? p.cat,
                                                            amount: deflate(
                                                              p.wd,
                                                              yr.year,
                                                            ),
                                                            prefix:
                                                              "-" as const,
                                                            taxType:
                                                              itemTaxType(
                                                                p.cat,
                                                                wdTaxType,
                                                              ),
                                                            color:
                                                              "red" as TipColor,
                                                          }),
                                                        ),
                                                        total:
                                                          parts.length > 1
                                                            ? {
                                                                label: "Total",
                                                                amount: deflate(
                                                                  bucketWd,
                                                                  yr.year,
                                                                ),
                                                                prefix: "-",
                                                              }
                                                            : undefined,
                                                      });
                                                    })()
                                                  : undefined
                                              }
                                              side="top"
                                            >
                                              <td
                                                className={`text-right py-1.5 px-2 ${taxTypeTextColor(bucket)}`}
                                              >
                                                {bucketWd > 0
                                                  ? `-${formatCurrency(deflate(bucketWd, yr.year))}`
                                                  : "---"}
                                              </td>
                                            </Tooltip>
                                          );
                                        })}
                                  <Tooltip
                                    content={(() => {
                                      const items: TooltipLineItem[] = [];
                                      if (dyr.totalWithdrawal > 0) {
                                        if (dyr.totalTraditionalWithdrawal > 0)
                                          items.push({
                                            label: taxTypeLabel("preTax"),
                                            amount: deflate(
                                              dyr.totalTraditionalWithdrawal,
                                              yr.year,
                                            ),
                                            prefix: "-",
                                            color: "blue",
                                          });
                                        if (dyr.totalRothWithdrawal > 0)
                                          items.push({
                                            label: taxTypeLabel("taxFree"),
                                            amount: deflate(
                                              dyr.totalRothWithdrawal,
                                              yr.year,
                                            ),
                                            prefix: "-",
                                            color: "violet",
                                          });
                                        for (const sbCat of getAllCategories().filter(
                                          (c) =>
                                            !ACCOUNT_TYPE_CONFIG[c]
                                              .supportsRothSplit,
                                        )) {
                                          const sbWd =
                                            dSlotMap.get(sbCat)?.withdrawal ??
                                            0;
                                          if (sbWd > 0)
                                            items.push({
                                              label:
                                                getAccountTypeConfig(sbCat)
                                                  .displayLabel,
                                              amount: deflate(sbWd, yr.year),
                                              prefix: "-",
                                              color:
                                                sbCat ===
                                                getAllCategories().find(
                                                  (c) =>
                                                    ACCOUNT_TYPE_CONFIG[c]
                                                      .isOverflowTarget,
                                                )
                                                  ? "amber"
                                                  : "emerald",
                                            });
                                        }
                                      }
                                      const iabs =
                                        yr.individualAccountBalances ?? [];
                                      const totalGrowth = (
                                        dpt
                                          ? iabs.filter(
                                              (ia) =>
                                                ia.ownerPersonId ===
                                                personFilter,
                                            )
                                          : iabs
                                      ).reduce((s, ia) => s + ia.growth, 0);
                                      const decBudgetProfile =
                                        decumulationBudgetProfileId != null
                                          ? budgetProfileSummaries?.find(
                                              (p) =>
                                                p.id ===
                                                decumulationBudgetProfileId,
                                            )
                                          : undefined;
                                      const budgetProfileName =
                                        decumulationExpenseOverride != null
                                          ? `Manual override${dyr.hasBudgetOverride && budgetOverrideNotes ? ` (${budgetOverrideNotes})` : ""}`
                                          : decBudgetProfile
                                            ? `${decBudgetProfile.name}${decumulationBudgetColumn != null && decBudgetProfile.columnLabels[decumulationBudgetColumn] ? ` (${decBudgetProfile.columnLabels[decumulationBudgetColumn]})` : ""}${dyr.hasBudgetOverride && budgetOverrideNotes ? ` (${budgetOverrideNotes})` : ""}`
                                            : undefined;
                                      return renderTooltip({
                                        kind: "money",
                                        header: "Total Withdrawals",
                                        items:
                                          items.length > 0 ? items : undefined,
                                        growth:
                                          Math.abs(totalGrowth) > 1
                                            ? {
                                                amount: deflate(
                                                  totalGrowth,
                                                  yr.year,
                                                ),
                                              }
                                            : undefined,
                                        withdrawals:
                                          dyr.taxCost > 0
                                            ? {
                                                amount: deflate(
                                                  dyr.totalWithdrawal,
                                                  yr.year,
                                                ),
                                                taxCost: deflate(
                                                  dyr.taxCost,
                                                  yr.year,
                                                ),
                                              }
                                            : undefined,
                                        budget: budgetProfileName
                                          ? {
                                              profile: budgetProfileName,
                                              amount: deflate(
                                                dyr.projectedExpenses,
                                                yr.year,
                                              ),
                                            }
                                          : undefined,
                                        overrideNote: decumOverrideNotes
                                          ? `Override: ${decumOverrideNotes}`
                                          : undefined,
                                      });
                                    })()}
                                    side="top"
                                  >
                                    <td
                                      className={`text-right py-1.5 px-2 font-medium ${
                                        dyr.totalWithdrawal > 0 &&
                                        dyr.totalWithdrawal <
                                          dyr.targetWithdrawal
                                          ? "text-amber-500"
                                          : dyr.totalWithdrawal > 0
                                            ? "text-red-600"
                                            : dyr.endBalance < 1 &&
                                                dyr.projectedExpenses > 0
                                              ? "text-red-400 italic"
                                              : "text-muted"
                                      }`}
                                    >
                                      {dyr.totalWithdrawal > 0
                                        ? `-${formatCurrency(deflate(dyr.totalWithdrawal, yr.year))}`
                                        : dyr.endBalance < 1 &&
                                            dyr.projectedExpenses > 0
                                          ? "depleted"
                                          : "---"}
                                    </td>
                                  </Tooltip>
                                  {balanceView === "taxType" ? (
                                    (
                                      [
                                        "preTax",
                                        "taxFree",
                                        "hsa",
                                        "afterTax",
                                      ] as const
                                    )
                                      .filter((t) =>
                                        visibleColumns.balanceTaxTypes.has(t),
                                      )
                                      .map((bucket) => {
                                        const bal = dpt
                                          ? dpt.byTaxType[bucket]
                                          : yr.balanceByTaxType[bucket];
                                        const dptTotal = dpt
                                          ? dpt.balance
                                          : yr.endBalance;
                                        const pct = pctOf(bal, dptTotal);
                                        // Compute growth for this tax bucket from individualAccountBalances
                                        const bucketIabs =
                                          yr.individualAccountBalances ?? [];
                                        const bucketAccts = (
                                          dpt
                                            ? bucketIabs.filter(
                                                (ia) =>
                                                  ia.ownerPersonId ===
                                                  personFilter,
                                              )
                                            : bucketIabs
                                        ).filter((ia) =>
                                          iaBelongsToBucket(ia, bucket),
                                        );
                                        const bucketGrowth = bucketAccts.reduce(
                                          (s, ia) => s + ia.growth,
                                          0,
                                        );
                                        return (
                                          <Tooltip
                                            key={bucket}
                                            content={(() => {
                                              const wdLineItems: TooltipLineItem[] =
                                                [];
                                              if (!dpt) {
                                                const bucketTaxField =
                                                  bucketSlotMap[bucket]
                                                    ?.taxField;
                                                for (const slot of dyr.slots) {
                                                  const wd =
                                                    slotBucketWithdrawal(
                                                      slot,
                                                      bucket,
                                                    );
                                                  if (wd > 0) {
                                                    wdLineItems.push({
                                                      label:
                                                        catDisplayLabel[
                                                          slot.category
                                                        ] ?? slot.category,
                                                      amount: deflate(
                                                        wd,
                                                        yr.year,
                                                      ),
                                                      prefix: "-",
                                                      taxType: bucketTaxField
                                                        ? itemTaxType(
                                                            slot.category,
                                                            bucketTaxField,
                                                          )
                                                        : undefined,
                                                      color: "red",
                                                    });
                                                  }
                                                }
                                              } else {
                                                // Person-filtered: show per-account withdrawals from individual account data
                                                for (const ia of bucketAccts) {
                                                  const wd = ia.withdrawal ?? 0;
                                                  if (wd > 0) {
                                                    wdLineItems.push({
                                                      label: ia.name,
                                                      amount: deflate(
                                                        wd,
                                                        yr.year,
                                                      ),
                                                      prefix: "-",
                                                      color: "red",
                                                    });
                                                  }
                                                }
                                              }
                                              return renderTooltip({
                                                kind: "money",
                                                header: `${taxTypeLabel(bucket)}: ${pct}% of portfolio`,
                                                meta: `${yr.year} · ${formatPercent(yr.returnRate, 1)} return`,
                                                items:
                                                  wdLineItems.length > 0
                                                    ? wdLineItems
                                                    : undefined,
                                                growth:
                                                  Math.abs(bucketGrowth) > 1
                                                    ? {
                                                        amount: deflate(
                                                          bucketGrowth,
                                                          yr.year,
                                                        ),
                                                      }
                                                    : undefined,
                                              });
                                            })()}
                                            side="top"
                                          >
                                            <td
                                              className={`text-right py-1.5 px-2 ${taxTypeTextColor(bucket)}`}
                                            >
                                              {formatCurrency(
                                                deflate(bal, yr.year),
                                              )}
                                            </td>
                                          </Tooltip>
                                        );
                                      })
                                  ) : (
                                    <>
                                      {getAccountSegments()
                                        .map((seg) => ({
                                          key: seg.key,
                                          val: getSegmentBalance(
                                            yr.balanceByAccount,
                                            seg,
                                          ),
                                          color: accountTextColor(seg.category),
                                          label: seg.label,
                                        }))
                                        .filter((col) =>
                                          visibleColumns.balanceAccts.has(
                                            col.key,
                                          ),
                                        )
                                        .map((col) => {
                                          const catKey = colKeyParts(
                                            col.key,
                                          ).category;
                                          const bal = dpt
                                            ? (dpt.byAccount[col.key] ?? 0)
                                            : col.val;
                                          const dptTotalBal = dpt
                                            ? dpt.balance
                                            : yr.endBalance;
                                          const pct = pctOf(bal, dptTotalBal);
                                          // Compute authoritative total change from engine
                                          const decPrevYr =
                                            result.projectionByYear.find(
                                              (y) => y.year === yr.year - 1,
                                            );
                                          const decPrevPt = decPrevYr
                                            ? getPersonYearTotals(decPrevYr)
                                            : null;
                                          const decPrevVal = decPrevYr
                                            ? decPrevPt
                                              ? (decPrevPt.byAccount[col.key] ??
                                                0)
                                              : colBalance(
                                                  decPrevYr.balanceByAccount,
                                                  col.key,
                                                )
                                            : 0;
                                          // Build account items as data
                                          const decAcctItems: TooltipLineItem[] =
                                            [];
                                          const decColTaxType =
                                            colEngineTaxType(col.key);
                                          // Use engine's individualAccountBalances
                                          const decIabs = (
                                            yr.individualAccountBalances ?? []
                                          ).filter(
                                            (ia) =>
                                              ia.category === catKey &&
                                              (decColTaxType == null ||
                                                ia.taxType === decColTaxType) &&
                                              (!isPersonFiltered ||
                                                ia.ownerPersonId ===
                                                  personFilter),
                                          );
                                          {
                                            // Compute from balance changes — data-driven, no routing layers
                                            const _decPrevIabs =
                                              decPrevYr?.individualAccountBalances ??
                                              [];
                                            const seenDecAccts =
                                              new Set<string>();
                                            const decSplits: {
                                              name: string;
                                              entryTaxType: string;
                                              balance: number;
                                              growth: number;
                                              withdrawal: number;
                                            }[] = [];
                                            for (const ia of decIabs) {
                                              const dk = `${catKey}-${ia.name}-${ia.taxType}`;
                                              if (seenDecAccts.has(dk))
                                                continue;
                                              seenDecAccts.add(dk);
                                              decSplits.push({
                                                name: ia.name,
                                                entryTaxType: ia.taxType,
                                                balance: ia.balance,
                                                growth: ia.growth,
                                                withdrawal: ia.withdrawal ?? 0,
                                              });
                                            }
                                            const splitsTotal =
                                              decSplits.reduce(
                                                (s, e) => s + e.balance,
                                                0,
                                              );
                                            for (const {
                                              name: acctName,
                                              entryTaxType,
                                              balance: spBal,
                                              growth: spGrowth,
                                            } of decSplits) {
                                              const frac =
                                                splitsTotal > 0
                                                  ? spBal / splitsTotal
                                                  : 0;
                                              const subItems: TooltipLineItem[] =
                                                [];
                                              if (Math.abs(spGrowth) > 1)
                                                subItems.push({
                                                  label: "growth",
                                                  amount: deflate(
                                                    spGrowth,
                                                    yr.year,
                                                  ),
                                                  prefix:
                                                    spGrowth >= 0
                                                      ? "+"
                                                      : undefined,
                                                  color:
                                                    spGrowth >= 0
                                                      ? "blue"
                                                      : "red",
                                                });
                                              decAcctItems.push({
                                                label: acctName,
                                                amount: deflate(
                                                  Math.max(0, spBal),
                                                  yr.year,
                                                ),
                                                pct: Math.round(frac * 100),
                                                taxType: itemTaxType(
                                                  catKey,
                                                  entryTaxType,
                                                ),
                                                sub:
                                                  subItems.length > 0
                                                    ? subItems
                                                    : undefined,
                                              });
                                            }
                                          }
                                          // Calculate total withdrawal from slot data (data-driven via colWithdrawal)
                                          const decTotalWd = colWithdrawal(
                                            dyr.slots,
                                            col.key,
                                          );
                                          // Sum growth from engine's individual account balances for this column
                                          const decSplitGrowth = decIabs.reduce(
                                            (s, ia) => s + ia.growth,
                                            0,
                                          );
                                          const decDeflatedBal = deflate(
                                            bal,
                                            yr.year,
                                          );
                                          const decDeflatedPrev = decPrevYr
                                            ? deflate(
                                                decPrevVal,
                                                decPrevYr.year,
                                              )
                                            : 0;
                                          const decDisplayChange = decPrevYr
                                            ? decDeflatedBal - decDeflatedPrev
                                            : deflate(
                                                decSplitGrowth - decTotalWd,
                                                yr.year,
                                              );
                                          const decDisplayWd = deflate(
                                            decTotalWd,
                                            yr.year,
                                          );
                                          const decDisplayGrowth = deflate(
                                            decSplitGrowth,
                                            yr.year,
                                          );
                                          const decBoyBal = decPrevYr
                                            ? decDeflatedPrev
                                            : deflate(
                                                bal -
                                                  decSplitGrowth +
                                                  decTotalWd,
                                                yr.year,
                                              );
                                          const decChangeParts: {
                                            label: string;
                                            amount: number;
                                            color: TipColor;
                                          }[] = [];
                                          if (Math.abs(decDisplayGrowth) > 1)
                                            decChangeParts.push({
                                              label: "growth",
                                              amount: decDisplayGrowth,
                                              color:
                                                decDisplayGrowth >= 0
                                                  ? "blue"
                                                  : "red",
                                            });
                                          if (decDisplayWd > 0)
                                            decChangeParts.push({
                                              label: "withdrawn",
                                              amount: -decDisplayWd,
                                              color: "red",
                                            });
                                          return (
                                            <Tooltip
                                              key={col.key}
                                              content={renderTooltip({
                                                kind: "money",
                                                header: `${col.label}: ${pct}% of portfolio`,
                                                meta: `${yr.year} · BoY: ${formatCurrency(decBoyBal)} → EoY: ${formatCurrency(decDeflatedBal)} · ${formatPercent(yr.returnRate, 1)} return`,
                                                items:
                                                  decAcctItems.length > 0
                                                    ? decAcctItems
                                                    : undefined,
                                                withdrawals:
                                                  decDisplayWd > 0
                                                    ? { amount: decDisplayWd }
                                                    : undefined,
                                                yearChange: {
                                                  total: decDeflatedBal,
                                                  change: decDisplayChange,
                                                  parts:
                                                    decChangeParts.length > 0
                                                      ? decChangeParts
                                                      : undefined,
                                                },
                                                legend: [
                                                  {
                                                    label: "Blue = growth",
                                                    color: "blue",
                                                  },
                                                  {
                                                    label: "Red = withdrawals",
                                                    color: "red",
                                                  },
                                                ],
                                              })}
                                              side="top"
                                            >
                                              <td
                                                className={`text-right py-1.5 px-2 ${col.color}`}
                                              >
                                                {formatCurrency(
                                                  deflate(bal, yr.year),
                                                )}
                                              </td>
                                            </Tooltip>
                                          );
                                        })}
                                    </>
                                  )}
                                  <Tooltip
                                    content={(() => {
                                      const tb = dpt
                                        ? dpt.balance
                                        : yr.endBalance;
                                      const iabs =
                                        yr.individualAccountBalances ?? [];
                                      const totalGrowth = (
                                        dpt
                                          ? iabs.filter(
                                              (ia) =>
                                                ia.ownerPersonId ===
                                                personFilter,
                                            )
                                          : iabs
                                      ).reduce((s, ia) => s + ia.growth, 0);
                                      if (tb < 1 && Math.abs(totalGrowth) < 1)
                                        return renderTooltip({
                                          kind: "info",
                                          lines: [
                                            {
                                              text: "Portfolio depleted",
                                              style: "note",
                                              color: "gray",
                                            },
                                          ],
                                        });
                                      const items: TooltipLineItem[] = (
                                        [
                                          "preTax",
                                          "taxFree",
                                          "hsa",
                                          "afterTax",
                                        ] as const
                                      ).map((b) => {
                                        const bVal = dpt
                                          ? dpt.byTaxType[b]
                                          : yr.balanceByTaxType[b];
                                        return {
                                          label: taxTypeLabel(b),
                                          amount: deflate(bVal, yr.year),
                                          pct: pctOf(bVal, tb),
                                        };
                                      });
                                      return renderTooltip({
                                        kind: "money",
                                        header: "Portfolio Balance",
                                        items,
                                        growth:
                                          Math.abs(totalGrowth) > 1
                                            ? {
                                                amount: deflate(
                                                  totalGrowth,
                                                  yr.year,
                                                ),
                                              }
                                            : undefined,
                                      });
                                    })()}
                                    side="top"
                                  >
                                    <td className="text-right py-1.5 px-2 font-semibold">
                                      {formatCurrency(
                                        Math.max(
                                          0,
                                          deflate(
                                            dpt ? dpt.balance : yr.endBalance,
                                            yr.year,
                                          ),
                                        ),
                                      )}
                                    </td>
                                  </Tooltip>
                                  {renderMcCell(
                                    yr,
                                    deflate(
                                      dpt ? dpt.balance : yr.endBalance,
                                      yr.year,
                                    ),
                                  )}
                                  <td className="py-1.5 pl-2 text-[10px] text-faint whitespace-nowrap border-l border-subtle">
                                    {dyr.taxCost > 0 && (
                                      <Tooltip
                                        content="Effective tax rate = total tax / total withdrawal. Traditional taxed at marginal rate, Brokerage at LTCG rate, Roth/HSA tax-free."
                                        side="left"
                                        maxWidth={240}
                                      >
                                        <span className="text-red-400">
                                          ~
                                          {formatCurrency(
                                            deflate(dyr.taxCost, yr.year),
                                          )}
                                          {""}
                                          tax (
                                          {formatPercent(
                                            dyr.effectiveTaxRate,
                                            1,
                                          )}
                                          {""}
                                          eff.)
                                        </span>
                                      </Tooltip>
                                    )}
                                    {diagMode && dyr.grossUpFactor != null && (
                                      <Tooltip
                                        lines={[
                                          `Expenses: ${formatCurrency(deflate(dyr.projectedExpenses, yr.year))}`,
                                          `SS Income: ${formatCurrency(deflate(dyr.ssIncome ?? 0, yr.year))}`,
                                          `After-tax need: ${formatCurrency(deflate(dyr.afterTaxNeed ?? 0, yr.year))}`,
                                          `Tax rate: ${formatPercent(dyr.effectiveTaxRate, 2)} (trad ${formatPercent(dyr.estTraditionalPortion ?? 0, 0)} of portfolio)`,
                                          `Gross-up: ×${(dyr.grossUpFactor ?? 1).toFixed(3)}`,
                                          `Target withdrawal: ${formatCurrency(deflate(dyr.targetWithdrawal, yr.year))}`,
                                          `Actual withdrawal: ${formatCurrency(deflate(dyr.totalWithdrawal, yr.year))}`,
                                          ...(dyr.projectedExpenses > 0 &&
                                          dyr.totalWithdrawal <
                                            dyr.projectedExpenses
                                            ? [
                                                `SHORTFALL: ${formatCurrency(deflate(dyr.projectedExpenses - dyr.totalWithdrawal, yr.year))}/yr unfunded`,
                                              ]
                                            : []),
                                          ...(dyr.bracketTraditionalCap != null
                                            ? [
                                                `Bracket trad cap: ${formatCurrency(deflate(dyr.bracketTraditionalCap, yr.year))}`,
                                              ]
                                            : []),
                                          ...(dyr.unmetNeed != null &&
                                          dyr.unmetNeed > 0
                                            ? [
                                                `UNMET NEED: ${formatCurrency(deflate(dyr.unmetNeed, yr.year))}`,
                                              ]
                                            : []),
                                          `Routing: ${dyr.config.withdrawalRoutingMode}`,
                                          ...(dyr.preWithdrawalAcctBal
                                            ? getAllCategories()
                                                .filter(
                                                  (c) =>
                                                    ACCOUNT_TYPE_CONFIG[
                                                      c as AcctCat
                                                    ]?.supportsRothSplit,
                                                )
                                                .map((c) => {
                                                  const bal =
                                                    dyr.preWithdrawalAcctBal![
                                                      c as AcctCat
                                                    ];
                                                  return bal && "roth" in bal
                                                    ? ` ${c} pre-wd: trad=${formatCurrency(deflate((bal as unknown as Record<string, number>).traditional ?? 0, yr.year))}, roth=${formatCurrency(deflate((bal as unknown as Record<string, number>).roth ?? 0, yr.year))}`
                                                    : ` ${c} pre-wd: n/a`;
                                                })
                                            : []),
                                          ...dyr.slots.map(
                                            (s) =>
                                              ` ${s.category}: -${formatCurrency(deflate(s.withdrawal, yr.year))} (trad ${formatCurrency(deflate(s.traditionalWithdrawal, yr.year))}, roth ${formatCurrency(deflate(s.rothWithdrawal, yr.year))})`,
                                          ),
                                          ...(dyr.rmdAmount > 0
                                            ? [
                                                `RMD: ${formatCurrency(deflate(dyr.rmdAmount, yr.year))}${dyr.rmdOverrodeRouting ? " (forced)" : ""}`,
                                              ]
                                            : []),
                                          ...(dyr.taxableSS > 0
                                            ? [
                                                `Taxable SS: ${formatCurrency(deflate(dyr.taxableSS, yr.year))} of ${formatCurrency(deflate(dyr.ssIncome ?? 0, yr.year))}`,
                                              ]
                                            : []),
                                          `LTCG rate: ${formatPercent(dyr.ltcgRate, 0)}`,
                                          ...(dyr.rothConversionAmount > 0
                                            ? [
                                                `Roth conv: ${formatCurrency(deflate(dyr.rothConversionAmount, yr.year))} (tax: ${formatCurrency(deflate(dyr.rothConversionTaxCost, yr.year))})`,
                                              ]
                                            : []),
                                          ...(dyr.strategyAction
                                            ? [
                                                `Strategy: ${dyr.strategyAction}`,
                                              ]
                                            : []),
                                          ...(dyr.irmaaCost > 0
                                            ? [
                                                `IRMAA: ${formatCurrency(deflate(dyr.irmaaCost, yr.year))}/yr surcharge`,
                                              ]
                                            : []),
                                          ...(dyr.acaSubsidyPreserved
                                            ? [
                                                `ACA: subsidy preserved (${formatCurrency(deflate(dyr.acaMagiHeadroom, yr.year))} headroom)`,
                                              ]
                                            : []),
                                          ...(!dyr.acaSubsidyPreserved &&
                                          dyr.acaMagiHeadroom === 0 &&
                                          yr.age < 65
                                            ? [`ACA: subsidy lost`]
                                            : []),
                                        ]}
                                        side="left"
                                        maxWidth={320}
                                      >
                                        <span className="text-blue-400 ml-1 cursor-help">
                                          diag
                                        </span>
                                      </Tooltip>
                                    )}
                                    {dyr.warnings.length > 0 && (
                                      <Tooltip
                                        content={renderTooltip({
                                          kind: "info",
                                          lines: dyr.warnings.map((w) => ({
                                            text: w,
                                            style: "note" as const,
                                          })),
                                        })}
                                        side="left"
                                      >
                                        <span className="text-amber-500 ml-1">
                                          {dyr.warnings.length} warning
                                          {dyr.warnings.length > 1 ? "s" : ""}
                                        </span>
                                      </Tooltip>
                                    )}
                                  </td>
                                </tr>
                              );
                            },
                          )}
                        </tbody>
                      );
                    })()}
                  </table>
                </div>
              )}

              {/* Contribution & Distribution Model Explanations (collapsible) */}
              {result && (<><div>
                <button
                  type="button"
                  onClick={() => setShowModels(!showModels)}
                  className="flex items-center gap-1.5 text-[11px] font-medium text-faint uppercase tracking-wide hover:text-secondary transition-colors mb-2"
                >
                  How contributions &amp; distributions are projected
                  <svg
                    className={`w-3.5 h-3.5 transition-transform ${showModels ? "rotate-180" : ""}`}
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
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {/* How Contributions Are Projected */}
                    {contribSpecs && contribSpecs.length > 0 && (
                      <div className="bg-blue-50/50 border border-blue-100 rounded-lg p-3 text-xs">
                        <h5 className="font-medium text-secondary uppercase mb-2">
                          How {isPersonFiltered ? `${personFilterName}'s` : ""}
                          {""}
                          Contributions Are Projected
                          <HelpTip
                            text={
                              isPersonFiltered
                                ? `Based on ${personFilterName}'s paycheck/contributions settings. Includes Retirement (401k, IRA, Retirement Brokerage) and HSA categories. Brokerage-category accounts (ESPP, Long Term Brokerage) are excluded.`
                                : "Based on your paycheck/contributions settings. Includes Retirement (401k, IRA, Retirement Brokerage) and HSA categories. Brokerage-category accounts (ESPP, Long Term Brokerage) are excluded."
                            }
                          />
                        </h5>
                        <table className="w-full text-muted">
                          <thead>
                            <tr className="text-[10px] text-faint uppercase">
                              <th className="text-left pb-1 font-medium">
                                Account
                              </th>
                              <th className="text-left pb-1 font-medium">
                                Tax Type
                              </th>
                              <th className="text-right pb-1 font-medium">
                                Amount
                              </th>
                              <th className="text-right pb-1 font-medium">
                                Match
                              </th>
                              <th className="text-left pb-1 pl-2 font-medium">
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
                              .map((spec, i) => {
                                const bucket =
                                  TAX_TREATMENT_TO_BUCKET[spec.taxTreatment] ??
                                  spec.taxTreatment;
                                return (
                                  <tr
                                    key={i}
                                    className="border-t border-blue-100/60"
                                  >
                                    <td className="py-1 pr-2">
                                      <div className="flex items-center gap-1.5">
                                        <span
                                          className={`inline-block w-1.5 h-1.5 rounded-full ${accountColor(spec.category)}`}
                                        />
                                        <span className="font-medium">
                                          {spec.accountDisplayName ?? spec.name}
                                        </span>
                                      </div>
                                    </td>
                                    <td
                                      className={`py-1 whitespace-nowrap text-[10px] ${taxTypeTextColor(bucket)}`}
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
                                    <td className="py-1 pl-2 text-faint whitespace-nowrap">
                                      {(() => {
                                        const scalesWithSalary =
                                          spec.method === "percent_of_salary" ||
                                          (spec.category in
                                            ACCOUNT_TYPE_CONFIG &&
                                            ACCOUNT_TYPE_CONFIG[
                                              spec.category as AcctCat
                                            ].fixedContribScalesWithSalary);
                                        const hasIrsLimit =
                                          spec.category in
                                            ACCOUNT_TYPE_CONFIG &&
                                          ACCOUNT_TYPE_CONFIG[
                                            spec.category as AcctCat
                                          ].hasIrsLimit;
                                        if (scalesWithSalary && hasIrsLimit)
                                          return "Salary + IRS cap";
                                        if (scalesWithSalary)
                                          return "Scales w/ salary";
                                        if (hasIrsLimit)
                                          return "Scales w/ IRS limits";
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
                              <div className="mt-2 pt-1.5 border-t border-blue-100 text-[10px] text-faint">
                                Match grows with salary. Look for{""}
                                <span className="font-bold text-green-600">
                                  +m
                                </span>
                                {""}
                                in the table and hover for breakdown.
                              </div>
                            );
                          })()}
                        {result.firstOverflowYear && (
                          <div className="mt-1.5 pt-1.5 border-t border-blue-100 text-amber-600 font-medium">
                            Contributions exceed IRS limits starting age{""}
                            {result.firstOverflowAge} (
                            {result.firstOverflowYear}) —{""}
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
                      <div className="bg-blue-50/50 border border-blue-100 rounded-lg p-3 text-xs">
                        <h5 className="font-medium text-secondary uppercase mb-1.5">
                          Accumulation Engine
                          <HelpTip text="How salary, contributions, IRS limits, employer matches, and routing work during working years." />
                        </h5>
                        <p className="text-muted mb-2">
                          Routes contributions across 401k, IRA, HSA, and
                          brokerage using waterfall, percentage, or per-account
                          specs. Handles IRS limit growth, catch-up
                          contributions (SECURE 2.0), employer matches,
                          Roth/Traditional splits, and overflow to brokerage.
                        </p>
                        <button
                          type="button"
                          onClick={() => setShowAccumMethodology(true)}
                          className="text-blue-600 hover:text-blue-700 underline font-medium"
                        >
                          Full methodology &rarr;
                        </button>
                      </div>
                      <div className="bg-amber-50/50 border border-amber-100 rounded-lg p-3 text-xs">
                        <h5 className="font-medium text-secondary uppercase mb-1.5">
                          Decumulation Engine
                          <HelpTip text="How withdrawals, taxes, RMDs, Roth conversions, and dynamic spending work during retirement." />
                        </h5>
                        <p className="text-muted mb-2">
                          Computes annual need (budget × inflation &minus;
                          Social Security at age{" "}
                          {engineSettings?.ssStartAge ?? "?"}), grosses up for
                          taxes, and routes withdrawals via{""}
                          {withdrawalRoutingMode === "bracket_filling"
                            ? "bracket filling (Traditional → Roth → Brokerage → HSA)"
                            : withdrawalRoutingMode === "waterfall"
                              ? `waterfall (${withdrawalOrder.map((c) => getAccountTypeConfig(c).displayLabel).join(" →")})`
                              : "percentage split"}
                          . Enforces RMDs, optional Roth conversions, 8 dynamic
                          spending strategies (Morningstar), and IRMAA/ACA cliff
                          awareness.
                        </p>
                        <button
                          type="button"
                          onClick={() => setShowDecumMethodology(true)}
                          className="text-amber-600 hover:text-amber-700 underline font-medium"
                        >
                          Full methodology &rarr;
                        </button>
                        {result.portfolioDepletionYear && (
                          <div className="mt-2 pt-1.5 border-t border-amber-100 text-red-600 font-medium">
                            Portfolio depleted at age{" "}
                            {result.portfolioDepletionAge} (
                            {result.portfolioDepletionYear})
                          </div>
                        )}
                      </div>
                      <div className="bg-green-50/50 border border-green-100 rounded-lg p-3 text-xs">
                        <h5 className="font-medium text-secondary uppercase mb-1.5">
                          Why Trust These Numbers?
                          <HelpTip text="How the engine is validated against published research, IRS tax law, and mathematical invariants." />
                        </h5>
                        <p className="text-muted mb-2">
                          Calibrated against the Trinity Study, cFIREsim
                          backtesting, IRS 2025 tax tables, and institutional
                          asset data. Backed by 362 automated tests including 29
                          mathematical invariants proven for any input.
                        </p>
                        <button
                          type="button"
                          onClick={() => setShowValidation(true)}
                          className="text-green-600 hover:text-green-700 underline font-medium"
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
                  {result.warnings.map((w, i) => (
                    <div
                      key={i}
                      className="text-xs text-amber-600 bg-amber-50 rounded px-3 py-1.5"
                    >
                      {w}
                    </div>
                  ))}
                </div>
              )}
              </>)}
    </>
  );
}
