/** Renders a single decumulation-phase table row with withdrawal breakdowns, tax costs, balance columns, and MC cell. */
import React, { useRef } from "react";
import { useScrollToFocus } from "@/components/ui/focus-target";
import { Tooltip } from "@/components/ui/tooltip";
import { BalanceCell } from "./balance-cell";
import { accountTextColor, taxTypeTextColor } from "@/lib/utils/colors";
import { taxTypeLabel } from "@/lib/config/display-labels";
import {
  formatCurrency,
  formatPercent,
  maskAmountsInText,
} from "@/lib/utils/format";
import { safeDivide } from "@/lib/utils/math";
import type { AccountCategory } from "@/lib/config/account-types";
import type {
  EngineDecumulationYear,
  DecumulationSlot,
} from "@/lib/pure/engine/types";
import type { IndividualAccountYearBalance } from "@/lib/pure/accounts/account-balances.types";
import {
  getAccountSegments,
  getAllCategories,
  ACCOUNT_TYPE_CONFIG,
  isOverflowTarget,
  isQcdEligible,
} from "@/lib/config/account-types";
import { getSegmentBalance } from "@/lib/pure/accounts/account-balance";
import type { TipColor, TooltipLineItem } from "./types";
import { rowTotal } from "./parent-category-filter";
import { lumpSumTotal } from "./lump-sums";
import {
  itemTaxType,
  colKeyParts,
  colBalance,
  colWithdrawal,
  colEngineTaxType,
  percentOf,
} from "./projection-columns";
import { slotBucketWithdrawal, iaBelongsToBucket } from "./bucket-slots";
import type { ProjectionState } from "./projection-table-types";
import {
  renderSimulationCell,
  type RenderSimulationCellOptions,
} from "./projection-table-mc-cell";
import { buildFullAccountNote } from "./account-notes";
import {
  CATEGORY_ORDER,
  decumYearAgesTooltip,
  categoryCellColor,
  categoryCellText,
  taxTypeCellColor,
  taxTypeCellText,
  totalWithdrawalText,
} from "./projection-table-decum-row.model";
import {
  categoryWithdrawalTooltip,
  taxTypeWithdrawalTooltip,
  taxTypeLumpSumTooltip,
} from "./projection-table-decum-withdrawals.model";
import {
  totalWithdrawalTooltip,
  taxTypeBalanceTooltip,
} from "./projection-table-decum-balances.model";

type DecumulationRowProps = {
  /** A link landed on this year — scrolled to and ringed. */
  focused?: boolean;
  yearRow: EngineDecumulationYear;
  state: ProjectionState;
  parentCategoryFilter?: string;
  isPhaseTransition: boolean;
  hasOverride: boolean;
  decumOverrideNotes?: string;
  salaryOverrideNotes?: string | null;
  budgetOverrideNotes?: string | null;
  decumulationBudgetProfileId?: number;
  decumulationBudgetColumn?: number;
  decumulationExpenseOverride?: number;
  people?: { id: number; name: string; birthYear: number }[];
  simulationCellOpts: RenderSimulationCellOptions;
};

/** The portfolio total's tooltip, by tax type, or depleted. */
function decumPortfolioBalanceTooltip(
  dpt: ReturnType<ProjectionState["getPersonYearTotals"]>,
  yearRow: EngineDecumulationYear,
  personFilter: ProjectionState["personFilter"],
  renderTooltip: ProjectionState["renderTooltip"],
  deflate: ProjectionState["deflate"],
) {
  const tb = dpt ? dpt.balance : rowTotal(yearRow);
  const iabs = yearRow.individualAccountBalances ?? [];
  const totalGrowth = (
    dpt ? iabs.filter((ia) => ia.ownerPersonId === personFilter) : iabs
  ).reduce((s, ia) => s + ia.growth, 0);
  if (tb < 1 && Math.abs(totalGrowth) < 1)
    return renderTooltip({
      kind: "info",
      lines: [
        {
          text: "Balance depleted",
          style: "note",
          color: "gray",
        },
      ],
    });
  const items: TooltipLineItem[] = (
    ["preTax", "taxFree", "hsa", "afterTax"] as const
  ).map((b) => {
    const bVal = dpt ? dpt.byTaxType[b] : yearRow.balanceByTaxType[b];
    return {
      label: taxTypeLabel(b),
      amount: deflate(bVal, yearRow.year),
      percent: percentOf(bVal, tb),
    };
  });
  return renderTooltip({
    kind: "money",
    header: "Portfolio Balance",
    items,
    growth:
      Math.abs(totalGrowth) > 1
        ? {
            amount: deflate(totalGrowth, yearRow.year),
          }
        : undefined,
  });
}

