/** The decumulation row's view model: what its cells and tooltips show,
 *  computed from the engine's year with the page's formatters. */
import type { AccountCategory } from "@/lib/config/account-types";
import {
  ACCOUNT_TYPE_CONFIG,
  getAccountTypeConfig,
  getAllCategories,
  isOverflowTarget,
  isTaxFreeBucket,
} from "@/lib/config/account-types";
import type {
  DecumulationSlot,
  EngineDecumulationYear,
} from "@/lib/pure/engine/types";
import type { IndividualAccountYearBalance } from "@/lib/pure/accounts/account-balances.types";
import {
  accountTextColor,
  taxTypeLabel,
  taxTypeTextColor,
} from "@/lib/utils/colors";
import type { ProjectionState } from "./projection-table-types";
import type { TooltipLineItem } from "./types";
import {
  catDisplayLabel,
  itemTaxType,
  lumpSumTotal,
  lumpSumsForBucket,
  lumpSumsForCategory,
} from "./utils";
import { formatCurrency } from "@/lib/utils/format";
import { ownerAccountLabel } from "./account-notes";

type AccountBalances = NonNullable<
  EngineDecumulationYear["individualAccountBalances"]
>;
type AccountNote = (ia: IndividualAccountYearBalance) => {
  note?: string;
  noteLocked?: boolean;
};

// getAllCategories() returns a fixed list — module-level so the account-sort
// comparators below don't call it (and re-scan .indexOf) twice per
// comparison on every render.
export const CATEGORY_ORDER = new Map(getAllCategories().map((c, i) => [c, i]));

/** One category's withdrawal lines: each account drawn from, or the
 *  category's Traditional and Roth totals when no account data exists. */
export function categoryWithdrawalItems(
  withdrawal: number,
  categoryAccounts: AccountBalances,
  catCfg: ReturnType<typeof getAccountTypeConfig>,
  dSlot: DecumulationSlot | undefined,
  yearRow: EngineDecumulationYear,
  deflate: ProjectionState["deflate"],
  noteFor: AccountNote,
): TooltipLineItem[] {
  const items: TooltipLineItem[] = [];
  // Per-account note: eligibility verdict and Roth basis draw-down merged into
  // one dim line under the amount (see buildEligibilityNote for why basis
  // remaining is reconstructed).
  const buildNote = noteFor;
  if (withdrawal > 0) {
    // When a category holds several tracked accounts, show which were drawn
    // from rather than one Trad/Roth line per category; fall back to the
    // aggregate when no individual-account data exists.
    const withdrawingAccounts = categoryAccounts
      .filter((ia) => (ia.draw?.withdrawal ?? 0) > 0.01)
      .sort((a, b) => {
        const taxDiff =
          (isTaxFreeBucket(a.taxType) ? 1 : 0) -
          (isTaxFreeBucket(b.taxType) ? 1 : 0);
        if (taxDiff !== 0) return taxDiff;
        return (a.ownerName ?? a.name).localeCompare(b.ownerName ?? b.name);
      });
    if (withdrawingAccounts.length > 0) {
      const multiAccount = withdrawingAccounts.length > 1;
      for (const ia of withdrawingAccounts) {
        items.push({
          label: multiAccount ? ownerAccountLabel(ia) : catCfg.displayLabel,
          amount: deflate(ia.draw!.withdrawal, yearRow.year),
          prefix: "-",
          taxType: itemTaxType(ia.category, ia.taxType),
          color: "red",
          ...buildNote(ia),
        });
      }
    } else if (
      catCfg.supportsRothSplit &&
      dSlot &&
      (dSlot.traditionalWithdrawal > 0 || dSlot.rothWithdrawal > 0)
    ) {
      if (dSlot.traditionalWithdrawal > 0)
        items.push({
          label: catCfg.displayLabel,
          amount: deflate(dSlot.traditionalWithdrawal, yearRow.year),
          prefix: "-",
          taxType: "traditional",
          color: "red",
        });
      if (dSlot.rothWithdrawal > 0)
        items.push({
          label: catCfg.displayLabel,
          amount: deflate(dSlot.rothWithdrawal, yearRow.year),
          prefix: "-",
          taxType: "roth",
          color: "red",
        });
    }
  }
  return items;
}

/** The withdrawal total's lines: each account drawn from (or the old
 *  aggregate without account data), then the year's lump sums. */
