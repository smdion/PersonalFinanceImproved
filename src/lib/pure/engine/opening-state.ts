/**
 * The ledger's opening state: every account part a flow can target is
 * declared before the first year, so no flow meets money with no part to
 * land on. A run with no accounts is left as it is.
 */
import {
  getAccountTypeConfig,
  getAllCategories,
  isOverflowTarget,
  isRetirementMoney,
} from "../../config/account-types";
import {
  PERF_CATEGORY_RETIREMENT,
  PROJECTED_RETIREMENT_BROKERAGE_LABEL,
} from "../../config/display-labels";
import { TAX_TREATMENT_TO_TAX_TYPE } from "../../config/tax-treatment-buckets";
import { accountKeyOf } from "../accounts/account-part";
import type { IndividualAccountInput } from "../accounts/account-balances.types";

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
      const part = {
        ...facts,
        taxType,
        startingBalance: 0,
        origin: "declared" as const,
      };
      const key = accountKeyOf(part);
      if (keys.has(key)) continue;
      keys.add(key);
      parts.push(part);
    }
  }
  return parts;
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
