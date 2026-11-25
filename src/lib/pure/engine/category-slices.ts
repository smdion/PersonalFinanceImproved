/** A category's slices (its Traditional and Roth sides, else its one balance)
 *  on a run that holds accounts: a slice's growth and floor raise are its
 *  parts' cents summed, so it keeps its difference from its parts. */
import type {
  AccountBalances,
  IndividualAccountInput,
} from "../accounts/account-balances.types";
import type { IndKeyFn } from "../accounts/account-part";
import {
  getAllCategories,
  type AccountCategory,
} from "../../config/account-types";
import { categorySide, type CategorySide } from "../accounts/category-side";
import { roundToCents } from "../../utils/math";
import {
  setBalance,
  setRoth,
  setTraditional,
} from "../accounts/account-balance";
import { followDraws } from "./brokerage-basis";
import { clampIndividualBalances } from "./individual-accounts/reconcile";
import type {
  ProjectionContext,
  ProjectionLoopState,
} from "./projection-year-handlers/types";

/** A slice's key: its category and side. */
export function sliceKey(category: AccountCategory, side: CategorySide) {
  return `${category}:${side}`;
}

/** The slice a part's money sits in, as `openingTotals` books it. */
const sliceOf = (part: IndividualAccountInput) =>
  sliceKey(part.category, categorySide(part.category, part.taxType));

/** Each slice's sum of its parts' amounts in `byPart`; every slice with a
 *  part has an entry, 0 included. */
export function sumBySlice(
  parts: readonly IndividualAccountInput[],
  partKey: IndKeyFn,
  ...byPart: ReadonlyMap<string, number>[]
): Map<string, number> {
  const sums = new Map<string, number>();
  for (const part of parts) {
    const key = partKey(part);
    const slice = sliceOf(part);
    let sum = sums.get(slice) ?? 0;
    for (const amounts of byPart) sum += amounts.get(key) ?? 0;
    sums.set(slice, sum);
  }
  return sums;
}

/** Each part's floor raise: what lifts a negative part to 0. */
export function partFloorRaises(
  parts: readonly IndividualAccountInput[],
  partKey: IndKeyFn,
  partBalance: ReadonlyMap<string, number>,
): Map<string, number> {
  const raises = new Map<string, number>();
  for (const part of parts) {
    const key = partKey(part);
    raises.set(key, Math.max(0, -(partBalance.get(key) ?? 0)));
  }
  return raises;
}

/** Each part floored at 0, after the categories' own floor (`clampBalances`,
 *  which returned each slice's raise): a slice with parts then takes its
 *  parts' raises in place of its own. */
export function floorPartsAndSlices(
  ctx: ProjectionContext,
  state: ProjectionLoopState,
  ownRaises: ReadonlyMap<string, number>,
): void {
  const { indAccounts: parts, indKey: partKey } = ctx;
  const { indBalance: partBalance, accountBalance } = state;
  const raised = partFloorRaises(parts, partKey, partBalance);
  followDraws(parts, partKey, partBalance, state.brokBasis, () =>
    clampIndividualBalances(parts, partKey, partBalance),
  );
  const moves = new Map<string, number>();
  for (const [slice, raise] of sumBySlice(parts, partKey, raised))
    moves.set(slice, raise - (ownRaises.get(slice) ?? 0));
  moveSlices(accountBalance, moves);
}

/** Moves each slice by its amount in `moves`, to the cent; a slice with no
 *  amount (or 0) is left as it is. */
function moveSlices(
  accountBalance: AccountBalances,
  moves: ReadonlyMap<string, number>,
): void {
  for (const category of getAllCategories()) {
    const balance = accountBalance[category];
    const moved = (side: CategorySide, value: number) => {
      const amount = moves.get(sliceKey(category, side)) ?? 0;
      return amount === 0 ? value : roundToCents(value + amount);
    };
    if (balance.structure === "roth_traditional") {
      setTraditional(balance, moved("traditional", balance.traditional));
      setRoth(balance, moved("roth", balance.roth));
    } else setBalance(balance, moved("balance", balance.balance));
  }
}