export function totalWithdrawalItems(
  dyr: EngineDecumulationYear,
  yearRow: EngineDecumulationYear,
  filteredIabs: AccountBalances,
  dSlotMap: Map<AccountCategory, DecumulationSlot>,
  yearLumpSums: EngineDecumulationYear["config"]["lumpSums"],
  deflate: ProjectionState["deflate"],
  noteFor: AccountNote,
): TooltipLineItem[] {
  const items: TooltipLineItem[] = [];
  if (dyr.totalWithdrawal > 0) {
    // One line per account drawn from this year, so the user sees exactly
    // which account(s), whose, funded it. Ordered by category (accum order),
    // then traditional before roth, then owner name.
    const withdrawingAccounts = filteredIabs
      .filter((ia) => (ia.draw?.withdrawal ?? 0) > 0.01)
      .sort((a, b) => {
        const catDiff =
          (CATEGORY_ORDER.get(a.category) ?? 0) -
          (CATEGORY_ORDER.get(b.category) ?? 0);
        if (catDiff !== 0) return catDiff;
        const taxDiff =
          (isTaxFreeBucket(a.taxType) ? 1 : 0) -
          (isTaxFreeBucket(b.taxType) ? 1 : 0);
        if (taxDiff !== 0) return taxDiff;
        return (a.ownerName ?? a.name).localeCompare(b.ownerName ?? b.name);
      });
    if (withdrawingAccounts.length > 0) {
      for (const ia of withdrawingAccounts) {
        // This account's eligibility verdict + Roth basis draw-down on its own
        // line (see `buildEligibilityNote` for why basis is reconstructed).
        // Only accounts withdrawn from this year appear.
        items.push({
          label: ownerAccountLabel(ia),
          amount: deflate(ia.draw!.withdrawal, yearRow.year),
          prefix: "-",
          taxType: itemTaxType(ia.category, ia.taxType),
          color: "red",
          group: catDisplayLabel[ia.category] ?? ia.category,
          ...noteFor(ia),
        });
      }
    } else {
      // Fallback for households without per-account tracking data
      // (e.g. simple-mode / no individual accounts modeled): the
      // old aggregate Trad/Roth + non-split-category breakdown.
      if (dyr.totalTraditionalWithdrawal > 0)
        items.push({
          label: taxTypeLabel("preTax"),
          amount: deflate(dyr.totalTraditionalWithdrawal, yearRow.year),
          prefix: "-",
          color: "blue",
        });
      if (dyr.totalRothWithdrawal > 0)
        items.push({
          label: taxTypeLabel("taxFree"),
          amount: deflate(dyr.totalRothWithdrawal, yearRow.year),
          prefix: "-",
          color: "violet",
        });
      for (const sbCat of getAllCategories().filter(
        (c) => !ACCOUNT_TYPE_CONFIG[c].supportsRothSplit,
      )) {
        const sbWithdrawal = dSlotMap.get(sbCat)?.withdrawal ?? 0;
        if (sbWithdrawal > 0)
          items.push({
            label: getAccountTypeConfig(sbCat).displayLabel,
            amount: deflate(sbWithdrawal, yearRow.year),
            prefix: "-",
            color:
              sbCat === getAllCategories().find(isOverflowTarget)
                ? "amber"
                : "emerald",
          });
      }
    }
  }
  // Add lump sum items
  for (const ls of yearLumpSums) {
    items.push({
      label: ls.label
        ? `${ls.label} → ${ls.targetAccountName ?? catDisplayLabel[ls.targetAccount] ?? ls.targetAccount}`
        : `Lump sum → ${ls.targetAccountName ?? catDisplayLabel[ls.targetAccount] ?? ls.targetAccount}`,
      amount: deflate(ls.amount, yearRow.year),
      prefix: "+",
      color: "emerald",
    });
  }
  return items;
}

/** Each person's age in this year. */
export function decumYearAgesTooltip(
  people: { id: number; name: string; birthYear: number }[] | undefined,
  enginePeople: ProjectionState["enginePeople"],
  renderTooltip: ProjectionState["renderTooltip"],
  yearRow: EngineDecumulationYear,
) {
  const pp = people ?? enginePeople;
  if (!pp || pp.length === 0) return undefined;
  return renderTooltip({
    kind: "info",
    lines: pp.map((p) => ({
      text: `${p.name}: ${yearRow.year - p.birthYear}`,
      style: "header" as const,
    })),
  });
}