export function DecumulationRow({
  yearRow: dyr,
  focused = false,
  state,
  parentCategoryFilter: _parentCategoryFilter,
  isPhaseTransition,
  hasOverride,
  decumOverrideNotes,
  salaryOverrideNotes: _salaryOverrideNotes,
  budgetOverrideNotes,
  decumulationBudgetProfileId,
  decumulationBudgetColumn,
  decumulationExpenseOverride,
  people,
  simulationCellOpts,
}: DecumulationRowProps) {
  const rowRef = useRef<HTMLTableRowElement>(null);
  useScrollToFocus(rowRef, focused);
  const {
    decumOverrides: _decumOverrides,
    balanceView,
    contributionView,
    diagMode,
    personFilter,
    isPersonFiltered,
    visibleColumns,
    deflate,
    getPersonYearTotals,
    baseYear: _baseYear,
    renderTooltip,
    enginePeople,
    engineSettings,
    withdrawalRoutingMode: _withdrawalRoutingMode,
    budgetProfileSummaries,
    result,
    bracketOptimizerResult,
  } = state;
  if (!result) return null;

  // Alias for code extracted from inline — uses `yearRow` throughout
  const yearRow = dyr;

  // The household-wide capacity paragraph is identical for every roth/brokerage
  // row, so it shows on the first qualifying row only. Safe as a local flag:
  // this component renders once per year, synchronously.
  const capacityNote = { shownThisYear: false };

  // Shared by the three withdrawal-by-tax-type/withdrawal-by-account
  // branches below.
  const noteFor = (ia: IndividualAccountYearBalance) =>
    buildFullAccountNote(
      ia,
      yearRow,
      deflate,
      bracketOptimizerResult,
      !capacityNote.shownThisYear,
      () => {
        capacityNote.shownThisYear = true;
      },
    );

  const dSlotMap = new Map<AccountCategory, DecumulationSlot>(
    dyr.slots.map((s) => [s.category, s]),
  );
  const dpt = getPersonYearTotals(yearRow);
  const yearLumpSums = dyr.config.lumpSums;
  const totalLumpSum = lumpSumTotal(yearLumpSums);

  // Detect milestone years for row highlighting
  const isSsStartRow =
    result.projectionByYear.find(
      (y) => y.phase === "decumulation" && y.ssIncome > 0,
    )?.year === yearRow.year;
  const isRmdStartRow =
    result.projectionByYear.find(
      (y) => y.phase === "decumulation" && y.rmdAmount > 0,
    )?.year === yearRow.year;

  return (
    <tr
      ref={rowRef}
      key={yearRow.year}
      className={`border-subtle hover:bg-surface-elevated/60 border-b transition-colors ${
        isPhaseTransition
          ? "bg-blue-50 font-medium"
          : hasOverride
            ? "bg-amber-50"
            : yearRow.retirementBalance < 1
              ? "bg-red-50"
              : isSsStartRow
                ? "bg-teal-50"
                : isRmdStartRow
                  ? "bg-amber-50"
                  : ""
      }`}
    >
      <Tooltip
        content={decumYearAgesTooltip(
          people,
          enginePeople,
          renderTooltip,
          yearRow,
        )}
        side="top"
      >
        <td className="py-1.5 pr-2">{yearRow.year}</td>
      </Tooltip>
      <td className="px-2 py-1.5">
        <span className="text-caption font-medium text-amber-600">DRAW</span>
      </td>
      <Tooltip content="No salary income during retirement" side="top">
        <td className="text-faint px-2 py-1.5 text-right">---</td>
      </Tooltip>
      <Tooltip content="No contribution rate during retirement" side="top">
        <td className="text-faint px-2 py-1.5 text-right">---</td>
      </Tooltip>
      {contributionView === "account"
        ? getAllCategories()
            .filter((c) => visibleColumns.contributionCats.has(c))
            .map((cat) => {
              const dSlot = dSlotMap.get(cat);
              const withdrawal = dSlot?.withdrawal ?? 0;
              // Get growth from individualAccountBalances for this category
              const iabs = yearRow.individualAccountBalances ?? [];
              const categoryAccounts = dpt
                ? iabs.filter(
                    (ia) =>
                      ia.ownerPersonId === personFilter && ia.category === cat,
                  )
                : iabs.filter((ia) => ia.category === cat);
              const catGrowth = categoryAccounts.reduce(
                (s, ia) => s + ia.growth,
                0,
              );
              const catBalance = categoryAccounts.reduce(
                (s, ia) => s + ia.balance,
                0,
              );
              return (
                <Tooltip
                  key={cat}
                  content={categoryWithdrawalTooltip(
                    dSlotMap,
                    cat,
                    withdrawal,
                    categoryAccounts,
                    yearRow,
                    deflate,
                    noteFor,
                    yearLumpSums,
                    engineSettings,
                    renderTooltip,
                    catGrowth,
                    catBalance,
                  )}
                  side="top"
                  maxWidth={420}
                >
                  <td
                    className={`px-2 py-1.5 text-right ${categoryCellColor(yearLumpSums, cat, withdrawal)}`}
                  >
                    {categoryCellText(
                      yearLumpSums,
                      cat,
                      withdrawal,
                      deflate,
                      yearRow,
                    )}
                  </td>
                </Tooltip>
              );
            })
        : /* Withdrawal columns by tax type */
          (["preTax", "taxFree", "hsa", "afterTax"] as const)
            .filter((t) => visibleColumns.contributionTaxTypes.has(t))
            .map((bucket) => {
              let bucketWithdrawal = 0;
              const parts: {
                cat: string;
                withdrawal: number;
              }[] = [];
              for (const slot of dyr.slots) {
                const withdrawal = slotBucketWithdrawal(slot, bucket);
                if (withdrawal > 0) {
                  parts.push({
                    cat: slot.category,
                    withdrawal,
                  });
                  bucketWithdrawal += withdrawal;
                }
              }
              // Per-account "why was this account used" breakdown (see
              // buildNote), falling back to the `parts` aggregate below when
              // no individual-account data exists.
              const bucketIabsAll = yearRow.individualAccountBalances ?? [];
              const bucketIabs = (
                dpt
                  ? bucketIabsAll.filter(
                      (ia) => ia.ownerPersonId === personFilter,
                    )
                  : bucketIabsAll
              ).filter((ia) => iaBelongsToBucket(ia, bucket));
              const withdrawingAccounts = bucketIabs
                .filter((ia) => (ia.draw?.withdrawal ?? 0) > 0.01)
                .sort((a, b) => {
                  const catDiff =
                    (CATEGORY_ORDER.get(a.category as AccountCategory) ?? 0) -
                    (CATEGORY_ORDER.get(b.category as AccountCategory) ?? 0);
                  if (catDiff !== 0) return catDiff;
                  return (a.ownerName ?? a.name).localeCompare(
                    b.ownerName ?? b.name,
                  );
                });
              return (
                <Tooltip
                  key={bucket}
                  content={
                    parts.length > 0
                      ? taxTypeWithdrawalTooltip(
                          bucket,
                          yearLumpSums,
                          withdrawingAccounts,
                          deflate,
                          yearRow,
                          noteFor,
                          parts,
                          renderTooltip,
                          bucketWithdrawal,
                        )
                      : taxTypeLumpSumTooltip(
                          yearLumpSums,
                          bucket,
                          renderTooltip,
                          deflate,
                          yearRow,
                        )
                  }
                  side="top"
                >
                  <td
                    className={`px-2 py-1.5 text-right ${taxTypeCellColor(yearLumpSums, bucket, bucketWithdrawal)}`}
                  >
                    {taxTypeCellText(
                      yearLumpSums,
                      bucket,
                      bucketWithdrawal,
                      deflate,
                      yearRow,
                    )}
                  </td>
                </Tooltip>
              );
            })}
      <Tooltip
        content={totalWithdrawalTooltip(
          yearRow,
          dpt,
          personFilter,
          dyr,
          dSlotMap,
          yearLumpSums,
          deflate,
          noteFor,
          decumulationBudgetProfileId,
          budgetProfileSummaries,
          decumulationExpenseOverride,
          budgetOverrideNotes,
          decumulationBudgetColumn,
          isSsStartRow,
          renderTooltip,
          isRmdStartRow,
          engineSettings,
          decumOverrideNotes,
        )}
        side="top"
        maxWidth={460}
      >
        <td
          className={`px-2 py-1.5 text-right font-medium ${
            totalLumpSum > 0 && totalLumpSum > dyr.totalWithdrawal
              ? "text-green-600"
              : dyr.totalWithdrawal > 0 &&
                  dyr.totalWithdrawal < dyr.targetWithdrawal
                ? "text-amber-500"
                : dyr.totalWithdrawal > 0
                  ? "text-red-600"
                  : dyr.retirementBalance < 1 && dyr.projectedExpenses > 0
                    ? "text-red-400 italic"
                    : "text-muted"
          }`}
        >
          {totalWithdrawalText(deflate, totalLumpSum, dyr, yearRow)}
        </td>
      </Tooltip>
      {balanceView === "taxType" ? (
        (["preTax", "taxFree", "hsa", "afterTax"] as const)
          .filter((t) => visibleColumns.balanceTaxTypes.has(t))
          .map((bucket) => {
            const balance = dpt
              ? dpt.byTaxType[bucket]
              : yearRow.balanceByTaxType[bucket];
            const dptTotal = dpt ? dpt.balance : rowTotal(yearRow);
            const pct = percentOf(balance, dptTotal);
            // Compute growth for this tax bucket from individualAccountBalances
            const bucketIabs = yearRow.individualAccountBalances ?? [];
            const bucketAccounts = (
              dpt
                ? bucketIabs.filter((ia) => ia.ownerPersonId === personFilter)
                : bucketIabs
            ).filter((ia) => iaBelongsToBucket(ia, bucket));
            const bucketGrowth = bucketAccounts.reduce(
              (s, ia) => s + ia.growth,
              0,
            );
            return (
              <BalanceCell
                key={bucket}
                amount={deflate(balance, yearRow.year)}
                color={taxTypeTextColor(bucket)}
                tooltip={taxTypeBalanceTooltip(
                  bucketAccounts,
                  bucket,
                  deflate,
                  yearRow,
                  dpt,
                  dyr,
                  yearLumpSums,
                  engineSettings,
                  renderTooltip,
                  pct,
                  bucketGrowth,
                )}
              />
            );
          })
      ) : (
        <>
          {getAccountSegments()
            .map((seg) => ({
              key: seg.key,
              val: getSegmentBalance(yearRow.balanceByAccount, seg),
              color: accountTextColor(seg.category),
              label: seg.label,
            }))
            .filter((col) => visibleColumns.balanceAccounts.has(col.key))
            .map((col) => {
              const catKey = colKeyParts(col.key).category;
              const bal = dpt ? (dpt.byAccount[col.key] ?? 0) : col.val;
              const dptTotalBalance = dpt ? dpt.balance : rowTotal(yearRow);
              const pct = percentOf(bal, dptTotalBalance);
              // Compute authoritative total change from engine
              const decumulationPreviousYear = result.projectionByYear.find(
                (y) => y.year === yearRow.year - 1,
              );
              const decumulationPrevPt = decumulationPreviousYear
                ? getPersonYearTotals(decumulationPreviousYear)
                : null;
              const decumulationPrevVal = decumulationPreviousYear
                ? decumulationPrevPt
                  ? (decumulationPrevPt.byAccount[col.key] ?? 0)
                  : colBalance(
                      decumulationPreviousYear.balanceByAccount,
                      col.key,
                    )
                : 0;
              // Build account items as data
              const decumulationAccountItems: TooltipLineItem[] = [];
              const decumulationColTaxType = colEngineTaxType(col.key);
              // Use engine's individualAccountBalances
              const decumulationIabs = (
                yearRow.individualAccountBalances ?? []
              ).filter(
                (ia) =>
                  ia.category === catKey &&
                  (decumulationColTaxType == null ||
                    ia.taxType === decumulationColTaxType) &&
                  (!isPersonFiltered || ia.ownerPersonId === personFilter),
              );
              {
                // Compute from balance changes — data-driven, no routing layers
                const _decumulationPrevIabs =
                  decumulationPreviousYear?.individualAccountBalances ?? [];
                const seenDecumulationAccounts = new Set<string>();
                const decumulationSplits: {
                  name: string;
                  entryTaxType: string;
                  balance: number;
                  growth: number;
                  withdrawal: number;
                }[] = [];
                for (const ia of decumulationIabs) {
                  const dk = `${catKey}-${ia.name}-${ia.taxType}`;
                  if (seenDecumulationAccounts.has(dk)) continue;
                  seenDecumulationAccounts.add(dk);
                  decumulationSplits.push({
                    name: ia.name,
                    entryTaxType: ia.taxType,
                    balance: ia.balance,
                    growth: ia.growth,
                    withdrawal: ia.draw?.withdrawal ?? 0,
                  });
                }
                const splitsTotal = decumulationSplits.reduce(
                  (s, e) => s + e.balance,
                  0,
                );
                for (const {
                  name: accountName,
                  entryTaxType,
                  balance: spBalance,
                  growth: spGrowth,
                } of decumulationSplits) {
                  const frac = safeDivide(spBalance, splitsTotal, 0);
                  const subItems: TooltipLineItem[] = [];
                  if (Math.abs(spGrowth) > 1)
                    subItems.push({
                      label: "growth",
                      amount: deflate(spGrowth, yearRow.year),
                      prefix: spGrowth >= 0 ? "+" : undefined,
                      color: spGrowth >= 0 ? "blue" : "red",
                    });
                  decumulationAccountItems.push({
                    label: accountName,
                    amount: deflate(Math.max(0, spBalance), yearRow.year),
                    percent: Math.round(frac * 100),
                    taxType: itemTaxType(catKey, entryTaxType),
                    sub: subItems.length > 0 ? subItems : undefined,
                  });
                }
              }
              // RMD-excess / QCD lines, gated on this column's own category so
              // they fire whichever overflow/IRA column the segment maps to.
              const colRmdExcess = yearRow.rmdExcessAmount ?? 0;
              const colRmdMode = engineSettings?.rmdExcessHandling;
              if (
                colRmdExcess > 0.01 &&
                isOverflowTarget(catKey as AccountCategory)
              ) {
                if (colRmdMode === "spend") {
                  decumulationAccountItems.push({
                    label: "RMD excess spent (not reinvested)",
                    amount: deflate(colRmdExcess, yearRow.year),
                    color: "gray",
                  });
                } else {
                  decumulationAccountItems.push({
                    label: "RMD excess reinvested",
                    amount: deflate(colRmdExcess, yearRow.year),
                    prefix: "+",
                    color: "amber",
                  });
                }
              }
              const colQcd = yearRow.qcdAmount ?? 0;
              if (colQcd > 0.01 && isQcdEligible(catKey)) {
                decumulationAccountItems.push({
                  label: "QCD to charity (excluded from taxable income)",
                  amount: deflate(colQcd, yearRow.year),
                  prefix: "-",
                  color: "violet",
                });
              }
              // Calculate total withdrawal from slot data (data-driven via colWithdrawal)
              const decumulationTotalWithdrawal = colWithdrawal(
                dyr.slots,
                col.key,
              );
              // Sum growth from engine's individual account balances for this column
              const decumulationSplitGrowth = decumulationIabs.reduce(
                (s, ia) => s + ia.growth,
                0,
              );
              const decumulationDeflatedBalance = deflate(bal, yearRow.year);
              const decumulationDeflatedPrev = decumulationPreviousYear
                ? deflate(decumulationPrevVal, decumulationPreviousYear.year)
                : 0;
              const decumulationDisplayChange = decumulationPreviousYear
                ? decumulationDeflatedBalance - decumulationDeflatedPrev
                : deflate(
                    decumulationSplitGrowth - decumulationTotalWithdrawal,
                    yearRow.year,
                  );
              const decumulationDisplayWithdrawal = deflate(
                decumulationTotalWithdrawal,
                yearRow.year,
              );
              const decumulationDisplayGrowth = deflate(
                decumulationSplitGrowth,
                yearRow.year,
              );
              const decumulationBoyBalance = decumulationPreviousYear
                ? decumulationDeflatedPrev
                : deflate(
                    bal - decumulationSplitGrowth + decumulationTotalWithdrawal,
                    yearRow.year,
                  );
              const decumulationChangeParts: {
                label: string;
                amount: number;
                color: TipColor;
              }[] = [];
              if (Math.abs(decumulationDisplayGrowth) > 1)
                decumulationChangeParts.push({
                  label: "growth",
                  amount: decumulationDisplayGrowth,
                  color: decumulationDisplayGrowth >= 0 ? "blue" : "red",
                });
              if (decumulationDisplayWithdrawal > 0)
                decumulationChangeParts.push({
                  label: "withdrawn",
                  amount: -decumulationDisplayWithdrawal,
                  color: "red",
                });
              return (
                <BalanceCell
                  key={col.key}
                  amount={deflate(bal, yearRow.year)}
                  color={col.color}
                  tooltip={renderTooltip({
                    kind: "money",
                    header: `${col.label}: ${pct}% of portfolio`,
                    meta: `${yearRow.year} · BoY: ${formatCurrency(decumulationBoyBalance)} → EoY: ${formatCurrency(decumulationDeflatedBalance)} · ${formatPercent(yearRow.returnRate, 1)} return`,
                    items:
                      decumulationAccountItems.length > 0
                        ? decumulationAccountItems
                        : undefined,
                    withdrawals:
                      decumulationDisplayWithdrawal > 0
                        ? { amount: decumulationDisplayWithdrawal }
                        : undefined,
                    yearChange: {
                      total: decumulationDeflatedBalance,
                      change: decumulationDisplayChange,
                      parts:
                        decumulationChangeParts.length > 0
                          ? decumulationChangeParts
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
                />
              );
            })}
        </>
      )}
      <Tooltip
        content={decumPortfolioBalanceTooltip(
          dpt,
          yearRow,
          personFilter,
          renderTooltip,
          deflate,
        )}
        side="top"
      >
        <td className="px-2 py-1.5 text-right font-semibold">
          {formatCurrency(
            Math.max(
              0,
              deflate(dpt ? dpt.balance : rowTotal(yearRow), yearRow.year),
            ),
          )}
        </td>
      </Tooltip>
      {renderSimulationCell(
        yearRow,
        deflate(dpt ? dpt.balance : rowTotal(yearRow), yearRow.year),
        simulationCellOpts,
      )}
      <td className="text-caption text-faint border-subtle border-l py-1.5 pl-2 whitespace-nowrap">
        {dyr.taxCost > 0 && (
          <Tooltip
            content="Eff. rate = tax on the withdrawal / total withdrawal (tax on Social Security is shown apart). Traditional: marginal rate. Brokerage: LTCG rate. Roth growth beyond basis: ordinary rate. Once at the bracket cap, the engine picks whichever's cheaper that year."
            side="left"
            maxWidth={240}
          >
            <span className="text-red-400">
              ~
              {formatCurrency(
                deflate(dyr.taxCost - dyr.ssTaxCost, yearRow.year),
              )}{" "}
              tax ({formatPercent(dyr.effectiveTaxRate, 1)} eff.)
              {dyr.ssTaxCost > 0 && (
                <>
                  {" "}
                  + {formatCurrency(deflate(dyr.ssTaxCost, yearRow.year))} on
                  Social Security
                </>
              )}
            </span>
          </Tooltip>
        )}
        {diagMode && dyr.grossUpFactor != null && (
          <Tooltip
            lines={[
              dyr.withdrawalSized
                ? `Strategy withdrawal: ${formatCurrency(deflate(dyr.projectedExpenses, yearRow.year))} (Social Security on top)`
                : `Expenses: ${formatCurrency(deflate(dyr.projectedExpenses, yearRow.year))}`,
              `SS Income: ${formatCurrency(deflate(dyr.ssIncome ?? 0, yearRow.year))}`,
              `Spending: ${formatCurrency(deflate(dyr.spending, yearRow.year))} (after tax, Social Security included)`,
              `After-tax need: ${formatCurrency(deflate(dyr.afterTaxNeed ?? 0, yearRow.year))}`,
              `Tax rate: ${formatPercent(dyr.effectiveTaxRate, 2)} (trad ${formatPercent(dyr.estTraditionalPortion ?? 0, 0)} of retirement money)`,
              ...(dyr.ssTaxCost > 0
                ? [
                    `Tax on Social Security: ${formatCurrency(deflate(dyr.ssTaxCost, yearRow.year))} (not in the rate)`,
                  ]
                : []),
              `Gross-up: ×${(dyr.grossUpFactor ?? 1).toFixed(3)}`,
              `Target withdrawal: ${formatCurrency(deflate(dyr.targetWithdrawal, yearRow.year))}`,
              `Actual withdrawal: ${formatCurrency(deflate(dyr.totalWithdrawal, yearRow.year))}`,
              ...(dyr.bracketTraditionalCap != null
                ? [
                    `Bracket trad cap: ${formatCurrency(deflate(dyr.bracketTraditionalCap, yearRow.year))}`,
                  ]
                : []),
              ...(dyr.unmetNeed != null && dyr.unmetNeed > 0
                ? [
                    `UNMET NEED: ${formatCurrency(deflate(dyr.unmetNeed, yearRow.year))}`,
                  ]
                : []),
              `Routing: ${dyr.config.withdrawalRoutingMode}`,
              ...(dyr.preWithdrawalAcctBal
                ? getAllCategories()
                    .filter(
                      (c) =>
                        ACCOUNT_TYPE_CONFIG[c as AccountCategory]
                          ?.supportsRothSplit,
                    )
                    .map((c) => {
                      const balance =
                        dyr.preWithdrawalAcctBal![c as AccountCategory];
                      return balance && "roth" in balance
                        ? // eslint-disable-next-line no-restricted-syntax -- type narrowing for untyped API response
                          ` ${c} pre-wd: trad=${formatCurrency(deflate((balance as unknown as Record<string, number>).traditional ?? 0, yearRow.year))}, roth=${formatCurrency(deflate((balance as unknown as Record<string, number>).roth ?? 0, yearRow.year))}`
                        : ` ${c} pre-wd: n/a`;
                    })
                : []),
              ...dyr.slots.map(
                (s) =>
                  ` ${s.category}: -${formatCurrency(deflate(s.withdrawal, yearRow.year))} (trad ${formatCurrency(deflate(s.traditionalWithdrawal, yearRow.year))}, roth ${formatCurrency(deflate(s.rothWithdrawal, yearRow.year))})`,
              ),
              ...(dyr.rmdAmount > 0
                ? [
                    `RMD: ${formatCurrency(deflate(dyr.rmdAmount, yearRow.year))}${dyr.rmdOverrodeRouting ? " (forced)" : ""}`,
                  ]
                : []),
              ...(dyr.taxableSS > 0
                ? [
                    `Taxable SS: ${formatCurrency(deflate(dyr.taxableSS, yearRow.year))} of ${formatCurrency(deflate(dyr.ssIncome ?? 0, yearRow.year))}`,
                  ]
                : []),
              `LTCG rate: ${formatPercent(dyr.ltcgRate, 0)}`,
              ...(dyr.rothConversionAmount > 0
                ? [
                    `Roth conv: ${formatCurrency(deflate(dyr.rothConversionAmount, yearRow.year))} (tax: ${formatCurrency(deflate(dyr.rothConversionTaxCost, yearRow.year))})`,
                  ]
                : []),
              ...(dyr.strategyAction
                ? [`Strategy: ${dyr.strategyAction}`]
                : []),
              ...(dyr.irmaaCost > 0
                ? [
                    `IRMAA: ${formatCurrency(deflate(dyr.irmaaCost, yearRow.year))}/yr surcharge (${dyr.irmaaPaid ? "on top of your budget" : "in your budget"})`,
                  ]
                : []),
              ...(dyr.acaSubsidyPreserved
                ? [
                    `ACA: subsidy preserved (${formatCurrency(deflate(dyr.acaMagiHeadroom, yearRow.year))} headroom)`,
                  ]
                : []),
              ...(!dyr.acaSubsidyPreserved &&
              dyr.acaMagiHeadroom === 0 &&
              (people ?? enginePeople ?? []).every(
                (p) => yearRow.year - p.birthYear < 65,
              )
                ? [`ACA: subsidy lost`]
                : []),
            ]}
            side="left"
            maxWidth={320}
          >
            {/* The "diag" trigger sits on the theme-adaptive page background,
                not the dark popup, so it uses blue-300 (theme-tracking via
                --c-blue-300) rather than tipColorClass. */}
            <span className="ml-1 cursor-help text-blue-300">diag</span>
          </Tooltip>
        )}
        {dyr.warnings.length > 0 && (
          <Tooltip
            content={renderTooltip({
              kind: "info",
              lines: dyr.warnings.map((w) => ({
                text: maskAmountsInText(w),
                style: "note" as const,
              })),
            })}
            side="left"
          >
            <span className="ml-1 text-amber-500">
              {dyr.warnings.length} warning
              {dyr.warnings.length > 1 ? "s" : ""}
            </span>
          </Tooltip>
        )}
      </td>
    </tr>
  );
}
