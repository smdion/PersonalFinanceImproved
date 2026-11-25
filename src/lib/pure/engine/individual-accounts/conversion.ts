/**
 * A Roth conversion's per-account side: each category's share moves from its
 * Retirement-parented Traditional parts to their Roth parts, and its tax comes
 * from the Retirement brokerage's.
 */
import type { AccountCategory } from "../../../config/account-types";
import { isRetirementMoney } from "../../../config/account-types";
import type {
  IndividualAccountInput,
  TaxBuckets,
} from "../../accounts/account-balances.types";
import type { AccountBalance } from "../../../config/account-types.types";
import type { IndKeyFn } from "@/lib/pure/accounts/account-part";
import { roundToCents } from "../../../utils/math";
import {
  followDrawsSold,
  takeBasisOut,
  type BrokerageBasis,
} from "../brokerage-basis";
import { ROTH_SPLIT_PARTS } from "../../../config/tax-treatment-buckets";

/** The account parts a conversion moves money on, their balances and each
 *  brokerage part's basis. */
export type ConversionParts = {
  accounts: readonly IndividualAccountInput[];
  balances: Map<string, number>;
  keyOf: IndKeyFn;
  basis: BrokerageBasis;
};

/** Takes `amount` from `accounts` by balance (the first absorbs the rounding
 *  remainder); none when they hold nothing. */
function debitByBalance(
  { balances, keyOf }: ConversionParts,
  accounts: readonly IndividualAccountInput[],
  amount: number,
): void {
  const total = accounts.reduce(
    (s, ia) => s + Math.max(0, balances.get(keyOf(ia)) ?? 0),
    0,
  );
  if (total <= 0) return;
  let distributed = 0;
  for (const ia of accounts) {
    const key = keyOf(ia);
    const balance = Math.max(0, balances.get(key) ?? 0);
    const share = roundToCents(amount * (balance / total));
    const capped = Math.min(share, balance);
    balances.set(key, roundToCents(balance - capped));
    distributed += capped;
  }
  const remainder = roundToCents(amount - distributed);
  if (remainder > 0.005 && accounts.length > 0) {
    const key = keyOf(accounts[0]!);
    const balance = Math.max(0, balances.get(key) ?? 0);
    balances.set(key, roundToCents(Math.max(0, balance - remainder)));
  }
}

/** A category's Retirement-parented account parts. */
function retirementParts(
  parts: ConversionParts,
  category: AccountCategory,
): IndividualAccountInput[] {
  return parts.accounts.filter(
    (ia) => ia.category === category && isRetirementMoney(ia.parentCategory),
  );
}

/** Each `categoryShare` comes from its Retirement-parented Traditional parts
 *  by balance, and each part's converted money lands on the same account's
 *  Roth part, which the opening state declares (a missing one throws). */
export function debitConvertedParts(
  parts: ConversionParts,
  categoryShare: Map<AccountCategory, number>,
): void {
  const { accounts, balances, keyOf } = parts;
  const declared = new Set(accounts.map((ia) => keyOf(ia)));
  for (const [category, amount] of categoryShare) {
    if (amount <= 0) continue;
    const traditional = retirementParts(parts, category).filter(
      (ia) => ia.taxType === ROTH_SPLIT_PARTS.traditional,
    );
    const before = traditional.map((ia) =>
      Math.max(0, balances.get(keyOf(ia)) ?? 0),
    );
    debitByBalance(parts, traditional, amount);
    traditional.forEach((ia, i) => {
      const moved = roundToCents(before[i]! - (balances.get(keyOf(ia)) ?? 0));
      if (moved <= 0) return;
      const roth = keyOf({ ...ia, taxType: ROTH_SPLIT_PARTS.roth });
      if (!declared.has(roth))
        throw new Error(
          `Roth conversion: "${ia.name}" (${ia.category}) has no Roth part to receive it`,
        );
      balances.set(roth, roundToCents((balances.get(roth) ?? 0) + moved));
    });
  }
}

/** The conversion's tax, from the overflow category's Retirement-parented
 *  accounts by balance, each giving up basis at its own ratio; the tax
 *  buckets and the category give up the same basis (average cost, IRC 1012). */
export function payConversionTaxFromParts(
  parts: ConversionParts,
  category: AccountCategory,
  tax: number,
  totals: { balances: TaxBuckets; category: AccountBalance },
): void {
  const { accounts, keyOf, balances, basis } = parts;
  const { sold } = followDrawsSold(accounts, keyOf, balances, basis, () =>
    debitByBalance(parts, retirementParts(parts, category), tax),
  );
  takeBasisOut(totals.balances, totals.category, sold.get(category) ?? 0);
}
