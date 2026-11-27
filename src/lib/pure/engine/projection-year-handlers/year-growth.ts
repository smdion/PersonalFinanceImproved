/** The year's growth, on the account parts. */
import { applyIndividualGrowth } from "../individual-accounts/ledger";
import type { ProjectionContext, ProjectionLoopState } from "./types";

/** Each account part grows (negatives at 0 when `clampNegative`) into its own
 *  map, which then lands; the settled point after it gives the categories and
 *  the tax buckets their parts' sums. Returns each part's growth. */
export function growYear(
  ctx: ProjectionContext,
  state: ProjectionLoopState,
  effectiveReturn: number,
  clampNegative: boolean,
): Map<string, number> {
  const { indAccounts: parts, indKey: partKey } = ctx;
  const grown = new Map<string, number>();
  const partGrowth = ctx.ledgerRuns
    ? applyIndividualGrowth(
        parts,
        partKey,
        state.indBalance,
        effectiveReturn,
        clampNegative,
        grown,
      )
    : new Map<string, number>();
  // In place: callers hold this same map.
  for (const [k, v] of grown) state.indBalance.set(k, v);
  return partGrowth;
}
