/** The year's growth, on every track. */
import { applyGrowth } from "../growth-application";
import { applyIndividualGrowth } from "../individual-accounts/ledger";
import type { ProjectionContext, ProjectionLoopState } from "./types";

/** Each account part grows first (negatives at 0 when `clampNegative`), then
 *  the tax buckets and each category. Returns each part's growth. */
export function growYear(
  ctx: ProjectionContext,
  state: ProjectionLoopState,
  effectiveReturn: number,
  clampNegative: boolean,
): Map<string, number> {
  const { balances, accountBalance } = state;
  const partGrowth = ctx.holdsAccounts
    ? applyIndividualGrowth(
        ctx.indAccounts,
        ctx.indKey,
        state.indBalance,
        effectiveReturn,
        clampNegative,
      )
    : new Map<string, number>();
  applyGrowth({ effectiveReturn, balances, accountBalance });
  return partGrowth;
}
