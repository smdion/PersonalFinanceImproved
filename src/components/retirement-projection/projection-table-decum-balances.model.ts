/** The decumulation row's withdrawal total and tax-type balance tooltips,
 *  from the engine's year with the page's formatters. */
import type { AccountCategory } from "@/lib/config/account-types";
import type {
  DecumulationSlot,
  EngineDecumulationYear,
} from "@/lib/pure/engine/types";
import type { IndividualAccountYearBalance } from "@/lib/pure/accounts/account-balances.types";
import type { ProjectionState } from "./projection-table-types";
import type { TooltipLineItem } from "./types";
import {
  buildStrategyEventStyle,
  catDisplayLabel,
  formatRmdDivisorDetail,
} from "./projection-display";
import { lumpSumsForBucket } from "./lump-sums";
import { itemTaxType } from "./projection-columns";
import { bucketSlotMap, slotBucketWithdrawal } from "./bucket-slots";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { isAfterTaxType, isPreTaxType } from "@/lib/config/account-types";
import { ownerAccountLabel } from "./account-notes";
import { taxTypeLabel } from "@/lib/config/display-labels";
import { totalWithdrawalItems } from "./projection-table-decum-row.model";

/** The withdrawal total's tooltip: draws, Social Security, RMD, budget. */
export function totalWithdrawalTooltip(
  yearRow: EngineDecumulationYear,
  dpt: ReturnType<ProjectionState["getPersonYearTotals"]>,
  personFilter: ProjectionState["personFilter"],
  dyr: EngineDecumulationYear,
  dSlotMap: Map<AccountCategory, DecumulationSlot>,
  yearLumpSums: EngineDecumulationYear["config"]["lumpSums"],
  deflate: ProjectionState["deflate"],
  noteFor: (ia: IndividualAccountYearBalance) => {
    note?: string;
    noteLocked?: boolean;
  },
  decumulationBudgetProfileId: number | undefined,
  budgetProfileSummaries: ProjectionState["budgetProfileSummaries"],
  decumulationExpenseOverride: number | undefined,
  budgetOverrideNotes: string | null | undefined,
  decumulationBudgetColumn: number | undefined,
  isSsStartRow: boolean,
  renderTooltip: ProjectionState["renderTooltip"],
  isRmdStartRow: boolean,
  engineSettings: ProjectionState["engineSettings"],
  decumOverrideNotes: string | undefined,
) {
  const iabs = yearRow.individualAccountBalances ?? [];
  const filteredIabs = dpt
    ? iabs.filter((ia) => ia.ownerPersonId === personFilter)
    : iabs;
  const items = totalWithdrawalItems(
    dyr,
    yearRow,
    filteredIabs,
    dSlotMap,
    yearLumpSums,
    deflate,
    noteFor,
  );
  const totalGrowth = filteredIabs.reduce((s, ia) => s + ia.growth, 0);
  const decumulationBudgetProfile =
    decumulationBudgetProfileId != null
      ? budgetProfileSummaries?.find(
          (p) => p.id === decumulationBudgetProfileId,
        )
      : undefined;
  const budgetProfileName =
    decumulationExpenseOverride != null
      ? `Set for this year${dyr.hasBudgetOverride && budgetOverrideNotes ? ` (${budgetOverrideNotes})` : ""}`
      : decumulationBudgetProfile
        ? `${decumulationBudgetProfile.name}${decumulationBudgetColumn != null && decumulationBudgetProfile.columnLabels[decumulationBudgetColumn] ? ` (${decumulationBudgetProfile.columnLabels[decumulationBudgetColumn]})` : ""}${dyr.hasBudgetOverride && budgetOverrideNotes ? ` (${budgetOverrideNotes})` : ""}`
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
              `${e.personName}: ${formatCurrency(deflate(e.amount, yearRow.year))}`,
          )
          .join(", ")
      : null;
  const ssMeta = isSsStartRow
    ? `Social Security begins — ${formatCurrency(deflate(dyr.ssIncome, yearRow.year))}/yr${ssDetail ? ` (${ssDetail})` : ""}`
    : hasSs
      ? `Incl. SS income — ${formatCurrency(deflate(dyr.ssIncome, yearRow.year))}/yr${ssDetail ? ` (${ssDetail})` : ""}`
      : undefined;
  // Full RMD status (checkmark/shortfall/excess wording), matching the chart
  // tooltip (tooltip-renderer.tsx); the checkmark shows whenever the RMD was met.
  const rmdShortfallAmount = dyr.rmdShortfallAmount ?? 0;
  const rmdExcessAmount = dyr.rmdExcessAmount ?? 0;
  const rmdSatisfied = rmdShortfallAmount <= 0;
  return renderTooltip({
    kind: "money",
    header: "Total Withdrawals",
    meta: ssMeta,
    shortfall: dyr.unmetNeedMaterial
      ? {
          amount: deflate(dyr.unmetNeed ?? 0, yearRow.year),
          nonRetirementAmount:
            (dyr.nonRetirementShortfall ?? 0) > 0
              ? deflate(dyr.nonRetirementShortfall!, yearRow.year)
              : undefined,
          penaltyAvoidedAmount:
            (dyr.penaltyAvoidedShortfall ?? 0) > 0
              ? deflate(dyr.penaltyAvoidedShortfall!, yearRow.year)
              : undefined,
        }
      : undefined,
    rmd: hasRmd
      ? {
          amount: deflate(dyr.rmdAmount, yearRow.year),
          isStartYear: isRmdStartRow,
          satisfiedNotably: rmdSatisfied,
          shortfallAmount: deflate(rmdShortfallAmount, yearRow.year),
          excessAmount: deflate(rmdExcessAmount, yearRow.year),
          excessMode:
            engineSettings?.rmdExcessHandling === "spend"
              ? "spend"
              : "reinvest",
          qcdAmount:
            (dyr.qcdAmount ?? 0) > 0
              ? deflate(dyr.qcdAmount!, yearRow.year)
              : undefined,
          divisorDetail: formatRmdDivisorDetail(dyr, deflate, yearRow.year),
        }
      : undefined,
    strategyEvent: (() => {
      if (!dyr.strategyAction) return undefined;
      const style = buildStrategyEventStyle(engineSettings)[dyr.strategyAction];
      return style
        ? { color: style.color, text: style.tooltipText }
        : undefined;
    })(),
    items: items.length > 0 ? items : undefined,
    growth:
      Math.abs(totalGrowth) > 1
        ? {
            amount: deflate(totalGrowth, yearRow.year),
          }
        : undefined,
    withdrawals:
      dyr.taxCost > 0
        ? {
            amount: deflate(dyr.totalWithdrawal, yearRow.year),
            taxCost: deflate(dyr.taxCost, yearRow.year),
          }
        : undefined,
    // A withdrawal-sized year isn't driven by the budget.
    budget:
      budgetProfileName && !dyr.withdrawalSized
        ? {
            profile: budgetProfileName,
            amount: deflate(dyr.projectedExpenses, yearRow.year),
          }
        : undefined,
    overrideNote: decumOverrideNotes
      ? `Changed this year: ${decumOverrideNotes}`
      : undefined,
  });
}

