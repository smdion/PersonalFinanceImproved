/** A projection year narrowed to one parent category's accounts, and the row total the projection card shows for it. */
import type {
  EngineYearProjection,
  EngineAccumulationYear,
} from "@/lib/pure/engine/types";
import {
  type AccountCategory,
  getAllCategories,
  getAccountTypeConfig,
  ACCOUNT_TYPE_CONFIG,
  isTaxFreeBucket,
  isPreTaxType,
  tracksCostBasis,
} from "@/lib/config/account-types";
import { getTotalBalance } from "@/lib/config/account-balance";
import { emptyTaxBucketMap } from "@/lib/config/tax-treatment-buckets";
import { roundToCents, sumBy, safeDivide } from "@/lib/utils/math";

// ---------------------------------------------------------------------------
// Year-level parentCategory filter (reused by both standalone and MC det memos)
// ---------------------------------------------------------------------------

/** What a projection-card row shows as its balance: the row's tax buckets,
 *  which a parent-filtered row (filterYearByParentCategory) scopes to that
 *  view. Not a retirement answer — those read `retirementBalance`. */
export function rowTotal(yearRow: {
  balanceByTaxType: {
    preTax: number;
    taxFree: number;
    hsa: number;
    afterTax: number;
  };
}): number {
  const b = yearRow.balanceByTaxType;
  return roundToCents(b.preTax + b.taxFree + b.hsa + b.afterTax);
}

/** A year narrowed to one parent category's accounts. The engine's
 *  retirementBalance / allAccountsBalance stay as reported (they describe the
 *  plan, not the view). */
