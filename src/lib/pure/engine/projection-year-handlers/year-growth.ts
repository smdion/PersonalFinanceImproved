/** The year's growth, on every track. */
import { applyGrowth } from "../growth-application";
import { applyIndividualGrowth } from "../individual-accounts/ledger";
import { partFloorRaises, sumBySlice } from "../category-slices";
import type { ProjectionContext, ProjectionLoopState } from "./types";

/** Each account part grows first (negatives at 0 when `clampNegative`), then
 *  the tax buckets and each category: a slice with parts by their growth and
 *  floor raises. Returns each part's growth. */
export function growYear(
  ctx: ProjectionContext,
  state: ProjectionLoopState,
  effectiveReturn: number,
  clampNegative: boolean,
): Map<string, number> {
  const { indAccounts: parts, indKey: partKey } = ctx;
  const { balances, accountBalance } = state;
  const raised = clampNegative
    ? partFloorRaises(parts, partKey, state.indBalance)
    : new Map<string, number>();
  const partGrowth = ctx.ledgerRuns
    ? applyIndividualGrowth(
        parts,
        partKey,
        state.indBalance,
        effectiveReturn,
        clampNegative,
      )
    : new Map<string, number>();
  const partsBySlice = sumBySlice(parts, partKey, partGrowth, raised);
  applyGrowth({ effectiveReturn, balances, accountBalance, partsBySlice });
  return partGrowth;
}
