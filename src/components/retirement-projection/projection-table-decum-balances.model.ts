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
  bucketSlotMap,
  buildStrategyEventStyle,
  catDisplayLabel,
  formatRmdDivisorDetail,
  itemTaxType,
  lumpSumsForBucket,
  slotBucketWithdrawal,
} from "./utils";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { isAfterTaxType, isPreTaxType } from "@/lib/config/account-types";
import { ownerAccountLabel } from "./account-notes";
import { taxTypeLabel } from "@/lib/utils/colors";
import { totalWithdrawalItems } from "./projection-table-decum-row.model";

/** The withdrawal total's tooltip: draws, Social Security, RMD, budget. */
export function totalWithdrawalTooltip(
  yr: EngineDecumulationYear,
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
      const style = buildStrategyEventStyle(engineSettings)[dyr.strategyAction];
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
}

/** One tax type's balance tooltip: draws, lump sums, RMD excess, QCD. */
export function taxTypeBalanceTooltip(
  bucketAccts: NonNullable<EngineDecumulationYear["individualAccountBalances"]>,
  bucket: "preTax" | "taxFree" | "hsa" | "afterTax",
  deflate: ProjectionState["deflate"],
  yr: EngineDecumulationYear,
  dpt: ReturnType<ProjectionState["getPersonYearTotals"]>,
  dyr: EngineDecumulationYear,
  yearLumpSums: EngineDecumulationYear["config"]["lumpSums"],
  engineSettings: ProjectionState["engineSettings"],
  renderTooltip: ProjectionState["renderTooltip"],
  pct: number,
  bucketGrowth: number,
) {
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
          label: catDisplayLabel[slot.category] ?? slot.category,
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
}