/** A category cell's color: green when lump sums outweigh the draw. */
export function categoryCellColor(
  yearLumpSums: EngineDecumulationYear["config"]["lumpSums"],
  cat: AccountCategory,
  withdrawal: number,
) {
  const catLumps = lumpSumsForCategory(yearLumpSums, cat);
  const catLumpTotal = lumpSumTotal(catLumps);
  if (catLumpTotal > 0 && catLumpTotal > withdrawal) return "text-green-600";
  return accountTextColor(cat);
}

/** A category cell's net figure: lump sums less the draw, signed. */
export function categoryCellText(
  yearLumpSums: EngineDecumulationYear["config"]["lumpSums"],
  cat: AccountCategory,
  withdrawal: number,
  deflate: ProjectionState["deflate"],
  yearRow: EngineDecumulationYear,
) {
  const catLumps = lumpSumsForCategory(yearLumpSums, cat);
  const catLumpTotal = lumpSumTotal(catLumps);
  if (catLumpTotal > 0 && withdrawal > 0) {
    const net = catLumpTotal - withdrawal;
    return net >= 0
      ? `+${formatCurrency(deflate(net, yearRow.year))}`
      : `-${formatCurrency(deflate(Math.abs(net), yearRow.year))}`;
  }
  if (catLumpTotal > 0)
    return `+${formatCurrency(deflate(catLumpTotal, yearRow.year))}`;
  if (withdrawal > 0)
    return `-${formatCurrency(deflate(withdrawal, yearRow.year))}`;
  return "---";
}

/** A tax-type cell's color: green when lump sums outweigh the draw. */
export function taxTypeCellColor(
  yearLumpSums: EngineDecumulationYear["config"]["lumpSums"],
  bucket: "preTax" | "taxFree" | "hsa" | "afterTax",
  bucketWithdrawal: number,
) {
  const bucketLumps = lumpSumsForBucket(yearLumpSums, bucket);
  const bucketLumpTotal = lumpSumTotal(bucketLumps);
  if (bucketLumpTotal > 0 && bucketLumpTotal > bucketWithdrawal)
    return "text-green-600";
  return taxTypeTextColor(bucket);
}

/** A tax-type cell's net figure: lump sums less the draw, signed. */
export function taxTypeCellText(
  yearLumpSums: EngineDecumulationYear["config"]["lumpSums"],
  bucket: "preTax" | "taxFree" | "hsa" | "afterTax",
  bucketWithdrawal: number,
  deflate: ProjectionState["deflate"],
  yearRow: EngineDecumulationYear,
) {
  const bucketLumps = lumpSumsForBucket(yearLumpSums, bucket);
  const bucketLumpTotal = lumpSumTotal(bucketLumps);
  if (bucketLumpTotal > 0 && bucketWithdrawal > 0) {
    const net = bucketLumpTotal - bucketWithdrawal;
    return net >= 0
      ? `+${formatCurrency(deflate(net, yearRow.year))}`
      : `-${formatCurrency(deflate(Math.abs(net), yearRow.year))}`;
  }
  if (bucketLumpTotal > 0)
    return `+${formatCurrency(deflate(bucketLumpTotal, yearRow.year))}`;
  if (bucketWithdrawal > 0)
    return `-${formatCurrency(deflate(bucketWithdrawal, yearRow.year))}`;
  return "---";
}

/** The withdrawal total's figure: net of lump sums, or depleted. */
export function totalWithdrawalText(
  deflate: ProjectionState["deflate"],
  totalLumpSum: number,
  dyr: EngineDecumulationYear,
  yearRow: EngineDecumulationYear,
) {
  const net = deflate(totalLumpSum - dyr.totalWithdrawal, yearRow.year);
  if (totalLumpSum > 0 && dyr.totalWithdrawal > 0) {
    return net >= 0
      ? `+${formatCurrency(net)}`
      : `-${formatCurrency(Math.abs(net))}`;
  }
  if (totalLumpSum > 0) {
    return `+${formatCurrency(deflate(totalLumpSum, yearRow.year))}`;
  }
  if (dyr.totalWithdrawal > 0) {
    return `-${formatCurrency(deflate(dyr.totalWithdrawal, yearRow.year))}`;
  }
  return dyr.retirementBalance < 1 && dyr.projectedExpenses > 0
    ? "depleted"
    : "---";
}
