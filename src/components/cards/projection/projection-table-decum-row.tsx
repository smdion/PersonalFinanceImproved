/** Renders a single decumulation-phase table row with withdrawal breakdowns, tax costs, balance columns, and MC cell. */
import React from "react";
import { Tooltip } from "@/components/ui/tooltip";
import {
  accountTextColor,
  taxTypeTextColor,
  taxTypeLabel,
} from "@/lib/utils/colors";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import type {
  AccountCategory,
  EngineDecumulationYear,
  DecumulationSlot,
} from "@/lib/calculators/types";
import {
  type AccountCategory as AcctCat,
  getAccountSegments,
  getSegmentBalance,
  getAllCategories,
  categoriesWithTaxPreference,
  getAccountTypeConfig,
  ACCOUNT_TYPE_CONFIG,
} from "@/lib/config/account-types";
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
  pctOf,
} from "./utils";
import type { ProjectionState } from "./projection-table-types";
import {
  renderMcCell,
  type RenderMcCellOptions,
} from "./projection-table-mc-cell";

export type DecumulationRowProps = {
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
  state: s,
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
    displayAge,
    renderTooltip,
    enginePeople,
    engineSettings,
    withdrawalRoutingMode: _withdrawalRoutingMode,
    budgetProfileSummaries,
    result,
  } = s;
  if (!result) return null;

  // Alias for code extracted from inline — uses `yr` throughout
  const yr = dyr;

  const dSlotMap = new Map<AccountCategory, DecumulationSlot>(
    dyr.slots.map((s) => [s.category, s]),
  );
  const dpt = getPersonYearTotals(yr);

  // Detect milestone years for row highlighting
  const ssAge = engineSettings?.ssStartAge;
  const isSsStartRow = ssAge != null && yr.age === ssAge && dyr.ssIncome > 0;
  const firstRmdAge = result.projectionByYear.find(
    (y) => y.phase === "decumulation" && y.rmdAmount > 0,
  )?.age;
  const isRmdStartRow =
    firstRmdAge != null && yr.age === firstRmdAge && dyr.rmdAmount > 0;

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
              : isSsStartRow
                ? "bg-teal-50"
                : isRmdStartRow
                  ? "bg-amber-50"
                  : ""
      }`}
    >
      <td className="py-1.5 pr-2">{yr.year}</td>
      <Tooltip
        content={(() => {
          const pp = people ?? enginePeople;
          if (!pp || pp.length < 2) return undefined;
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
        <td className="py-1.5 px-2">{displayAge(yr.year) ?? yr.age}</td>
      </Tooltip>
      <td className="py-1.5 px-2">
        <span className="text-amber-600 text-[10px] font-medium">DRAW</span>
      </td>
      <Tooltip content="No salary income during retirement" side="top">
        <td className="text-right py-1.5 px-2 text-faint">---</td>
      </Tooltip>
      <Tooltip content="No contribution rate during retirement" side="top">
        <td className="text-right py-1.5 px-2 text-faint">---</td>
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
                    const items: TooltipLineItem[] = [];
                    const catCfg = getAccountTypeConfig(cat);
                    if (
                      wd > 0 &&
                      catCfg.supportsRothSplit &&
                      dSlot &&
                      (dSlot.traditionalWithdrawal > 0 ||
                        dSlot.rothWithdrawal > 0)
                    ) {
                      if (dSlot.traditionalWithdrawal > 0)
                        items.push({
                          label: catCfg.displayLabel,
                          amount: deflate(dSlot.traditionalWithdrawal, yr.year),
                          prefix: "-",
                          taxType: "traditional",
                          color: "red",
                        });
                      if (dSlot.rothWithdrawal > 0)
                        items.push({
                          label: catCfg.displayLabel,
                          amount: deflate(dSlot.rothWithdrawal, yr.year),
                          prefix: "-",
                          taxType: "roth",
                          color: "red",
                        });
                    }
                    return renderTooltip({
                      kind: "money",
                      header: `${catDisplayLabel[cat] ?? cat} Withdrawals`,
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
                      balance: deflate(catBal, yr.year),
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
                          return renderTooltip({
                            kind: "money",
                            header: `${taxTypeLabel(bucket)} Withdrawals`,
                            items: parts.map((p) => ({
                              label: catDisplayLabel[p.cat] ?? p.cat,
                              amount: deflate(p.wd, yr.year),
                              prefix: "-" as const,
                              taxType: itemTaxType(p.cat, wdTaxType),
                              color: "red" as TipColor,
                            })),
                            total:
                              parts.length > 1
                                ? {
                                    label: "Total",
                                    amount: deflate(bucketWd, yr.year),
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
                amount: deflate(dyr.totalTraditionalWithdrawal, yr.year),
                prefix: "-",
                color: "blue",
              });
            if (dyr.totalRothWithdrawal > 0)
              items.push({
                label: taxTypeLabel("taxFree"),
                amount: deflate(dyr.totalRothWithdrawal, yr.year),
                prefix: "-",
                color: "violet",
              });
            for (const sbCat of getAllCategories().filter(
              (c) => !ACCOUNT_TYPE_CONFIG[c].supportsRothSplit,
            )) {
              const sbWd = dSlotMap.get(sbCat)?.withdrawal ?? 0;
              if (sbWd > 0)
                items.push({
                  label: getAccountTypeConfig(sbCat).displayLabel,
                  amount: deflate(sbWd, yr.year),
                  prefix: "-",
                  color:
                    sbCat ===
                    getAllCategories().find(
                      (c) => ACCOUNT_TYPE_CONFIG[c].isOverflowTarget,
                    )
                      ? "amber"
                      : "emerald",
                });
            }
          }
          const iabs = yr.individualAccountBalances ?? [];
          const totalGrowth = (
            dpt ? iabs.filter((ia) => ia.ownerPersonId === personFilter) : iabs
          ).reduce((s, ia) => s + ia.growth, 0);
          const decBudgetProfile =
            decumulationBudgetProfileId != null
              ? budgetProfileSummaries?.find(
                  (p) => p.id === decumulationBudgetProfileId,
                )
              : undefined;
          const budgetProfileName =
            decumulationExpenseOverride != null
              ? `Manual override${dyr.hasBudgetOverride && budgetOverrideNotes ? ` (${budgetOverrideNotes})` : ""}`
              : decBudgetProfile
                ? `${decBudgetProfile.name}${decumulationBudgetColumn != null && decBudgetProfile.columnLabels[decumulationBudgetColumn] ? ` (${decBudgetProfile.columnLabels[decumulationBudgetColumn]})` : ""}${dyr.hasBudgetOverride && budgetOverrideNotes ? ` (${budgetOverrideNotes})` : ""}`
                : undefined;
          // SS/RMD context for withdrawal tooltip
          const hasSs = dyr.ssIncome > 0;
          const hasRmd = dyr.rmdAmount > 0;
          const ssMeta = isSsStartRow
            ? `Social Security begins — ${formatCurrency(deflate(dyr.ssIncome, yr.year))}/yr`
            : hasSs
              ? `Incl. SS income — ${formatCurrency(deflate(dyr.ssIncome, yr.year))}/yr`
              : undefined;
          const rmdMeta = isRmdStartRow
            ? `RMDs begin — ${formatCurrency(deflate(dyr.rmdAmount, yr.year))} required`
            : hasRmd
              ? `RMD: ${formatCurrency(deflate(dyr.rmdAmount, yr.year))}`
              : undefined;
          return renderTooltip({
            kind: "money",
            header: "Total Withdrawals",
            meta: ssMeta,
            meta2: rmdMeta,
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
            budget: budgetProfileName
              ? {
                  profile: budgetProfileName,
                  amount: deflate(dyr.projectedExpenses, yr.year),
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
            dyr.totalWithdrawal < dyr.targetWithdrawal
              ? "text-amber-500"
              : dyr.totalWithdrawal > 0
                ? "text-red-600"
                : dyr.endBalance < 1 && dyr.projectedExpenses > 0
                  ? "text-red-400 italic"
                  : "text-muted"
          }`}
        >
          {dyr.totalWithdrawal > 0
            ? `-${formatCurrency(deflate(dyr.totalWithdrawal, yr.year))}`
            : dyr.endBalance < 1 && dyr.projectedExpenses > 0
              ? "depleted"
              : "---"}
        </td>
      </Tooltip>
      {balanceView === "taxType" ? (
        (["preTax", "taxFree", "hsa", "afterTax"] as const)
          .filter((t) => visibleColumns.balanceTaxTypes.has(t))
          .map((bucket) => {
            const bal = dpt
              ? dpt.byTaxType[bucket]
              : yr.balanceByTaxType[bucket];
            const dptTotal = dpt ? dpt.balance : yr.endBalance;
            const pct = pctOf(bal, dptTotal);
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
              <Tooltip
                key={bucket}
                content={(() => {
                  const wdLineItems: TooltipLineItem[] = [];
                  if (!dpt) {
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
                  } else {
                    // Person-filtered: show per-account withdrawals from individual account data
                    for (const ia of bucketAccts) {
                      const wd = ia.withdrawal ?? 0;
                      if (wd > 0) {
                        wdLineItems.push({
                          label: ia.name,
                          amount: deflate(wd, yr.year),
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
                    items: wdLineItems.length > 0 ? wdLineItems : undefined,
                    growth:
                      Math.abs(bucketGrowth) > 1
                        ? {
                            amount: deflate(bucketGrowth, yr.year),
                          }
                        : undefined,
                  });
                })()}
                side="top"
              >
                <td
                  className={`text-right py-1.5 px-2 ${taxTypeTextColor(bucket)}`}
                >
                  {formatCurrency(deflate(bal, yr.year))}
                </td>
              </Tooltip>
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
              const dptTotalBal = dpt ? dpt.balance : yr.endBalance;
              const pct = pctOf(bal, dptTotalBal);
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
                    withdrawal: ia.withdrawal ?? 0,
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
                  const frac = splitsTotal > 0 ? spBal / splitsTotal : 0;
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
                    pct: Math.round(frac * 100),
                    taxType: itemTaxType(catKey, entryTaxType),
                    sub: subItems.length > 0 ? subItems : undefined,
                  });
                }
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
                <Tooltip
                  key={col.key}
                  content={renderTooltip({
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
                  side="top"
                >
                  <td className={`text-right py-1.5 px-2 ${col.color}`}>
                    {formatCurrency(deflate(bal, yr.year))}
                  </td>
                </Tooltip>
              );
            })}
        </>
      )}
      <Tooltip
        content={(() => {
          const tb = dpt ? dpt.balance : yr.endBalance;
          const iabs = yr.individualAccountBalances ?? [];
          const totalGrowth = (
            dpt ? iabs.filter((ia) => ia.ownerPersonId === personFilter) : iabs
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
            ["preTax", "taxFree", "hsa", "afterTax"] as const
          ).map((b) => {
            const bVal = dpt ? dpt.byTaxType[b] : yr.balanceByTaxType[b];
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
                    amount: deflate(totalGrowth, yr.year),
                  }
                : undefined,
          });
        })()}
        side="top"
      >
        <td className="text-right py-1.5 px-2 font-semibold">
          {formatCurrency(
            Math.max(0, deflate(dpt ? dpt.balance : yr.endBalance, yr.year)),
          )}
        </td>
      </Tooltip>
      {renderMcCell(
        yr,
        deflate(dpt ? dpt.balance : yr.endBalance, yr.year),
        mcCellOpts,
      )}
      <td className="py-1.5 pl-2 text-[10px] text-faint whitespace-nowrap border-l border-subtle">
        {dyr.taxCost > 0 && (
          <Tooltip
            content="Effective tax rate = total tax / total withdrawal. Traditional taxed at marginal rate, Brokerage at LTCG rate, Roth/HSA tax-free."
            side="left"
            maxWidth={240}
          >
            <span className="text-red-400">
              ~{formatCurrency(deflate(dyr.taxCost, yr.year))}
              {""}
              tax ({formatPercent(dyr.effectiveTaxRate, 1)}
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
              dyr.totalWithdrawal < dyr.projectedExpenses
                ? [
                    `SHORTFALL: ${formatCurrency(deflate(dyr.projectedExpenses - dyr.totalWithdrawal, yr.year))}/yr unfunded`,
                  ]
                : []),
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
                        ACCOUNT_TYPE_CONFIG[c as AcctCat]?.supportsRothSplit,
                    )
                    .map((c) => {
                      const bal = dyr.preWithdrawalAcctBal![c as AcctCat];
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
            <span className="text-blue-400 ml-1 cursor-help">diag</span>
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
}
