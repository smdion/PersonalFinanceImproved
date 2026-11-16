/**
 * The ledger's opening state: every account part a flow can target is
 * declared before the first year, so no flow meets money with no part to
 * land on. A run with no accounts is left as it is.
 */
import {
  getAccountTypeConfig,
  getAllCategories,
  getEngineCategories,
  isOverflowTarget,
  isRetirementMoney,
  buildCategoryRecord,
  isTaxFreeBucket,
  zeroBalance,
} from "../../config/account-types";
import { PORTFOLIO_TAX_TYPE_VALUES } from "../../config/enum-values";
import {
  PERF_CATEGORY_RETIREMENT,
  PROJECTED_RETIREMENT_BROKERAGE_LABEL,
} from "../../config/display-labels";
import {
  emptyTaxBucketMap,
  TAX_TREATMENT_TO_TAX_TYPE,
} from "../../config/tax-treatment-buckets";
import { roundToCents } from "../../utils/math";
import { accountKeyOf } from "../accounts/account-part";
import type {
  AccountBalances,
  IndividualAccountInput,
  TaxBuckets,
} from "../accounts/account-balances.types";

/** The two tax parts of an account type that `supportsRothSplit`. */
const ROTH_SPLIT_PARTS: readonly string[] = [
  TAX_TREATMENT_TO_TAX_TYPE.pre_tax,
  TAX_TREATMENT_TO_TAX_TYPE.tax_free,
];

/**
 * The held parts, then the projected Retirement brokerage when none is held,
 * then each Roth-capable account's missing tax part per owner, at $0.
 */
export function declareOpeningParts(
  held: readonly IndividualAccountInput[],
): IndividualAccountInput[] {
  if (held.length === 0) return [];
  const parts = [...held];
  const keys = new Set(held.map((ia) => accountKeyOf(ia)));
  const overflowCategory = getAllCategories().find(isOverflowTarget)!;
  if (!held.some((ia) => isRetirementBrokerage(ia.category, ia.parentCategory)))
    parts.push({
      name: PROJECTED_RETIREMENT_BROKERAGE_LABEL,
      category: overflowCategory,
      taxType: getAccountTypeConfig(overflowCategory).taxBucketKey,
      startingBalance: 0,
      startingBasis: 0,
      parentCategory: PERF_CATEGORY_RETIREMENT,
      origin: "projected",
    });
  for (const ia of held) {
    if (!getAccountTypeConfig(ia.category).supportsRothSplit) continue;
    if (!ROTH_SPLIT_PARTS.includes(ia.taxType)) continue;
    // The account's facts; the held part's money, basis and RMD target stay with it.
    const {
      startingBasis: _basis,
      rothBasisMeta: _rothBasis,
      rmdExcessTarget: _target,
      ...facts
    } = ia;
    for (const taxType of ROTH_SPLIT_PARTS) {
      // A synthetic account's sibling is synthetic too: no real account.
      const part = {
        ...facts,
        taxType,
        startingBalance: 0,
        origin: ia.origin === "synthetic" ? ia.origin : ("declared" as const),
      };
      const key = accountKeyOf(part);
      if (keys.has(key)) continue;
      keys.add(key);
      parts.push(part);
    }
  }
  return parts;
}

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
    const part = (taxType: string, money: number, basis?: number) => ({
      name: displayLabel,
      category,
      taxType,
      startingBalance: money,
      ...(basis != null ? { startingBasis: basis } : {}),
      parentCategory: PERF_CATEGORY_RETIREMENT,
      origin: "synthetic" as const,
    });
    if (balance.structure === "roth_traditional")
      return ROTH_SPLIT_PARTS.map((taxType) =>
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
 *  rules: a part's tax type picks its bucket (none: throws); a Roth-capable
 *  category books Roth parts as Roth, others Traditional; basis is the parts'. */
export function openingTotals(parts: readonly IndividualAccountInput[]): {
  balances: TaxBuckets;
  accountBalance: AccountBalances;
} {
  const accountBalance = buildCategoryRecord(zeroBalance);
  const balances: TaxBuckets = { ...emptyTaxBucketMap(), afterTaxBasis: 0 };
  for (const ia of parts) {
    const money = ia.startingBalance;
    const balance = accountBalance[ia.category];
    const bucket = PORTFOLIO_TAX_TYPE_VALUES.find((t) => t === ia.taxType);
    if (!bucket)
      throw new Error(
        `openingTotals: part "${ia.name}" (${ia.category}) has tax type "${ia.taxType}", not a tax bucket`,
      );
    balances[bucket] += money;
    if (balance.structure !== "roth_traditional") balance.balance += money;
    else if (isTaxFreeBucket(ia.taxType)) balance.roth += money;
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

/** A Retirement brokerage: where overflow and reinvested RMD money land. */
export function isRetirementBrokerage(
  category: string,
  parentCategory: string | undefined,
): boolean {
  return (
    getAllCategories().some((c) => c === category && isOverflowTarget(c)) &&
    isRetirementMoney(parentCategory)
  );
}
