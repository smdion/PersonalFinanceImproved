/**
 * Decumulation's balance steps: the RMD excess reinvested on the accounts, depletions tracked,
 * and rounding dust zeroed once the portfolio is depleted.
 */
import type { AccountCategory } from "../../config/account-types";
import type {
  TaxBuckets,
  AccountBalances,
  IndividualAccountInput,
} from "../accounts/account-balances.types";
import type { ProjectionResult } from "./types/projection-result";
import { roundToCents } from "../../utils/math";
import {
  getAllCategories,
  isOverflowTarget,
  isRetirementMoney,
} from "../../config/account-types";
import type { IndKeyFn } from "@/lib/pure/accounts/account-part";
import { inflowShares } from "./individual-accounts/part-weights";
import { placeWhole } from "@/lib/pure/accounts/place-whole";
import { followInflows, type BrokerageBasis } from "./brokerage-basis";

// ---------------------------------------------------------------------------
// RMD Excess Reinvestment
// ---------------------------------------------------------------------------

/**
 * Returns the RMD excess over need + tax, at most what the RMD added: only RMD dollars beyond
 * the need. "reinvest" credits it to the Retirement-parented overflow accounts as new basis;
 * "spend" credits nothing. The settled point after the draws gives the categories and buckets. */
export function reinvestRmdExcess(
  mode: "reinvest" | "spend",
  rmdAdded: number,
  totalWithdrawal: number,
  afterTaxNeed: number,
  taxCost: number,
  partAccounts: IndividualAccountInput[],
  partBalance: Map<string, number>,
  partKey: IndKeyFn,
  partBasis: BrokerageBasis,
): number {
  return followInflows(partAccounts, partKey, partBalance, partBasis, () =>
    creditRmdExcess(
      mode,
      rmdAdded,
      totalWithdrawal,
      afterTaxNeed,
      taxCost,
      partAccounts,
      partBalance,
      partKey,
    ),
  );
}

/** The RMD excess, its money credited (not its basis) to the
 *  Retirement-parented overflow accounts in `indBalance`. */
function creditRmdExcess(
  mode: "reinvest" | "spend",
  rmdAdded: number,
  totalWithdrawal: number,
  afterTaxNeed: number,
  taxCost: number,
  indAccounts: IndividualAccountInput[],
  indBalance: Map<string, number>,
  indKey: IndKeyFn,
): number {
  const overDraw = totalWithdrawal - afterTaxNeed - taxCost;
  const excess = roundToCents(Math.min(rmdAdded, Math.max(0, overDraw)));
  if (excess <= 0) return 0;
  const category = getAllCategories().find(isOverflowTarget);
  if (mode === "reinvest" && category) {
    // The chosen account, else every Retirement brokerage by balance;
    // the opening state always holds one. Never a Portfolio account.
    const retirementAccounts = indAccounts.filter(
      (ia) => ia.category === category && isRetirementMoney(ia.parentCategory),
    );
    const chosen = retirementAccounts.filter((ia) => ia.rmdExcessTarget);
    const target = chosen.length > 0 ? chosen : retirementAccounts;
    const [first] = target;
    if (!first)
      throw new Error("reinvestRmdExcess: no Retirement brokerage part");
    const balanceOf = (ia: IndividualAccountInput) =>
      Math.max(0, indBalance.get(indKey(ia)) ?? 0);
    // inflowShares decides any group holding money; its fallback, the
    // first part taking it all, is the $0 branch below.
    const targetTotal = target.reduce((s, ia) => s + balanceOf(ia), 0);
    const shares = inflowShares(target.map(balanceOf), () =>
      target.map((_, i) => (i === 0 ? 1 : 0)),
    );
    if (targetTotal > 0) {
      // Each share on the part's own balance, as the $0 branch.
      const raw = shares.map((s) => excess * s);
      placeWhole(excess, raw).forEach((share, i) => {
        const k = indKey(target[i]!);
        indBalance.set(k, roundToCents((indBalance.get(k) ?? 0) + share));
      });
    } else {
      // $0: the fallback above, written on the first part's own
      // balance (a part can sit below $0 until clampIndividualBalances).
      const k = indKey(first);
      indBalance.set(k, roundToCents((indBalance.get(k) ?? 0) + excess));
    }
  }
  // "spend": intentionally no balance mutation — the money is modeled as
  // consumed, not reinvested. Still returned so the UI can report it.
  return excess;
}

// ---------------------------------------------------------------------------
// Depletion Tracking
// ---------------------------------------------------------------------------

/**
 * Track per-account depletions (first year each sub-bucket hits zero).
 * Mutates `depletionTracked` and `accountDepletions` in place.
 */
export function trackDepletions(
  accountBalance: AccountBalances,
  depletionTracked: Set<string>,
  accountDepletions: ProjectionResult["accountDepletions"],
  year: number,
  age: number,
): void {
  for (const cat of getAllCategories()) {
    const balance = accountBalance[cat];
    const checks: {
      key: string;
      category: AccountCategory;
      subType?: "traditional" | "roth";
      balance: number;
    }[] = [];
    if (balance.structure === "roth_traditional") {
      checks.push({
        key: `${cat}_trad`,
        category: cat,
        subType: "traditional",
        balance: balance.traditional,
      });
      checks.push({
        key: `${cat}_roth`,
        category: cat,
        subType: "roth",
        balance: balance.roth,
      });
    } else if (balance.structure === "single_bucket") {
      checks.push({ key: cat, category: cat, balance: balance.balance });
    } else {
      checks.push({ key: cat, category: cat, balance: balance.balance });
    }
    for (const check of checks) {
      if (check.balance <= 0 && !depletionTracked.has(check.key)) {
        depletionTracked.add(check.key);
        accountDepletions.push({
          category: check.category,
          subType: check.subType,
          depletionYear: year,
          depletionAge: age,
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Dust Cleanup
// ---------------------------------------------------------------------------

/**
 * Zero every account part when the total portfolio is effectively depleted
 * (< $1); the settled point after it gives the categories and buckets.
 * Returns true if dust was cleaned.
 */
export function cleanupDust(
  balances: TaxBuckets,
  indAccounts: IndividualAccountInput[],
  indKey: IndKeyFn,
  indBalance: Map<string, number>,
): boolean {
  const rawEndBalance =
    balances.preTax + balances.taxFree + balances.hsa + balances.afterTax;
  if (rawEndBalance >= 1) return false;
  for (const ia of indAccounts) indBalance.set(indKey(ia), 0);
  return true;
}
