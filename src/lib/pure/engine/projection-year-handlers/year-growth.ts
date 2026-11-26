/** The year's growth, on every track. */
import { applyGrowth } from "../growth-application";
import { applyIndividualGrowth } from "../individual-accounts/ledger";
import { partFloorRaises, sumBySlice } from "../category-slices";
import type { ProjectionContext, ProjectionLoopState } from "./types";

/** Each account part grows first (negatives at 0 when `clampNegative`), on a
 *  copy, then the tax buckets and each category: a slice with parts by their
 *  growth and floor raises. Then the parts land. Returns each part's growth. */
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
  const grown = new Map(state.indBalance);
  const partGrowth = ctx.ledgerRuns
    ? applyIndividualGrowth(
        parts,
        partKey,
        grown,
        effectiveReturn,
        clampNegative,
      )
    : new Map<string, number>();
  const partsBySlice = sumBySlice(parts, partKey, partGrowth, raised);
  applyGrowth({ effectiveReturn, balances, accountBalance, partsBySlice });
  // In place: callers hold this same map.
  for (const [k, v] of grown) state.indBalance.set(k, v);
  return partGrowth;
}
