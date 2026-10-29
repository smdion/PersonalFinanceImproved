/**
 * What SimpleFIN says about one tracked account, for its Portfolio card:
 * link status, live balance, the change since the latest snapshot split
 * added / moved / markets, its funds' mix and cost, a cost-basis
 * suggestion, and whether deposits match the paycheck setup. Pure — the
 * router loads the data and calls this per account.
 */
import { roundToCents } from "@/lib/utils/math";
import {
  blendedCost,
  portfolioBuckets,
  type ValuedHolding,
} from "./fund-facts";
import { checkDeposits } from "./deposit-check";
import { suggestCostBasis, type CostHolding } from "./cost-basis";
import { accountFlowsSince, type FlowRow } from "./snapshot-flows";
import { liveCoversAccount } from "./simplefin-feeds";
import type { UnplacedFeed } from "./snapshot-suggestions";

type InsightFeed = {
  id: number;
  subKey: string | null;
  balance: number;
  balanceDay: string | null;
  /** The institution's own name for it. */
  name: string;
};

export type InsightInput = {
  performanceAccountId: number;
  /** This account's counted feeds. */
  feeds: readonly InsightFeed[];
  /** Its parts in the latest snapshot. */
  parts: readonly { key: string; label: string; amount: number }[];
  /** Its feeds whose money no part holds. */
  unplaced: readonly UnplacedFeed[];
  snapshotDate: string | null;
  /** Stored transactions reach back to the snapshot. */
  snapshotCovered: boolean;
  /** First day of the deposit check's window. */
  depositsSince: string;
  /** A feed sent a transaction within the recent window. */
  sendsTransactions: boolean;
  /** Its feeds' transactions (voided ones already left out). */
  transactions: readonly (FlowRow & { voided: boolean })[];
  holdings: readonly ValuedHolding[];
  /** Its holdings as reported, for the cost-basis suggestion. */
  costHoldings: readonly (CostHolding & { asOf: string })[];
  /** What the paycheck setup sends it a year (null: not set up). */
  expectedYearly: number | null;
  /** Taxable accounts only: the cost basis stored on it. */
  storedCostBasis: number | null;
};

export function accountInsight(a: InsightInput) {
  const status =
    a.feeds.length === 0
      ? ("none" as const)
      : a.sendsTransactions
        ? ("linked" as const)
        : ("balance_only" as const);
  const liveTotal = roundToCents(a.feeds.reduce((t, f) => t + f.balance, 0));
  const snapshotTotal = roundToCents(a.parts.reduce((t, p) => t + p.amount, 0));
  // Only when the live balance covers the whole account as the snapshot
  // does (every part linked, nothing outside a part).
  const comparable =
    a.snapshotDate !== null &&
    liveCoversAccount(
      a.parts.map((p) => p.key),
      a.feeds.map((f) => f.subKey),
      a.unplaced.length,
    );
  const whole = a.feeds.some((f) => !f.subKey);
  const partLabel = new Map(a.parts.map((p) => [p.key, p.label]));
  const { buckets, unknown, total } = portfolioBuckets(a.holdings);
  const basis =
    a.storedCostBasis !== null ? suggestCostBasis(a.costHoldings) : null;
  const deposits = a.transactions.filter(
    (r) =>
      r.posted >= a.depositsSince &&
      r.kind === "contribution" &&
      !r.pending &&
      !r.voided,
  );
  return {
    performanceAccountId: a.performanceAccountId,
    status,
    live:
      a.feeds.length === 0
        ? null
        : {
            total: liveTotal,
            asOf:
              a.feeds
                .map((f) => f.balanceDay)
                .filter((d): d is string => d !== null)
                .sort()[0] ?? null,
          },
    feeds: a.feeds.map((f) => ({
      id: f.id,
      name: f.name,
      part: f.subKey ? (partLabel.get(f.subKey) ?? null) : null,
    })),
    /** Parts of the account no feed covers (only without a whole-account link). */
    unlinkedParts:
      whole || a.feeds.length === 0
        ? []
        : a.parts
            .filter((p) => !a.feeds.some((f) => f.subKey === p.key))
            .map((p) => p.label),
    /** Change since the latest snapshot, split added / moved / markets (null when not comparable). */
    sinceSnapshot: comparable
      ? {
          snapshotDate: a.snapshotDate!,
          change: roundToCents(liveTotal - snapshotTotal),
          covered: a.snapshotCovered,
          ...accountFlowsSince(
            a.transactions.filter((r) => !r.voided),
            a.snapshotDate!,
            liveTotal - snapshotTotal,
          ),
        }
      : null,
    /** Feeds whose money no part of the latest snapshot holds. */
    unplaced: a.unplaced.map((u) => ({
      name: a.feeds.find((f) => f.id === u.feedId)?.name ?? "",
      balance: u.balance,
      reason: u.reason,
    })),
    mix: { buckets, unknown, total },
    /** Taxable accounts: stored cost basis and the one holdings suggest. */
    costBasis:
      basis && a.storedCostBasis !== null
        ? {
            stored: a.storedCostBasis,
            ...basis,
            asOf: a.costHoldings[0]?.asOf,
          }
        : null,
    cost: blendedCost(a.holdings),
    deposits: checkDeposits(
      deposits.map((d) => ({ posted: d.posted, amount: d.amount })),
      a.expectedYearly,
      a.sendsTransactions,
    ),
  };
}
