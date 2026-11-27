/** A Roth conversion moved Traditional → Roth across the account categories. */
import type { AccountCategory } from "../../config/account-types";
import type { AccountBalances } from "../accounts/account-balances.types";
import { roundToCents } from "../../utils/math";
import { getAllCategories } from "../../config/account-types";
import { setTraditional, setRoth } from "../accounts/account-balance";
import type { NonRetirementExclusion } from "@/lib/pure/accounts/eligibility";

/** Spreads `conversion` over the Traditional categories by Retirement-only balance (what each
 *  category's Retirement-parented accounts can be debited), a rounding remainder to the first.
 *  Mutates `accountBalance`; returns each category's converted amount. */
export function convertAcrossCategories(
  accountBalance: AccountBalances,
  conversion: number,
  nonRetirement: NonRetirementExclusion | undefined,
): Map<AccountCategory, number> {
  const tradAccounts: {
    category: AccountCategory;
    balance: number;
    traditional: number;
    roth: number;
  }[] = [];
  for (const category of getAllCategories()) {
    const balance = accountBalance[category];
    if (balance.structure !== "roth_traditional") continue;
    const weight = nonRetirement
      ? Math.max(0, balance.traditional - nonRetirement.trad[category])
      : balance.traditional;
    if (weight > 0)
      tradAccounts.push({
        category,
        balance: weight,
        traditional: balance.traditional,
        roth: balance.roth,
      });
  }
  const totalTradBalance = tradAccounts.reduce((s, a) => s + a.balance, 0);
  const categoryShare = new Map<AccountCategory, number>();
  if (totalTradBalance > 0) {
    let distributed = 0;
    for (const account of tradAccounts) {
      const share = roundToCents(
        conversion * (account.balance / totalTradBalance),
      );
      const capped = Math.min(share, account.traditional);
      account.traditional = roundToCents(account.traditional - capped);
      account.roth = roundToCents(account.roth + capped);
      categoryShare.set(
        account.category,
        (categoryShare.get(account.category) ?? 0) + capped,
      );
      distributed += capped;
    }
    // Handle rounding remainder
    if (distributed < conversion - 0.01 && tradAccounts.length > 0) {
      const remainder = roundToCents(conversion - distributed);
      const firstAccount = tradAccounts[0]!;
      const extra = Math.min(remainder, firstAccount.traditional);
      firstAccount.traditional = roundToCents(firstAccount.traditional - extra);
      firstAccount.roth = roundToCents(firstAccount.roth + extra);
      categoryShare.set(
        firstAccount.category,
        (categoryShare.get(firstAccount.category) ?? 0) + extra,
      );
    }
    for (const account of tradAccounts) {
      setTraditional(accountBalance[account.category], account.traditional);
      setRoth(accountBalance[account.category], account.roth);
    }
  }
  return categoryShare;
}
