/**
 * Money moved into or out of accounts since a snapshot — splits the Live
 * Balance change into "you added" and "markets". Pure.
 */
import type { InvestmentTransactionKind } from "@/lib/config/enum-values";
import { roundToCents } from "@/lib/utils/math";

export type FlowRow = {
  posted: string;
  kind: InvestmentTransactionKind;
  /** Effective amount: positive = money in. */
  amount: number;
  pending: boolean;
  needsReview: boolean;
};

/** Kinds that move money across the account boundary (everything else is "markets"). */
const FLOW_KINDS: ReadonlySet<InvestmentTransactionKind> = new Set([
  "contribution",
  "withdrawal",
]);

/**
 * Net money added after `since` (YYYY-MM-DD, exclusive — the snapshot
 * already includes that day). Pending rows are left out: balances don't
 * include them yet. Rows still awaiting review make the split an estimate.
 */
export function flowsSince(
  rows: readonly FlowRow[],
  since: string,
): { added: number; reviewCount: number } {
  let added = 0;
  let reviewCount = 0;
  for (const r of rows) {
    if (r.pending || r.posted <= since) continue;
    if (r.needsReview) reviewCount++;
    if (FLOW_KINDS.has(r.kind)) added += r.amount;
  }
  return { added: roundToCents(added), reviewCount };
}
