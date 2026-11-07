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
import { taxTypeLabel } from "@/lib/utils/colors";
import type { ProjectionState } from "./projection-table-types";
import type { TooltipLineItem } from "./types";
import { catDisplayLabel, itemTaxType } from "./utils";
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
  wd: number,
  catAccts: AccountBalances,
  catCfg: ReturnType<typeof getAccountTypeConfig>,
  dSlot: DecumulationSlot | undefined,
  yr: EngineDecumulationYear,
  deflate: ProjectionState["deflate"],
  noteFor: AccountNote,
): TooltipLineItem[] {
  const items: TooltipLineItem[] = [];
  // Per-account note: merges this account's withdrawal-ordering
  // eligibility verdict and tracked Roth basis draw-down
  // into ONE dim line under its amount, instead of
  // repeating the account name on separate lines for each
  // fact. See buildEligibilityNote's docblock for why the
  // basis-remaining figure is reconstructed rather than
  // reusing the reason's nominal basis.
  const buildNote = noteFor;
  if (wd > 0) {
    // Per-account breakdown ("no magic money"): when a
    // category holds more than one tracked account (e.g.
    // both spouses' 401ks, or a Trad + Roth sub-account),
    // show exactly which account(s) were drawn from
    // rather than one aggregated Trad/Roth line per
    // category. Falls back to the old aggregate when no
    // individual-account data exists for this category.
    const withdrawingAccts = catAccts
      .filter((ia) => (ia.draw?.withdrawal ?? 0) > 0.01)
      .sort((a, b) => {
        const taxDiff =
          (isTaxFreeBucket(a.taxType) ? 1 : 0) -
          (isTaxFreeBucket(b.taxType) ? 1 : 0);
        if (taxDiff !== 0) return taxDiff;
        return (a.ownerName ?? a.name).localeCompare(b.ownerName ?? b.name);
      });
    if (withdrawingAccts.length > 0) {
      const multiAcct = withdrawingAccts.length > 1;
      for (const ia of withdrawingAccts) {
        items.push({
          label: multiAcct ? ownerAccountLabel(ia) : catCfg.displayLabel,
          amount: deflate(ia.draw!.withdrawal, yr.year),
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
  }
  return items;
}

/** The withdrawal total's lines: each account drawn from (or the old
 *  aggregate without account data), then the year's lump sums. */
export function totalWithdrawalItems(
  dyr: EngineDecumulationYear,
  yr: EngineDecumulationYear,
  filteredIabs: AccountBalances,
  dSlotMap: Map<AccountCategory, DecumulationSlot>,
  yearLumpSums: EngineDecumulationYear["config"]["lumpSums"],
  deflate: ProjectionState["deflate"],
  noteFor: AccountNote,
): TooltipLineItem[] {
  const items: TooltipLineItem[] = [];
  if (dyr.totalWithdrawal > 0) {
    // Per-account breakdown ("no magic money"): every account that was actually drawn from
    // this year gets its own line, so the total isn't just an
    // aggregate Trad/Roth split — the user can see exactly which
    // account(s), whose, funded it. Ordered by category (accum
    // order), then traditional before roth, then owner name.
    const withdrawingAccts = filteredIabs
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
    if (withdrawingAccts.length > 0) {
      for (const ia of withdrawingAccts) {
        // Merge this account's eligibility verdict + tracked Roth
        // basis draw-down onto its own line instead of a separate
        // household-wide text block — see `buildEligibilityNote`'s
        // docblock above (and the fix note there) for why the
        // basis-remaining dollar figure is reconstructed rather
        // than reused verbatim. Bounded by construction: only
        // accounts actually withdrawn from this year appear here,
        // so this can't regrow into the old "every account in the
        // household" wall of text.
        items.push({
          label: ownerAccountLabel(ia),
          amount: deflate(ia.draw!.withdrawal, yr.year),
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
      amount: deflate(ls.amount, yr.year),
      prefix: "+",
      color: "emerald",
    });
  }
  return items;
}
