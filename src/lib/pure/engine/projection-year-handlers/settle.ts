/** The year's settled points: where a flow's writes have all landed. */
import type {
  AccountBalances,
  TaxBuckets,
} from "../../accounts/account-balances.types";
import { getAllCategories } from "../../../config/account-types";
import {
  emptyTaxBucketMap,
  taxTypeOnSide,
} from "../../../config/tax-treatment-buckets";
import { roundToCents } from "../../../utils/math";
import type { ProjectionLoopState } from "./types";

/** A flow's end, where every track (tax buckets, categories, account parts
 *  and their basis) has taken that flow's writes, in each year's order. */
export type SettledPoint =
  | "accumulation.contributions"
  | "accumulation.gapDraw"
  | "accumulation.growth"
  | "accumulation.goalDraws"
  | "accumulation.beforeReconcile"
  | "decumulation.qcd"
  | "decumulation.draws"
  | "decumulation.conversion"
  | "decumulation.portfolioContributions"
  | "decumulation.growth"
  | "decumulation.beforeReconcile";

/** The tax buckets the categories hold: each category's money in the bucket
 *  its side books to, and the brokerage categories' basis. */
export function taxBucketsOf(accountBalance: AccountBalances): TaxBuckets {
  const buckets: TaxBuckets = { ...emptyTaxBucketMap(), afterTaxBasis: 0 };
  for (const category of getAllCategories()) {
    const balance = accountBalance[category];
    if (balance.structure === "roth_traditional") {
      buckets[taxTypeOnSide(category, "traditional")] += balance.traditional;
      buckets[taxTypeOnSide(category, "roth")] += balance.roth;
      continue;
    }
    buckets[taxTypeOnSide(category, undefined)] += balance.balance;
    if (balance.structure === "basis_tracking")
      buckets.afterTaxBasis += balance.basis;
  }
  for (const [bucket, value] of Object.entries(buckets))
    Reflect.set(buckets, bucket, roundToCents(value));
  return buckets;
}

/** Called once at each settled point of every year: the tax buckets are
 *  refreshed from the categories, so each is the sum of their cents. */
export function settle(state: ProjectionLoopState, _point: SettledPoint) {
  Object.assign(state.balances, taxBucketsOf(state.accountBalance));
}
