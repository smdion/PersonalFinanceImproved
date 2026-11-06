/**
 * Classify SimpleFIN investment-account transaction rows. Pure — no DB or
 * network.
 *
 * Rules live in lib/config/simplefin-transaction-rules.ts. Unmatched rows are
 * `other` and marked uncertain; nothing is dropped.
 */
import {
  SIMPLEFIN_TRANSACTION_RULES,
  type SimplefinTransactionRule,
} from "@/lib/config/simplefin-transaction-rules";
import type { InvestmentTransactionKind } from "@/lib/config/enum-values";

type ClassifiedTransaction = {
  kind: InvestmentTransactionKind;
  /** The amount to use: the row's amount, or its absolute value when the rule fixes the direction. */
  amount: number;
  /** Matching rule id, or null when no rule matched. */
  ruleId: string | null;
  /** The matching rule marks this row's description as health data to redact at ingest. */
  redactDescription: boolean;
  /** No rule matched, or the rule is unsure for this sign: a best guess. */
  uncertain: boolean;
};

type ClassifyOptions = {
  /** Current account balance — lets rules judge "small" relative to the account. */
  accountBalance?: number;
};

/** What classification looks at — stored rows carry no unix timestamp. */
type ClassifiableRow = { amount: number; description: string };

function ruleMatches(
  rule: SimplefinTransactionRule,
  institution: string,
  tx: ClassifiableRow,
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
  tx: ClassifiableRow,
  options: ClassifyOptions = {},
): ClassifiedTransaction {
  const rule = SIMPLEFIN_TRANSACTION_RULES.find((r) =>
    ruleMatches(r, institution, tx, options.accountBalance),
  );
  if (!rule)
    return {
      kind: "other",
      amount: tx.amount,
      ruleId: null,
      uncertain: true,
      redactDescription: false,
    };
  const kind =
    typeof rule.kind === "string"
      ? rule.kind
      : tx.amount < 0
        ? rule.kind.negative
        : rule.kind.positive;
  const uncertain =
    (rule.uncertainWhen === "negative" && tx.amount < 0) ||
    (rule.uncertainWhen === "positive" && tx.amount > 0);
  const amount = rule.absoluteAmount ? Math.abs(tx.amount) : tx.amount;
  return {
    kind,
    amount,
    ruleId: rule.id,
    uncertain,
    redactDescription: rule.redactDescription === true,
  };
}
