/** Renders a single decumulation-phase table row with withdrawal breakdowns, tax costs, balance columns, and MC cell. */
import React, { useRef } from "react";
import { useScrollToFocus } from "@/components/ui/focus-target";
import { Tooltip } from "@/components/ui/tooltip";
import { BalanceCell } from "./balance-cell";
import {
  accountTextColor,
  taxTypeTextColor,
  taxTypeLabel,
} from "@/lib/utils/colors";
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
  categoriesWithTaxPreference,
  getAccountTypeConfig,
  ACCOUNT_TYPE_CONFIG,
  isAfterTaxType,
  isPreTaxType,
  isIraCategory,
  isHsaCategory,
  isOverflowTarget,
} from "@/lib/config/account-types";
import { getSegmentBalance } from "@/lib/config/account-balance";
import type { TipColor, TooltipLineItem } from "./types";
import {
  catDisplayLabel,
  bucketSlotMap,
  itemTaxType,
  colKeyParts,
  colBalance,
  colWithdrawal,
  colEngineTaxType,
  slotBucketWithdrawal,
  iaBelongsToBucket,
  percentOf,
  lumpSumsForBucket,
  lumpSumsForCategory,
  lumpSumTotal,
  buildStrategyEventStyle,
  formatDiscretionaryTierBreakdown,
  formatRmdDivisorDetail,
  rowTotal,
} from "./utils";
import type { ProjectionState } from "./projection-table-types";
import {
  renderMcCell,
  type RenderMcCellOptions,
} from "./projection-table-mc-cell";
import { buildFullAccountNote, ownerAccountLabel } from "./account-notes";
import {
  CATEGORY_ORDER,
  categoryWithdrawalItems,
  totalWithdrawalItems,
} from "./projection-table-decum-row.model";

type DecumulationRowProps = {
  /** A link landed on this year — scrolled to and ringed. */
  focused?: boolean;
  yr: EngineDecumulationYear;
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
  mcCellOpts: RenderMcCellOptions;
};