/** One tax type's balance tooltip: draws, lump sums, RMD excess, QCD. */
export function taxTypeBalanceTooltip(
  bucketAccounts: NonNullable<
    EngineDecumulationYear["individualAccountBalances"]
  >,
  bucket: "preTax" | "taxFree" | "hsa" | "afterTax",
  deflate: ProjectionState["deflate"],
  yearRow: EngineDecumulationYear,
  dpt: ReturnType<ProjectionState["getPersonYearTotals"]>,
  dyr: EngineDecumulationYear,
  yearLumpSums: EngineDecumulationYear["config"]["lumpSums"],
  engineSettings: ProjectionState["engineSettings"],
  renderTooltip: ProjectionState["renderTooltip"],
  pct: number,
  bucketGrowth: number,
) {
  const withdrawalLineItems: TooltipLineItem[] = [];
  // Per-account items in both household and person-filtered views, so two
  // people's 401ks stay separate lines, matching Balance-by-Account.
  const multiAccountBucket = bucketAccounts.length > 1;
  if (bucketAccounts.length > 0) {
    const bucketTaxField = bucketSlotMap[bucket]?.taxField;
    for (const ia of bucketAccounts) {
      const withdrawal = ia.draw?.withdrawal ?? 0;
      if (withdrawal > 0) {
        withdrawalLineItems.push({
          label: multiAccountBucket
            ? ownerAccountLabel(ia)
            : (catDisplayLabel[ia.category] ?? ia.category),
          amount: deflate(withdrawal, yearRow.year),
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
      const withdrawal = slotBucketWithdrawal(slot, bucket);
      if (withdrawal > 0) {
        withdrawalLineItems.push({
          label: catDisplayLabel[slot.category] ?? slot.category,
          amount: deflate(withdrawal, yearRow.year),
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
    withdrawalLineItems.push({
      label: ls.label ?? "Lump sum",
      amount: deflate(ls.amount, yearRow.year),
      prefix: "+",
      color: "emerald",
    });
  }
  // RMD-excess / QCD lines so the balance tooltip explains its own number:
  // afterTax is where reinvested excess lands (or would, under "spend");
  // preTax is where QCD money left from.
  const bucketRmdExcess = yearRow.rmdExcessAmount ?? 0;
  const bucketRmdMode = engineSettings?.rmdExcessHandling;
  if (isAfterTaxType(bucket) && bucketRmdExcess > 0.01) {
    if (bucketRmdMode === "spend") {
      withdrawalLineItems.push({
        label: "RMD excess spent (not reinvested)",
        amount: deflate(bucketRmdExcess, yearRow.year),
        color: "gray",
      });
    } else {
      withdrawalLineItems.push({
        label: "RMD excess reinvested",
        amount: deflate(bucketRmdExcess, yearRow.year),
        prefix: "+",
        color: "amber",
      });
    }
  }
  const bucketQcd = yearRow.qcdAmount ?? 0;
  if (isPreTaxType(bucket) && bucketQcd > 0.01) {
    withdrawalLineItems.push({
      label: "QCD to charity (excluded from taxable income)",
      amount: deflate(bucketQcd, yearRow.year),
      prefix: "-",
      color: "violet",
    });
  }
  return renderTooltip({
    kind: "money",
    header: `${taxTypeLabel(bucket)}: ${pct}% of portfolio`,
    meta: `${yearRow.year} · ${formatPercent(yearRow.returnRate, 1)} return`,
    items: withdrawalLineItems.length > 0 ? withdrawalLineItems : undefined,
    growth:
      Math.abs(bucketGrowth) > 1
        ? {
            amount: deflate(bucketGrowth, yearRow.year),
          }
        : undefined,
  });
}
