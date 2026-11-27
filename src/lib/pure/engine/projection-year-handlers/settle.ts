/** The year's settled points: where a flow's writes have all landed. */
import type {
  AccountBalances,
  TaxBuckets,
} from "../../accounts/account-balances.types";
import type { AccountBalance } from "../../../config/account-types.types";
import {
  getAllCategories,
  type AccountCategory,
} from "../../../config/account-types";
import {
  emptyTaxBucketMap,
  taxTypeOnSide,
} from "../../../config/tax-treatment-buckets";
import { roundToCents } from "../../../utils/math";
import {
  setBalance,
  setBasis,
  setRoth,
  setTraditional,
} from "../../accounts/account-balance";
import { categorySide, type CategorySide } from "../../accounts/category-side";
import { sliceKey } from "../category-slices";
import type { ProjectionContext, ProjectionLoopState } from "./types";

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

/** Called once at each settled point of every year: the views refreshed from
 *  the account parts (`refreshViews`). */
export function settle(
  ctx: ProjectionContext,
  state: ProjectionLoopState,
  _point: SettledPoint,
) {
  refreshViews(ctx, state);
}

/** Each category side with account parts refreshed from them, then the tax
 *  buckets from the categories, so each track is the sum of the cents below
 *  it. */
export function refreshViews(
  ctx: ProjectionContext,
  state: ProjectionLoopState,
) {
  slicesFromParts(ctx, state);
  Object.assign(state.balances, taxBucketsOf(state.accountBalance));
}

/** A category side with parts, and its parts' keys in the parts' order. */
type PartSlice = {
  category: AccountCategory;
  side: CategorySide;
  keys: string[];
};

const SIDE_WRITES: Record<
  CategorySide,
  (target: AccountBalance, value: number) => void
> = { traditional: setTraditional, roth: setRoth, balance: setBalance };

/** Each run's sides with parts, in the categories' order, built once from
 *  its parts (fixed for the run) rather than at every settled point. */
const partSlicesOf = new WeakMap<object, PartSlice[]>();

function partSlices(ctx: ProjectionContext): PartSlice[] {
  const built = partSlicesOf.get(ctx.indAccounts);
  if (built) return built;
  const keysBySlice = new Map<string, string[]>();
  for (const part of ctx.indAccounts) {
    const side = categorySide(part.category, part.taxType);
    const keys = keysBySlice.get(sliceKey(part.category, side)) ?? [];
    keysBySlice.set(sliceKey(part.category, side), [...keys, ctx.indKey(part)]);
  }
  const slices: PartSlice[] = [];
  for (const category of getAllCategories())
    for (const side of ["traditional", "roth", "balance"] as const) {
      const keys = keysBySlice.get(sliceKey(category, side));
      if (keys) slices.push({ category, side, keys });
    }
  partSlicesOf.set(ctx.indAccounts, slices);
  return slices;
}

/** The parts' amounts in `byPart` summed in the parts' order (`sumBySlice`). */
function sumOf(keys: readonly string[], byPart: ReadonlyMap<string, number>) {
  let sum = 0;
  for (const key of keys) sum += byPart.get(key) ?? 0;
  return sum;
}

/** Each category side with parts set to their balances' sum, and a
 *  basis-tracking category's basis to theirs, to the cent; a side with no
 *  part keeps its money. */
function slicesFromParts(ctx: ProjectionContext, state: ProjectionLoopState) {
  for (const { category, side, keys } of partSlices(ctx)) {
    const balance = state.accountBalance[category];
    SIDE_WRITES[side](balance, roundToCents(sumOf(keys, state.indBalance)));
    if (side === "balance")
      setBasis(balance, roundToCents(sumOf(keys, state.brokBasis)));
  }
}