export function filterYearByParentCategory(
  yearRow: EngineYearProjection,
  parentCategory: string,
): EngineYearProjection {
  // No individual-account data (MC "Simple" tax mode collapses to one
  // fictional bucket): filtering is meaningless, so return the year unchanged
  // rather than zeroing every balance.
  if (yearRow.individualAccountBalances.length === 0) return yearRow;
  const filtered = yearRow.individualAccountBalances.filter(
    (ia) => ia.parentCategory === parentCategory,
  );
  const byTax = { ...emptyTaxBucketMap(), afterTaxBasis: 0 };
  for (const ia of filtered) {
    if (isTaxFreeBucket(ia.taxType)) {
      byTax.taxFree += ia.balance;
    } else {
      const cfg =
        ia.category in ACCOUNT_TYPE_CONFIG
          ? ACCOUNT_TYPE_CONFIG[ia.category as AccountCategory]
          : null;
      const bucket = cfg ? cfg.taxBucketKey : "preTax";
      if (bucket in byTax) {
        byTax[bucket as keyof typeof byTax] += ia.balance;
      } else {
        byTax.preTax += ia.balance;
      }
    }
  }
  // The engine tracks brokerage basis per account; an older result without
  // it falls back to a proportional estimate.
  const basisAccounts = filtered.filter((ia) => tracksCostBasis(ia.category));
  byTax.afterTaxBasis = basisAccounts.every((ia) => ia.costBasis != null)
    ? roundToCents(sumBy(basisAccounts, (ia) => ia.costBasis!))
    : roundToCents(
        yearRow.balanceByTaxType.afterTaxBasis *
          safeDivide(byTax.afterTax, yearRow.balanceByTaxType.afterTax),
      );
  const byAccount = { ...yearRow.balanceByAccount };
  for (const cat of getAllCategories()) {
    const catIabs = filtered.filter((ia) => ia.category === cat);
    const cfg = getAccountTypeConfig(cat);
    if (cfg.balanceStructure === "roth_traditional") {
      const trad = catIabs
        .filter((ia) => !isTaxFreeBucket(ia.taxType))
        .reduce((s, ia) => s + ia.balance, 0);
      const roth = catIabs
        .filter((ia) => isTaxFreeBucket(ia.taxType))
        .reduce((s, ia) => s + ia.balance, 0);
      byAccount[cat] = {
        structure: "roth_traditional" as const,
        traditional: trad,
        roth,
      };
    } else if (cfg.balanceStructure === "basis_tracking") {
      const balance = catIabs.reduce((s, ia) => s + ia.balance, 0);
      const origCatBalance = getTotalBalance(yearRow.balanceByAccount[cat]);
      const ratio = safeDivide(balance, origCatBalance);
      const origCatBasis =
        yearRow.balanceByAccount[cat].structure === "basis_tracking"
          ? yearRow.balanceByAccount[cat].basis
          : 0;
      byAccount[cat] = {
        structure: "basis_tracking" as const,
        balance: balance,
        basis: roundToCents(origCatBasis * ratio),
      };
    } else {
      byAccount[cat] = {
        structure: "single_bucket" as const,
        balance: catIabs.reduce((s, ia) => s + ia.balance, 0),
      };
    }
  }
  if (yearRow.phase !== "decumulation") {
    // Contributions rebuilt from what the kept accounts received (the engine
    // routes per category). Routing flags (caps, remaining space, overflow)
    // stay household-wide, as for withdrawals below.
    const sum = (
      rows: typeof filtered,
      pick: (ia: (typeof filtered)[number]) => number,
    ) => roundToCents(rows.reduce((t, ia) => t + pick(ia), 0));
    const accumSlots =
      "slots" in yearRow
        ? yearRow.slots.map((slot) => {
            const catIabs = filtered.filter(
              (ia) => ia.category === slot.category,
            );
            return {
              ...slot,
              employeeContrib: sum(catIabs, (ia) => ia.contribution),
              employerMatch: sum(catIabs, (ia) => ia.employerMatch),
              rothContrib: sum(
                catIabs.filter((ia) => isTaxFreeBucket(ia.taxType)),
                (ia) => ia.contribution,
              ),
              traditionalContrib: sum(
                catIabs.filter((ia) => isPreTaxType(ia.taxType)),
                (ia) => ia.contribution,
              ),
            };
          })
        : undefined;
    return {
      ...yearRow,
      individualAccountBalances: filtered,
      balanceByTaxType: byTax,
      balanceByAccount: byAccount,
      ...(accumSlots
        ? {
            slots: accumSlots,
            totalEmployee: sum(filtered, (ia) => ia.contribution),
            totalEmployer: sum(filtered, (ia) => ia.employerMatch),
            totalRoth: sum(
              filtered.filter((ia) => isTaxFreeBucket(ia.taxType)),
              (ia) => ia.contribution,
            ),
            totalTraditional: sum(
              filtered.filter((ia) => isPreTaxType(ia.taxType)),
              (ia) => ia.contribution,
            ),
          }
        : {}),
    };
  }

  // Withdrawals rescoped to the balances' account subset by summing what each
  // kept account recorded. Routing flags (cappedByAccount/cappedByTaxType/
  // remainingNeed) stay household-wide: they reflect a real global constraint.
  const filteredSlots = yearRow.slots.map((slot) => {
    const catIabs = filtered.filter((ia) => ia.category === slot.category);
    const cfg = getAccountTypeConfig(slot.category);
    let withdrawal: number;
    let rothWithdrawal: number;
    let traditionalWithdrawal: number;
    if (cfg.balanceStructure === "roth_traditional") {
      traditionalWithdrawal = roundToCents(
        catIabs
          .filter((ia) => !isTaxFreeBucket(ia.taxType))
          .reduce((s, ia) => s + (ia.draw?.withdrawal ?? 0), 0),
      );
      rothWithdrawal = roundToCents(
        catIabs
          .filter((ia) => isTaxFreeBucket(ia.taxType))
          .reduce((s, ia) => s + (ia.draw?.withdrawal ?? 0), 0),
      );
      withdrawal = roundToCents(traditionalWithdrawal + rothWithdrawal);
    } else {
      withdrawal = roundToCents(
        catIabs.reduce((s, ia) => s + (ia.draw?.withdrawal ?? 0), 0),
      );
      rothWithdrawal = 0;
      traditionalWithdrawal = 0;
    }
    // Basis/gains aren't tracked per individual account — prorate by the
    // same withdrawal ratio, mirroring the basis proration above.
    const ratio = safeDivide(withdrawal, slot.withdrawal);
    return {
      ...slot,
      withdrawal,
      rothWithdrawal,
      traditionalWithdrawal,
      basisPortion:
        slot.basisPortion != null
          ? roundToCents(slot.basisPortion * ratio)
          : slot.basisPortion,
      gainsPortion:
        slot.gainsPortion != null
          ? roundToCents(slot.gainsPortion * ratio)
          : slot.gainsPortion,
    };
  });
  const totalWithdrawal = roundToCents(
    filteredSlots.reduce((s, sl) => s + sl.withdrawal, 0),
  );
  const totalTraditionalWithdrawal = roundToCents(
    filteredSlots.reduce((s, sl) => s + sl.traditionalWithdrawal, 0),
  );
  const totalRothWithdrawal = roundToCents(
    filteredSlots.reduce((s, sl) => s + sl.rothWithdrawal, 0),
  );

  // targetWithdrawal/taxCost scale by the same ratio as the slots, so a fully
  // funded scoped plan never reads as underfunded (effectiveTaxRate is
  // unchanged). Expenses and RMD/QCD figures stay household-wide obligations.
  const targetRatio = safeDivide(totalWithdrawal, yearRow.totalWithdrawal, 1);
  const targetWithdrawal = roundToCents(yearRow.targetWithdrawal * targetRatio);
  // Only the withdrawal's tax scales; tax on Social Security is the
  // household's, whichever accounts this view shows.
  const taxCost = roundToCents(
    (yearRow.taxCost - yearRow.ssTaxCost) * targetRatio + yearRow.ssTaxCost,
  );

  return {
    ...yearRow,
    individualAccountBalances: filtered,
    balanceByTaxType: byTax,
    balanceByAccount: byAccount,
    slots: filteredSlots,
    totalWithdrawal,
    totalTraditionalWithdrawal,
    totalRothWithdrawal,
    targetWithdrawal,
    taxCost,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function isAccumYear(
  yearRow: EngineYearProjection,
): yearRow is EngineAccumulationYear {
  return yearRow.phase === "accumulation";
}
