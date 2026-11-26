import {
  getAccountTypeConfig,
  getEngineCategories,
  buildCategoryRecord,
  isTaxFreeBucket,
  zeroBalance,
} from "../../config/account-types";
import type { PortfolioTaxType } from "../../config/enum-values";
import { PERF_CATEGORY_RETIREMENT } from "../../config/display-labels";
import {
  emptyTaxBucketMap,
  SPLIT_TAX_TYPES,
} from "../../config/tax-treatment-buckets";
import { roundToCents } from "../../utils/math";
import { categorySide } from "../accounts/category-side";
import type {
  AccountBalances,
  IndividualAccountInput,
  TaxBuckets,
} from "../accounts/account-balances.types";

/**
 * Parts with no real account behind them, holding the given per-category
 * balances: each category's tax parts, Retirement money with no owner.
 */
export function syntheticOpeningParts(
  byCategory: AccountBalances,
): IndividualAccountInput[] {
  return getEngineCategories().flatMap((category) => {
    const balance = byCategory[category];
    const { displayLabel, taxBucketKey } = getAccountTypeConfig(category);
    const part = (
      taxType: PortfolioTaxType,
      money: number,
      basis?: number,
    ) => ({
      name: displayLabel,
      category,
      taxType,
      startingBalance: money,
      ...(basis != null ? { startingBasis: basis } : {}),
      parentCategory: PERF_CATEGORY_RETIREMENT,
      origin: "synthetic" as const,
    });
    if (balance.structure === "roth_traditional")
      return SPLIT_TAX_TYPES.map((taxType) =>
        part(
          taxType,
          isTaxFreeBucket(taxType) ? balance.roth : balance.traditional,
        ),
      );
    if (balance.structure === "single_bucket")
      return [part(taxBucketKey, balance.balance)];
    return [part(taxBucketKey, balance.balance, balance.basis)];
  });
}

/** The run's opening parts: the held accounts, or with none (nothing entered
 *  yet) synthetic parts holding the per-category money. */
export function openingParts(
  held: IndividualAccountInput[],
  byCategory: AccountBalances,
): IndividualAccountInput[] {
  return held.length > 0 ? held : syntheticOpeningParts(byCategory);
}

/** The tax buckets and per-category balances the parts hold, by the payload's
 *  rules: a part's tax type picks its bucket; a Roth-capable category books
 *  Roth parts as Roth, others Traditional; basis is the parts'. */
export function openingTotals(parts: readonly IndividualAccountInput[]): {
  balances: TaxBuckets;
  accountBalance: AccountBalances;
} {
  const accountBalance = buildCategoryRecord(zeroBalance);
  const balances: TaxBuckets = { ...emptyTaxBucketMap(), afterTaxBasis: 0 };
  for (const ia of parts) {
    const { startingBalance: money, category, taxType } = ia;
    const balance = accountBalance[category];
    balances[taxType] += money;
    if (balance.structure !== "roth_traditional") balance.balance += money;
    else if (categorySide(category, taxType) === "roth") balance.roth += money;
    else balance.traditional += money;
    if (balance.structure !== "basis_tracking" || ia.startingBasis == null)
      continue;
    balances.afterTaxBasis += ia.startingBasis;
    if (ia.startingBasis > 0) balance.basis += ia.startingBasis;
  }
  for (const balance of Object.values(accountBalance))
    for (const [k, v] of Object.entries(balance))
      if (typeof v === "number") Reflect.set(balance, k, roundToCents(v));
  for (const [k, v] of Object.entries(balances))
    Reflect.set(balances, k, roundToCents(v));
  return { balances, accountBalance };
}
