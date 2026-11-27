/** A category's slices (its Traditional and Roth sides, else its one balance)
 *  on a run that holds accounts: `settle` sets each slice to its parts' sum. */
import type { AccountCategory } from "../../config/account-types";
import type { CategorySide } from "../accounts/category-side";
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

/** Each part floored at 0 after a run's draws, its basis following. */
export function floorParts(
  ctx: ProjectionContext,
  state: ProjectionLoopState,
): void {
  const { indAccounts: parts, indKey: partKey } = ctx;
  const { indBalance: partBalance } = state;
  followDraws(parts, partKey, partBalance, state.brokBasis, () =>
    clampIndividualBalances(parts, partKey, partBalance),
  );
}