export function DecumulationRow({
  yr: dyr,
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
  mcCellOpts,
}: DecumulationRowProps) {
  const rowRef = useRef<HTMLTableRowElement>(null);
  useScrollToFocus(rowRef, focused);
  const {
    decumOverrides: _decumOverrides,
    balanceView,
    contribView,
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

  // Alias for code extracted from inline — uses `yr` throughout
  const yr = dyr;

  // The household-wide discretionary-capacity paragraph
  // (describeDiscretionaryCapacityMath) is the same text regardless of
  // WHICH roth/brokerage account row triggers it —
  // a household with 1 Roth + 2 brokerage accounts saw it verbatim 3 times
  // in one year. Show it on the first qualifying row only per year (this
  // component renders once per year, so a plain local flag object closed over by
  // the per-account calls below is safe — synchronous, no cross-row state).
  const capacityNote = { shownThisYear: false };

  // Shared by all three withdrawal-by-tax-type/withdrawal-by-account
  // branches below — was the same 6-arg buildFullAccountNote call (incl.
  // the same capacityNote closure) copy-pasted 3x.
  const noteFor = (ia: IndividualAccountYearBalance) =>
    buildFullAccountNote(
      ia,
      yr,
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
  const dpt = getPersonYearTotals(yr);
  const yearLumpSums = dyr.config.lumpSums;
  const totalLumpSum = lumpSumTotal(yearLumpSums);

  // Detect milestone years for row highlighting
  const isSsStartRow =
    result.projectionByYear.find(
      (y) => y.phase === "decumulation" && y.ssIncome > 0,
    )?.year === yr.year;
  const isRmdStartRow =
    result.projectionByYear.find(
      (y) => y.phase === "decumulation" && y.rmdAmount > 0,
    )?.year === yr.year;

  return (
    <tr
      ref={rowRef}
      key={yr.year}
      className={`border-subtle hover:bg-surface-elevated/60 border-b transition-colors ${
        isPhaseTransition
          ? "bg-blue-50 font-medium"
          : hasOverride
            ? "bg-amber-50"
            : yr.retirementBalance < 1
              ? "bg-red-50"
              : isSsStartRow
                ? "bg-teal-50"
                : isRmdStartRow
                  ? "bg-amber-50"
                  : ""
      }`}
    >
      <Tooltip
        content={(() => {
          const pp = people ?? enginePeople;
          if (!pp || pp.length === 0) return undefined;
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
        <td className="py-1.5 pr-2">{yr.year}</td>
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
      {contribView === "account"
        ? getAllCategories()
            .filter((c) => visibleColumns.contribCats.has(c))
            .map((cat) => {
              const dSlot = dSlotMap.get(cat);
              const wd = dSlot?.withdrawal ?? 0;
              // Get growth from individualAccountBalances for this category
              const iabs = yr.individualAccountBalances ?? [];
              const catAccts = dpt
                ? iabs.filter(
                    (ia) =>
                      ia.ownerPersonId === personFilter && ia.category === cat,
                  )
                : iabs.filter((ia) => ia.category === cat);
              const catGrowth = catAccts.reduce((s, ia) => s + ia.growth, 0);
              const catBal = catAccts.reduce((s, ia) => s + ia.balance, 0);
              return (
                <Tooltip
                  key={cat}
                  content={(() => {
                    const dSlot = dSlotMap.get(cat);
                    const catCfg = getAccountTypeConfig(cat);
                    const items = categoryWithdrawalItems(
                      wd,
                      catAccts,
                      catCfg,
                      dSlot,
                      yr,
                      deflate,
                      noteFor,
                    );
                    // Add lump sum items for this category
                    const catLumps = lumpSumsForCategory(yearLumpSums, cat);
                    for (const ls of catLumps) {
                      items.push({
                        label: ls.label ?? "Lump sum",
                        amount: deflate(ls.amount, yr.year),
                        prefix: "+",
                        color: "emerald",
                      });
                    }
                    // RMD-forced excess (beyond stated spending need)
                    // — real money, forced out of Traditional by the RMD
                    // floor regardless of what the strategy needed,
                    // previously invisible anywhere in the UI. What
                    // happened to it depends on the household's
                    // rmdExcessHandling setting: "reinvest" (default)
                    // actually credits this account (overflow target,
                    // always brokerage), so shown as a real "+" line there;
                    // "spend" never credits any account (the household
                    // consumed it), so shown as an informational note
                    // instead, not implied to have landed in this balance.
                    const rmdExcess = yr.rmdExcessAmount ?? 0;
                    const rmdMode = engineSettings?.rmdExcessHandling;
                    if (rmdExcess > 0.01 && isOverflowTarget(cat)) {
                      if (rmdMode === "spend") {
                        items.push({
                          label: "RMD excess spent (not reinvested)",
                          amount: deflate(rmdExcess, yr.year),
                          color: "gray",
                        });
                      } else {
                        items.push({
                          label: "RMD excess reinvested",
                          amount: deflate(rmdExcess, yr.year),
                          prefix: "+",
                          color: "amber",
                        });
                      }
                    }
                    // QCD: money sent from this account to charity, part of
                    // the RMD but not taxable income. Deducted before routing
                    // runs, so no slot line shows it; "ira" only (by law).
                    const qcdAmount = yr.qcdAmount ?? 0;
                    if (qcdAmount > 0.01 && isIraCategory(cat)) {
                      items.push({
                        label: "QCD to charity (excluded from taxable income)",
                        amount: deflate(qcdAmount, yr.year),
                        prefix: "-",
                        color: "violet",
                      });
                    }
                    const catLumpTotal = lumpSumTotal(catLumps);
                    // "Why was this account used" — which source kind(s)
                    // this category's withdrawal drew through in the
                    // cost-ranked discretionary tier (beyond Traditional's
                    // bracket-fill target). A category can match more than
                    // one kind (e.g. a 401k/IRA with both a Roth sub-
                    // balance AND acting as the overflow/brokerage target
                    // is not possible today, but HSA and brokerage never
                    // overlap with "roth") — filtering by source keeps this
                    // scoped to what's actually relevant to THIS account,
                    // not the whole household's breakdown.
                    const catSourceKinds = new Set<
                      "roth" | "brokerage" | "hsa"
                    >();
                    if (catCfg.isOverflowTarget)
                      catSourceKinds.add("brokerage");
                    if (isHsaCategory(cat)) catSourceKinds.add("hsa");
                    if (
                      catCfg.supportsRothSplit &&
                      (dSlot?.rothWithdrawal ?? 0) > 0.01
                    )
                      catSourceKinds.add("roth");
                    const catTierBreakdown =
                      yr.discretionaryTierBreakdown?.filter((t) =>
                        catSourceKinds.has(t.source),
                      );
                    return renderTooltip({
                      kind: "money",
                      header: `${catDisplayLabel[cat] ?? cat}${catLumpTotal > 0 || rmdExcess > 0.01 || qcdAmount > 0.01 ? " Activity" : " Withdrawals"}`,
                      items: items.length > 0 ? items : undefined,
                      withdrawals:
                        wd > 0 && items.length === 0
                          ? {
                              amount: deflate(wd, yr.year),
                            }
                          : undefined,
                      growth:
                        Math.abs(catGrowth) > 1
                          ? {
                              amount: deflate(catGrowth, yr.year),
                            }
                          : undefined,
                      routingNote: formatDiscretionaryTierBreakdown(
                        catTierBreakdown?.map((t) => ({
                          ...t,
                          amount: deflate(t.amount, yr.year),
                        })),
                      ),
                      balance: deflate(catBal, yr.year),
                    });
                  })()}
                  side="top"
                  maxWidth={420}
                >
                  <td
                    className={`px-2 py-1.5 text-right ${(() => {
                      const catLumps = lumpSumsForCategory(yearLumpSums, cat);
                      const catLumpTotal = lumpSumTotal(catLumps);
                      if (catLumpTotal > 0 && catLumpTotal > wd)
                        return "text-green-600";
                      return accountTextColor(cat);
                    })()}`}
                  >
                    {(() => {
                      const catLumps = lumpSumsForCategory(yearLumpSums, cat);
                      const catLumpTotal = lumpSumTotal(catLumps);
                      if (catLumpTotal > 0 && wd > 0) {
                        const net = catLumpTotal - wd;
                        return net >= 0
                          ? `+${formatCurrency(deflate(net, yr.year))}`
                          : `-${formatCurrency(deflate(Math.abs(net), yr.year))}`;
                      }
                      if (catLumpTotal > 0)
                        return `+${formatCurrency(deflate(catLumpTotal, yr.year))}`;
                      if (wd > 0)
                        return `-${formatCurrency(deflate(wd, yr.year))}`;
                      return "---";
                    })()}
                  </td>
                </Tooltip>
              );
            })
        : /* Withdrawal columns by tax type */
          (["preTax", "taxFree", "hsa", "afterTax"] as const)
            .filter((t) => visibleColumns.contribTaxTypes.has(t))
            .map((bucket) => {
              let bucketWd = 0;
              const parts: {
                cat: string;
                wd: number;
              }[] = [];
              for (const slot of dyr.slots) {
                const wd = slotBucketWithdrawal(slot, bucket);
                if (wd > 0) {
                  parts.push({
                    cat: slot.category,
                    wd,
                  });
                  bucketWd += wd;
                }
              }
              // Per-account breakdown (same "why was this account used"
              // reasoning the Account view already shows — see buildNote
              // above) — grouping by tax type shouldn't mean losing it.
              // Falls back to the coarser `parts` aggregate below when no
              // individual-account data exists, same as the Account view.
              const bucketIabsAll = yr.individualAccountBalances ?? [];
              const bucketIabs = (
                dpt
                  ? bucketIabsAll.filter(
                      (ia) => ia.ownerPersonId === personFilter,
                    )
                  : bucketIabsAll
              ).filter((ia) => iaBelongsToBucket(ia, bucket));
              const withdrawingAccts = bucketIabs
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
                      ? (() => {
                          const taxPrefCat = categoriesWithTaxPreference()[0]!;
                          const wdTaxType = bucketSlotMap[bucket]?.taxField
                            ? itemTaxType(
                                taxPrefCat,
                                bucketSlotMap[bucket]!.taxField,
                              )
                            : undefined;
                          const bucketLumps = lumpSumsForBucket(
                            yearLumpSums,
                            bucket,
                          );
                          const multiAcct = withdrawingAccts.length > 1;
                          const allItems = [
                            ...(withdrawingAccts.length > 0
                              ? withdrawingAccts.map((ia) => ({
                                  label: multiAcct
                                    ? ownerAccountLabel(ia)
                                    : (catDisplayLabel[ia.category] ??
                                      ia.category),
                                  amount: deflate(ia.draw!.withdrawal, yr.year),
                                  prefix: "-" as const,
                                  taxType: itemTaxType(ia.category, wdTaxType),
                                  color: "red" as TipColor,
                                  ...noteFor(ia),
                                }))
                              : parts.map((p) => ({
                                  label: catDisplayLabel[p.cat] ?? p.cat,
                                  amount: deflate(p.wd, yr.year),
                                  prefix: "-" as const,
                                  taxType: itemTaxType(p.cat, wdTaxType),
                                  color: "red" as TipColor,
                                }))),
                            ...bucketLumps.map((ls) => ({
                              label: ls.label ?? "Lump sum",
                              amount: deflate(ls.amount, yr.year),
                              prefix: "+" as const,
                              color: "emerald" as TipColor,
                            })),
                          ];
                          const bucketLumpTotal = lumpSumTotal(bucketLumps);
                          return renderTooltip({
                            kind: "money",
                            header: `${taxTypeLabel(bucket)}${bucketLumpTotal > 0 ? " Activity" : " Withdrawals"}`,
                            items: allItems,
                            total:
                              allItems.length > 1
                                ? {
                                    label: "Net",
                                    amount: deflate(
                                      bucketLumpTotal - bucketWd,
                                      yr.year,
                                    ),
                                    prefix:
                                      bucketLumpTotal >= bucketWd ? "+" : "-",
                                  }
                                : undefined,
                          });
                        })()
                      : (() => {
                          const bucketLumps = lumpSumsForBucket(
                            yearLumpSums,
                            bucket,
                          );
                          if (bucketLumps.length === 0) return undefined;
                          return renderTooltip({
                            kind: "money",
                            header: `${taxTypeLabel(bucket)} Lump Sum`,
                            items: bucketLumps.map((ls) => ({
                              label: ls.label ?? "Lump sum",
                              amount: deflate(ls.amount, yr.year),
                              prefix: "+" as const,
                              color: "emerald" as TipColor,
                            })),
                          });
                        })()
                  }
                  side="top"
                >
                  <td
                    className={`px-2 py-1.5 text-right ${(() => {
                      const bucketLumps = lumpSumsForBucket(
                        yearLumpSums,
                        bucket,
                      );
                      const bucketLumpTotal = lumpSumTotal(bucketLumps);
                      if (bucketLumpTotal > 0 && bucketLumpTotal > bucketWd)
                        return "text-green-600";
                      return taxTypeTextColor(bucket);
                    })()}`}
                  >
                    {(() => {
                      const bucketLumps = lumpSumsForBucket(
                        yearLumpSums,
                        bucket,
                      );
                      const bucketLumpTotal = lumpSumTotal(bucketLumps);
                      if (bucketLumpTotal > 0 && bucketWd > 0) {
                        const net = bucketLumpTotal - bucketWd;
                        return net >= 0
                          ? `+${formatCurrency(deflate(net, yr.year))}`
                          : `-${formatCurrency(deflate(Math.abs(net), yr.year))}`;
                      }
                      if (bucketLumpTotal > 0)
                        return `+${formatCurrency(deflate(bucketLumpTotal, yr.year))}`;
                      if (bucketWd > 0)
                        return `-${formatCurrency(deflate(bucketWd, yr.year))}`;
                      return "---";
                    })()}
                  </td>
                </Tooltip>
              );
            })}
      <Tooltip
        content={(() => {
          const iabs = yr.individualAccountBalances ?? [];
          const filteredIabs = dpt
            ? iabs.filter((ia) => ia.ownerPersonId === personFilter)
            : iabs;
          const items = totalWithdrawalItems(
            dyr,
            yr,
            filteredIabs,
            dSlotMap,
            yearLumpSums,
            deflate,
            noteFor,
          );
          const totalGrowth = filteredIabs.reduce((s, ia) => s + ia.growth, 0);
          const decBudgetProfile =
            decumulationBudgetProfileId != null
              ? budgetProfileSummaries?.find(
                  (p) => p.id === decumulationBudgetProfileId,
                )
              : undefined;
          const budgetProfileName =
            decumulationExpenseOverride != null
              ? `Set for this year${dyr.hasBudgetOverride && budgetOverrideNotes ? ` (${budgetOverrideNotes})` : ""}`
              : decBudgetProfile
                ? `${decBudgetProfile.name}${decumulationBudgetColumn != null && decBudgetProfile.columnLabels[decumulationBudgetColumn] ? ` (${decBudgetProfile.columnLabels[decumulationBudgetColumn]})` : ""}${dyr.hasBudgetOverride && budgetOverrideNotes ? ` (${budgetOverrideNotes})` : ""}`
                : undefined;
          // SS/RMD context for withdrawal tooltip
          const hasSs = dyr.ssIncome > 0;
          const hasRmd = dyr.rmdAmount > 0;
          const ssBreakdown = dyr.ssIncomeByPerson?.filter((e) => e.amount > 0);
          const ssDetail =
            ssBreakdown && ssBreakdown.length > 1
              ? ssBreakdown
                  .map(
                    (e) =>
                      `${e.personName}: ${formatCurrency(deflate(e.amount, yr.year))}`,
                  )
                  .join(", ")
              : null;
          const ssMeta = isSsStartRow
            ? `Social Security begins — ${formatCurrency(deflate(dyr.ssIncome, yr.year))}/yr${ssDetail ? ` (${ssDetail})` : ""}`
            : hasSs
              ? `Incl. SS income — ${formatCurrency(deflate(dyr.ssIncome, yr.year))}/yr${ssDetail ? ` (${ssDetail})` : ""}`
              : undefined;
          // Full satisfaction status (checkmark/shortfall/
          // excess wording), not just the bare amount — parity with the
          // chart tooltip's rmd block (see tooltip-renderer.tsx). Checkmark
          // shows whenever the RMD was actually met, not just the notable
          // excess/QCD case — silence isn't a reliable enough signal of
          // "satisfied" on its own.
          const rmdShortfallAmount = dyr.rmdShortfallAmount ?? 0;
          const rmdExcessAmount = dyr.rmdExcessAmount ?? 0;
          const rmdSatisfied = rmdShortfallAmount <= 0;
          return renderTooltip({
            kind: "money",
            header: "Total Withdrawals",
            meta: ssMeta,
            shortfall: dyr.unmetNeedMaterial
              ? {
                  amount: deflate(dyr.unmetNeed ?? 0, yr.year),
                  nonRetirementAmount:
                    (dyr.nonRetirementShortfall ?? 0) > 0
                      ? deflate(dyr.nonRetirementShortfall!, yr.year)
                      : undefined,
                  penaltyAvoidedAmount:
                    (dyr.penaltyAvoidedShortfall ?? 0) > 0
                      ? deflate(dyr.penaltyAvoidedShortfall!, yr.year)
                      : undefined,
                }
              : undefined,
            rmd: hasRmd
              ? {
                  amount: deflate(dyr.rmdAmount, yr.year),
                  isStartYear: isRmdStartRow,
                  satisfiedNotably: rmdSatisfied,
                  shortfallAmount: deflate(rmdShortfallAmount, yr.year),
                  excessAmount: deflate(rmdExcessAmount, yr.year),
                  excessMode:
                    engineSettings?.rmdExcessHandling === "spend"
                      ? "spend"
                      : "reinvest",
                  qcdAmount:
                    (dyr.qcdAmount ?? 0) > 0
                      ? deflate(dyr.qcdAmount!, yr.year)
                      : undefined,
                  divisorDetail: formatRmdDivisorDetail(dyr, deflate, yr.year),
                }
              : undefined,
            strategyEvent: (() => {
              if (!dyr.strategyAction) return undefined;
              const style =
                buildStrategyEventStyle(engineSettings)[dyr.strategyAction];
              return style
                ? { color: style.color, text: style.tooltipText }
                : undefined;
            })(),
            items: items.length > 0 ? items : undefined,
            growth:
              Math.abs(totalGrowth) > 1
                ? {
                    amount: deflate(totalGrowth, yr.year),
                  }
                : undefined,
            withdrawals:
              dyr.taxCost > 0
                ? {
                    amount: deflate(dyr.totalWithdrawal, yr.year),
                    taxCost: deflate(dyr.taxCost, yr.year),
                  }
                : undefined,
            // A withdrawal-sized year isn't driven by the budget.
            budget:
              budgetProfileName && !dyr.withdrawalSized
                ? {
                    profile: budgetProfileName,
                    amount: deflate(dyr.projectedExpenses, yr.year),
                  }
                : undefined,
            overrideNote: decumOverrideNotes
              ? `Changed this year: ${decumOverrideNotes}`
              : undefined,
          });
        })()}
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
          {(() => {
            const net = deflate(totalLumpSum - dyr.totalWithdrawal, yr.year);
            if (totalLumpSum > 0 && dyr.totalWithdrawal > 0) {
              return net >= 0
                ? `+${formatCurrency(net)}`
                : `-${formatCurrency(Math.abs(net))}`;
            }
            if (totalLumpSum > 0) {
              return `+${formatCurrency(deflate(totalLumpSum, yr.year))}`;
            }
            if (dyr.totalWithdrawal > 0) {
              return `-${formatCurrency(deflate(dyr.totalWithdrawal, yr.year))}`;
            }
            return dyr.retirementBalance < 1 && dyr.projectedExpenses > 0
              ? "depleted"
              : "---";
          })()}
        </td>
      </Tooltip>
      {balanceView === "taxType" ? (
        (["preTax", "taxFree", "hsa", "afterTax"] as const)
          .filter((t) => visibleColumns.balanceTaxTypes.has(t))
          .map((bucket) => {
            const bal = dpt
              ? dpt.byTaxType[bucket]
              : yr.balanceByTaxType[bucket];
            const dptTotal = dpt ? dpt.balance : rowTotal(yr);
            const pct = percentOf(bal, dptTotal);
            // Compute growth for this tax bucket from individualAccountBalances
            const bucketIabs = yr.individualAccountBalances ?? [];
            const bucketAccts = (
              dpt
                ? bucketIabs.filter((ia) => ia.ownerPersonId === personFilter)
                : bucketIabs
            ).filter((ia) => iaBelongsToBucket(ia, bucket));
            const bucketGrowth = bucketAccts.reduce(
              (s, ia) => s + ia.growth,
              0,
            );
            return (
              <BalanceCell
                key={bucket}
                amount={deflate(bal, yr.year)}
                color={taxTypeTextColor(bucket)}
                tooltip={(() => {
                  const wdLineItems: TooltipLineItem[] = [];
                  // Per-account items in BOTH household and person-filtered
                  // views — previously the household view fell back to a
                  // per-CATEGORY slot aggregate here, collapsing e.g. two
                  // people's separate 401ks into one line, while the
                  // Balance-by-Account view always broke it out per account.
                  const multiAcctBucket = bucketAccts.length > 1;
                  if (bucketAccts.length > 0) {
                    const bucketTaxField = bucketSlotMap[bucket]?.taxField;
                    for (const ia of bucketAccts) {
                      const wd = ia.draw?.withdrawal ?? 0;
                      if (wd > 0) {
                        wdLineItems.push({
                          label: multiAcctBucket
                            ? ownerAccountLabel(ia)
                            : (catDisplayLabel[ia.category] ?? ia.category),
                          amount: deflate(wd, yr.year),
                          prefix: "-",
                          taxType: bucketTaxField
                            ? itemTaxType(ia.category, bucketTaxField)
                            : undefined,
                          color: "red",
                        });
                      }
                    }
                  } else if (!dpt) {
                    // Fallback when no individual-account data exists.
                    const bucketTaxField = bucketSlotMap[bucket]?.taxField;
                    for (const slot of dyr.slots) {
                      const wd = slotBucketWithdrawal(slot, bucket);
                      if (wd > 0) {
                        wdLineItems.push({
                          label:
                            catDisplayLabel[slot.category] ?? slot.category,
                          amount: deflate(wd, yr.year),
                          prefix: "-",
                          taxType: bucketTaxField
                            ? itemTaxType(slot.category, bucketTaxField)
                            : undefined,
                          color: "red",
                        });
                      }
                    }
                  }
                  // Add lump sum items for this bucket
                  const bucketLumps = lumpSumsForBucket(yearLumpSums, bucket);
                  for (const ls of bucketLumps) {
                    wdLineItems.push({
                      label: ls.label ?? "Lump sum",
                      amount: deflate(ls.amount, yr.year),
                      prefix: "+",
                      color: "emerald",
                    });
                  }
                  // Same RMD-excess / QCD visibility as the
                  // contribution-view tooltips (the
                  // BALANCE tooltip needs to explain its own number too,
                  // not just the contribution/withdrawal column). afterTax
                  // is where reinvested excess actually lands (or would
                  // have, under "spend"); preTax is where QCD money left
                  // from.
                  const bucketRmdExcess = yr.rmdExcessAmount ?? 0;
                  const bucketRmdMode = engineSettings?.rmdExcessHandling;
                  if (isAfterTaxType(bucket) && bucketRmdExcess > 0.01) {
                    if (bucketRmdMode === "spend") {
                      wdLineItems.push({
                        label: "RMD excess spent (not reinvested)",
                        amount: deflate(bucketRmdExcess, yr.year),
                        color: "gray",
                      });
                    } else {
                      wdLineItems.push({
                        label: "RMD excess reinvested",
                        amount: deflate(bucketRmdExcess, yr.year),
                        prefix: "+",
                        color: "amber",
                      });
                    }
                  }
                  const bucketQcd = yr.qcdAmount ?? 0;
                  if (isPreTaxType(bucket) && bucketQcd > 0.01) {
                    wdLineItems.push({
                      label: "QCD to charity (excluded from taxable income)",
                      amount: deflate(bucketQcd, yr.year),
                      prefix: "-",
                      color: "violet",
                    });
                  }
                  return renderTooltip({
                    kind: "money",
                    header: `${taxTypeLabel(bucket)}: ${pct}% of portfolio`,
                    meta: `${yr.year} · ${formatPercent(yr.returnRate, 1)} return`,
                    items: wdLineItems.length > 0 ? wdLineItems : undefined,
                    growth:
                      Math.abs(bucketGrowth) > 1
                        ? {
                            amount: deflate(bucketGrowth, yr.year),
                          }
                        : undefined,
                  });
                })()}
              />
            );
          })
      ) : (
        <>
          {getAccountSegments()
            .map((seg) => ({
              key: seg.key,
              val: getSegmentBalance(yr.balanceByAccount, seg),
              color: accountTextColor(seg.category),
              label: seg.label,
            }))
            .filter((col) => visibleColumns.balanceAccts.has(col.key))
            .map((col) => {
              const catKey = colKeyParts(col.key).category;
              const bal = dpt ? (dpt.byAccount[col.key] ?? 0) : col.val;
              const dptTotalBal = dpt ? dpt.balance : rowTotal(yr);
              const pct = percentOf(bal, dptTotalBal);
              // Compute authoritative total change from engine
              const decPrevYr = result.projectionByYear.find(
                (y) => y.year === yr.year - 1,
              );
              const decPrevPt = decPrevYr
                ? getPersonYearTotals(decPrevYr)
                : null;
              const decPrevVal = decPrevYr
                ? decPrevPt
                  ? (decPrevPt.byAccount[col.key] ?? 0)
                  : colBalance(decPrevYr.balanceByAccount, col.key)
                : 0;
              // Build account items as data
              const decAcctItems: TooltipLineItem[] = [];
              const decColTaxType = colEngineTaxType(col.key);
              // Use engine's individualAccountBalances
              const decIabs = (yr.individualAccountBalances ?? []).filter(
                (ia) =>
                  ia.category === catKey &&
                  (decColTaxType == null || ia.taxType === decColTaxType) &&
                  (!isPersonFiltered || ia.ownerPersonId === personFilter),
              );
              {
                // Compute from balance changes — data-driven, no routing layers
                const _decPrevIabs = decPrevYr?.individualAccountBalances ?? [];
                const seenDecAccts = new Set<string>();
                const decSplits: {
                  name: string;
                  entryTaxType: string;
                  balance: number;
                  growth: number;
                  withdrawal: number;
                }[] = [];
                for (const ia of decIabs) {
                  const dk = `${catKey}-${ia.name}-${ia.taxType}`;
                  if (seenDecAccts.has(dk)) continue;
                  seenDecAccts.add(dk);
                  decSplits.push({
                    name: ia.name,
                    entryTaxType: ia.taxType,
                    balance: ia.balance,
                    growth: ia.growth,
                    withdrawal: ia.draw?.withdrawal ?? 0,
                  });
                }
                const splitsTotal = decSplits.reduce(
                  (s, e) => s + e.balance,
                  0,
                );
                for (const {
                  name: acctName,
                  entryTaxType,
                  balance: spBal,
                  growth: spGrowth,
                } of decSplits) {
                  const frac = safeDivide(spBal, splitsTotal, 0);
                  const subItems: TooltipLineItem[] = [];
                  if (Math.abs(spGrowth) > 1)
                    subItems.push({
                      label: "growth",
                      amount: deflate(spGrowth, yr.year),
                      prefix: spGrowth >= 0 ? "+" : undefined,
                      color: spGrowth >= 0 ? "blue" : "red",
                    });
                  decAcctItems.push({
                    label: acctName,
                    amount: deflate(Math.max(0, spBal), yr.year),
                    percent: Math.round(frac * 100),
                    taxType: itemTaxType(catKey, entryTaxType),
                    sub: subItems.length > 0 ? subItems : undefined,
                  });
                }
              }
              // Same RMD-excess / QCD visibility as the taxType-view
              // balance tooltips and the contribution-view tooltips —
              // gated on the account-view column's own category rather
              // than a fixed bucket, so this fires no matter which
              // overflow/IRA-category column the segment maps to.
              const colRmdExcess = yr.rmdExcessAmount ?? 0;
              const colRmdMode = engineSettings?.rmdExcessHandling;
              if (
                colRmdExcess > 0.01 &&
                isOverflowTarget(catKey as AccountCategory)
              ) {
                if (colRmdMode === "spend") {
                  decAcctItems.push({
                    label: "RMD excess spent (not reinvested)",
                    amount: deflate(colRmdExcess, yr.year),
                    color: "gray",
                  });
                } else {
                  decAcctItems.push({
                    label: "RMD excess reinvested",
                    amount: deflate(colRmdExcess, yr.year),
                    prefix: "+",
                    color: "amber",
                  });
                }
              }
              const colQcd = yr.qcdAmount ?? 0;
              if (colQcd > 0.01 && isIraCategory(catKey)) {
                decAcctItems.push({
                  label: "QCD to charity (excluded from taxable income)",
                  amount: deflate(colQcd, yr.year),
                  prefix: "-",
                  color: "violet",
                });
              }
              // Calculate total withdrawal from slot data (data-driven via colWithdrawal)
              const decTotalWd = colWithdrawal(dyr.slots, col.key);
              // Sum growth from engine's individual account balances for this column
              const decSplitGrowth = decIabs.reduce(
                (s, ia) => s + ia.growth,
                0,
              );
              const decDeflatedBal = deflate(bal, yr.year);
              const decDeflatedPrev = decPrevYr
                ? deflate(decPrevVal, decPrevYr.year)
                : 0;
              const decDisplayChange = decPrevYr
                ? decDeflatedBal - decDeflatedPrev
                : deflate(decSplitGrowth - decTotalWd, yr.year);
              const decDisplayWd = deflate(decTotalWd, yr.year);
              const decDisplayGrowth = deflate(decSplitGrowth, yr.year);
              const decBoyBal = decPrevYr
                ? decDeflatedPrev
                : deflate(bal - decSplitGrowth + decTotalWd, yr.year);
              const decChangeParts: {
                label: string;
                amount: number;
                color: TipColor;
              }[] = [];
              if (Math.abs(decDisplayGrowth) > 1)
                decChangeParts.push({
                  label: "growth",
                  amount: decDisplayGrowth,
                  color: decDisplayGrowth >= 0 ? "blue" : "red",
                });
              if (decDisplayWd > 0)
                decChangeParts.push({
                  label: "withdrawn",
                  amount: -decDisplayWd,
                  color: "red",
                });
              return (
                <BalanceCell
                  key={col.key}
                  amount={deflate(bal, yr.year)}
                  color={col.color}
                  tooltip={renderTooltip({
                    kind: "money",
                    header: `${col.label}: ${pct}% of portfolio`,
                    meta: `${yr.year} · BoY: ${formatCurrency(decBoyBal)} → EoY: ${formatCurrency(decDeflatedBal)} · ${formatPercent(yr.returnRate, 1)} return`,
                    items: decAcctItems.length > 0 ? decAcctItems : undefined,
                    withdrawals:
                      decDisplayWd > 0 ? { amount: decDisplayWd } : undefined,
                    yearChange: {
                      total: decDeflatedBal,
                      change: decDisplayChange,
                      parts:
                        decChangeParts.length > 0 ? decChangeParts : undefined,
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
        content={(() => {
          const tb = dpt ? dpt.balance : rowTotal(yr);
          const iabs = yr.individualAccountBalances ?? [];
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
            const bVal = dpt ? dpt.byTaxType[b] : yr.balanceByTaxType[b];
            return {
              label: taxTypeLabel(b),
              amount: deflate(bVal, yr.year),
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
                    amount: deflate(totalGrowth, yr.year),
                  }
                : undefined,
          });
        })()}
        side="top"
      >
        <td className="px-2 py-1.5 text-right font-semibold">
          {formatCurrency(
            Math.max(0, deflate(dpt ? dpt.balance : rowTotal(yr), yr.year)),
          )}
        </td>
      </Tooltip>
      {renderMcCell(
        yr,
        deflate(dpt ? dpt.balance : rowTotal(yr), yr.year),
        mcCellOpts,
      )}
      <td className="text-caption text-faint border-subtle border-l py-1.5 pl-2 whitespace-nowrap">
        {dyr.taxCost > 0 && (
          <Tooltip
            content="Eff. rate = tax on the withdrawal / total withdrawal (tax on Social Security is shown apart). Traditional: marginal rate. Brokerage: LTCG rate. Roth growth beyond basis: ordinary rate. Once at the bracket cap, the engine picks whichever's cheaper that year."
            side="left"
            maxWidth={240}
          >
            <span className="text-red-400">
              ~{formatCurrency(deflate(dyr.taxCost - dyr.ssTaxCost, yr.year))}{" "}
              tax ({formatPercent(dyr.effectiveTaxRate, 1)} eff.)
              {dyr.ssTaxCost > 0 && (
                <>
                  {" "}
                  + {formatCurrency(deflate(dyr.ssTaxCost, yr.year))} on Social
                  Security
                </>
              )}
            </span>
          </Tooltip>
        )}
        {diagMode && dyr.grossUpFactor != null && (
          <Tooltip
            lines={[
              dyr.withdrawalSized
                ? `Strategy withdrawal: ${formatCurrency(deflate(dyr.projectedExpenses, yr.year))} (Social Security on top)`
                : `Expenses: ${formatCurrency(deflate(dyr.projectedExpenses, yr.year))}`,
              `SS Income: ${formatCurrency(deflate(dyr.ssIncome ?? 0, yr.year))}`,
              `Spending: ${formatCurrency(deflate(dyr.spending, yr.year))} (after tax, Social Security included)`,
              `After-tax need: ${formatCurrency(deflate(dyr.afterTaxNeed ?? 0, yr.year))}`,
              `Tax rate: ${formatPercent(dyr.effectiveTaxRate, 2)} (trad ${formatPercent(dyr.estTraditionalPortion ?? 0, 0)} of retirement money)`,
              ...(dyr.ssTaxCost > 0
                ? [
                    `Tax on Social Security: ${formatCurrency(deflate(dyr.ssTaxCost, yr.year))} (not in the rate)`,
                  ]
                : []),
              `Gross-up: ×${(dyr.grossUpFactor ?? 1).toFixed(3)}`,
              `Target withdrawal: ${formatCurrency(deflate(dyr.targetWithdrawal, yr.year))}`,
              `Actual withdrawal: ${formatCurrency(deflate(dyr.totalWithdrawal, yr.year))}`,
              ...(dyr.bracketTraditionalCap != null
                ? [
                    `Bracket trad cap: ${formatCurrency(deflate(dyr.bracketTraditionalCap, yr.year))}`,
                  ]
                : []),
              ...(dyr.unmetNeed != null && dyr.unmetNeed > 0
                ? [
                    `UNMET NEED: ${formatCurrency(deflate(dyr.unmetNeed, yr.year))}`,
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
                      const bal =
                        dyr.preWithdrawalAcctBal![c as AccountCategory];
                      return bal && "roth" in bal
                        ? // eslint-disable-next-line no-restricted-syntax -- type narrowing for untyped API response
                          ` ${c} pre-wd: trad=${formatCurrency(deflate((bal as unknown as Record<string, number>).traditional ?? 0, yr.year))}, roth=${formatCurrency(deflate((bal as unknown as Record<string, number>).roth ?? 0, yr.year))}`
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
                ? [`Strategy: ${dyr.strategyAction}`]
                : []),
              ...(dyr.irmaaCost > 0
                ? [
                    `IRMAA: ${formatCurrency(deflate(dyr.irmaaCost, yr.year))}/yr surcharge (${dyr.irmaaPaid ? "on top of your budget" : "in your budget"})`,
                  ]
                : []),
              ...(dyr.acaSubsidyPreserved
                ? [
                    `ACA: subsidy preserved (${formatCurrency(deflate(dyr.acaMagiHeadroom, yr.year))} headroom)`,
                  ]
                : []),
              ...(!dyr.acaSubsidyPreserved &&
              dyr.acaMagiHeadroom === 0 &&
              (people ?? enginePeople ?? []).every(
                (p) => yr.year - p.birthYear < 65,
              )
                ? [`ACA: subsidy lost`]
                : []),
            ]}
            side="left"
            maxWidth={320}
          >
            {/* This "diag" label is the Tooltip's TRIGGER, rendered on the
                page's own (theme-adaptive) background — NOT inside the
                tooltip's always-dark popup content. blue-300 has a real
                --c-blue-300 override (globals.css) and correctly tracks
                page theme here, unlike tipColorClass's shades (used for
                text INSIDE the dark popup, see retirement-projection/utils.ts). */}
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
