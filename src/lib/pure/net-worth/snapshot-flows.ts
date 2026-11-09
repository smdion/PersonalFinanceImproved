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
  uncertain: boolean;
};

/** Kinds that move money across the account boundary (everything else is "markets"). */
const FLOW_KINDS: ReadonlySet<InvestmentTransactionKind> = new Set([
  "contribution",
  "withdrawal",
]);

/**
 * One account's money since a snapshot: added or taken out, moved between own
 * accounts (nets out household-wide but changes this account), and markets (the
 * rest of the balance change).
 */
export function accountFlowsSince(
  rows: readonly FlowRow[],
  since: string,
  balanceChange: number,
): { added: number; moved: number; markets: number; uncertainCount: number } {
  let added = 0;
  let moved = 0;
  let uncertainCount = 0;
  for (const r of rows) {
    if (r.pending || r.posted <= since) continue;
    if (r.uncertain) uncertainCount++;
    if (FLOW_KINDS.has(r.kind)) added += r.amount;
    else if (r.kind === "transfer") moved += r.amount;
  }
  return {
    added: roundToCents(added),
    moved: roundToCents(moved),
    markets: roundToCents(balanceChange - added - moved),
    uncertainCount,
  };
}

/**
 * Net money added after `since` (YYYY-MM-DD, exclusive — the snapshot
 * already includes that day). Pending rows are left out: balances don't
 * include them yet. Rows Ledgr was unsure about make the split an estimate.
 */
export function flowsSince(
  rows: readonly FlowRow[],
  since: string,
): { added: number; uncertainCount: number } {
  const { added, uncertainCount } = accountFlowsSince(rows, since, 0);
  return { added, uncertainCount };
}
