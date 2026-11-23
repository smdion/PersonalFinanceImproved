import type { ContributionSpecAccount } from "@/lib/pure/engine/types";

/** A contribution account's account: its performance account, else none
 *  (it is then an account of its own). */
export function specAccountOf(
  performanceAccountId: number | null | undefined,
): ContributionSpecAccount {
  return performanceAccountId != null
    ? { kind: "performance", performanceAccountId }
    : { kind: "unlinked" };
}
