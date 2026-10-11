/**
 * Classify SimpleFIN investment-account transaction rows and total the money
 * that crossed the account boundary. Pure — no DB or network.
 *
 * Rules live in lib/config/simplefin-transaction-rules.ts. Unmatched rows are
 * `other` and flagged for review; nothing is dropped.
 */
import {
  SIMPLEFIN_TRANSACTION_RULES,
  type SimplefinTransactionRule,
} from "@/lib/config/simplefin-transaction-rules";
import type { InvestmentTransactionKind } from "@/lib/config/enum-values";
import { roundToCents } from "@/lib/utils/math";

export type SimplefinTransactionInput = {
  amount: number;
  description: string;
  /** Unix seconds, as SimpleFIN sends it. */
  posted: number;
};

export type ClassifiedTransaction = {
  kind: InvestmentTransactionKind;
  /** The amount to use: the row's amount, or its absolute value when the rule fixes the direction. */
  amount: number;
  /** Matching rule id, or null when no rule matched. */
  ruleId: string | null;
  /** The matching rule marks this row's description as health data to redact at ingest. */
  redactDescription: boolean;
  needsReview: boolean;
};

export type ClassifyOptions = {
  /** Current account balance — lets rules judge "small" relative to the account. */
  accountBalance?: number;
  rules?: readonly SimplefinTransactionRule[];
};

function ruleMatches(
  rule: SimplefinTransactionRule,
  institution: string,
  tx: SimplefinTransactionInput,
  accountBalance: number | undefined,
): boolean {
  if (rule.institution && !rule.institution.test(institution)) return false;
  if (!rule.description.test(tx.description)) return false;
  if (rule.sign === "positive" && !(tx.amount > 0)) return false;
  if (rule.sign === "negative" && !(tx.amount < 0)) return false;
  if (rule.maxFractionOfBalance !== undefined) {
    if (accountBalance === undefined || accountBalance <= 0) return false;
    if (Math.abs(tx.amount) > rule.maxFractionOfBalance * accountBalance)
      return false;
  }
  return true;
}

export function classifySimplefinTransaction(
  institution: string,
  tx: SimplefinTransactionInput,
  options: ClassifyOptions = {},
): ClassifiedTransaction {
  const rules = options.rules ?? SIMPLEFIN_TRANSACTION_RULES;
  const rule = rules.find((r) =>
    ruleMatches(r, institution, tx, options.accountBalance),
  );
  if (!rule)
    return {
      kind: "other",
      amount: tx.amount,
      ruleId: null,
      needsReview: true,
      redactDescription: false,
    };
  const kind =
    typeof rule.kind === "string"
      ? rule.kind
      : tx.amount < 0
        ? rule.kind.negative
        : rule.kind.positive;
  const needsReview =
    (rule.reviewWhen === "negative" && tx.amount < 0) ||
    (rule.reviewWhen === "positive" && tx.amount > 0);
  const amount = rule.absoluteAmount ? Math.abs(tx.amount) : tx.amount;
  return {
    kind,
    amount,
    ruleId: rule.id,
    needsReview,
    redactDescription: rule.redactDescription === true,
  };
}

export type AccountFlowSummary = {
  /** Money in from outside (positive). Negative contribution rows reduce it. */
  contributions: number;
  /** Money out (positive number = money left). Refunds reduce it. */
  withdrawals: number;
  fees: number;
  dividends: number;
  interest: number;
  /** Net money across the account boundary: contributions − withdrawals. */
  netFlow: number;
  /** Net flow per posted date (YYYY-MM-DD, UTC) — one payday's per-fund rows collapse into one deposit. */
  netFlowByDate: Record<string, number>;
  needsReviewCount: number;
};

/** Totals for one account's classified rows. */
export function summarizeAccountFlows(
  institution: string,
  transactions: readonly SimplefinTransactionInput[],
  options: ClassifyOptions = {},
): AccountFlowSummary {
  let contributions = 0,
    withdrawals = 0,
    fees = 0,
    dividends = 0,
    interest = 0,
    needsReviewCount = 0;
  const byDate: Record<string, number> = {};
  for (const tx of transactions) {
    const c = classifySimplefinTransaction(institution, tx, options);
    if (c.needsReview) needsReviewCount++;
    let flow = 0;
    switch (c.kind) {
      case "contribution":
        contributions += c.amount;
        flow = c.amount;
        break;
      case "withdrawal":
        withdrawals -= c.amount;
        flow = c.amount;
        break;
      case "fee":
        fees -= c.amount;
        break;
      case "dividend":
        dividends += c.amount;
        break;
      case "interest":
        interest += c.amount;
        break;
      default:
        break;
    }
    if (flow !== 0) {
      // eslint-disable-next-line local/no-tz-unsafe-date-string -- SimpleFIN encodes the institution's posting date as a UTC timestamp; converting to local time could move it to the previous day. Internal grouping key, never compared to a local "today".
      const date = new Date(tx.posted * 1000).toISOString().slice(0, 10); // lint-violation-ok: institution posting date, internal UTC key
      byDate[date] = roundToCents((byDate[date] ?? 0) + flow);
    }
  }
  return {
    contributions: roundToCents(contributions),
    withdrawals: roundToCents(withdrawals),
    fees: roundToCents(fees),
    dividends: roundToCents(dividends),
    interest: roundToCents(interest),
    netFlow: roundToCents(contributions - withdrawals),
    netFlowByDate: byDate,
    needsReviewCount,
  };
}
