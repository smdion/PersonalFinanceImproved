/**
 * The kind a stored investment transaction is shown and counted as.
 *
 * Rows are stored as SimpleFIN sent them; their kind is worked out when read
 * (computed values aren't stored): a row ingest locked (`kind_override` —
 * redacted HSA card spending) keeps that kind, every other row goes through
 * the built-in institution rules (lib/config/simplefin-transaction-rules).
 * Pure — no DB or network.
 */
import type { InvestmentTransactionKind } from "@/lib/config/enum-values";
import { classifySimplefinTransaction } from "./simplefin-transactions";

export type StoredTransactionForKind = {
  amount: number;
  description: string;
  kindOverride: InvestmentTransactionKind | null;
};

export type EffectiveKind = {
  kind: InvestmentTransactionKind;
  /** Amount to use — the classifier may fix the direction of a row type the feed sends with a flipped sign. */
  amount: number;
  /** Where the kind came from. */
  source:
    | "locked"
    | "built_in"
    | "unmatched"
    /** Paired with an equal, opposite move in another of the household's accounts. */
    | "transfer_match";
  ruleId: string | null;
  /** Ledgr used its best guess (counts are then estimates). */
  uncertain: boolean;
};

export function effectiveTransactionKind(
  institution: string,
  row: StoredTransactionForKind,
  options: { accountBalance?: number } = {},
): EffectiveKind {
  const classified = classifySimplefinTransaction(institution, row, options);
  if (row.kindOverride) {
    return {
      kind: row.kindOverride,
      // Keep the classifier's direction fix only when it agrees on the kind.
      amount:
        classified.kind === row.kindOverride ? classified.amount : row.amount,
      source: "locked",
      ruleId: null,
      uncertain: false,
    };
  }
  return {
    kind: classified.kind,
    amount: classified.amount,
    source: classified.ruleId === null ? "unmatched" : "built_in",
    ruleId: classified.ruleId,
    uncertain: classified.uncertain,
  };
}

/**
 * The account balance used to judge "small" for a row posted on `day`: the
 * last balance on or before that day, so re-reading a row always gives the
 * same answer. Rows older than the first stored balance (the first sync
 * reaches back ~90 days) use the earliest one — also fixed once stored.
 * `history` is sorted by day, ascending.
 */
export function balanceAsOf(
  history: readonly { day: string; balance: number }[],
  day: string,
): number | undefined {
  let found: number | undefined;
  for (const h of history) {
    if (h.day > day) break;
    found = h.balance;
  }
  return found ?? history[0]?.balance;
}
