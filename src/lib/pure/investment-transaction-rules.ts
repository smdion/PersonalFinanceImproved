/**
 * User-defined transaction rules and the kind a stored row is shown as.
 *
 * Rows are stored as SimpleFIN sent them; their kind is worked out when read
 * (computed values aren't stored). Order of precedence:
 *   1. a per-row choice (`kind_override`) — the user's, or the ingest lock on
 *      redacted HSA card spending;
 *   2. the household's own rules (`investment_transaction_rules`);
 *   3. the built-in institution rules (lib/config/simplefin-transaction-rules).
 * Pure — no DB or network.
 */
import {
  SIMPLEFIN_TRANSACTION_RULES,
  type SimplefinTransactionRule,
} from "@/lib/config/simplefin-transaction-rules";
import type {
  AmountSign,
  InvestmentTransactionKind,
  KindOverrideSource,
} from "@/lib/config/enum-values";
import { classifySimplefinTransaction } from "./simplefin-transactions";

/** A row of `investment_transaction_rules`, as read from the database. */
export type UserTransactionRule = {
  id: number;
  institutionContains: string;
  descriptionContains: string;
  sign: AmountSign | null;
  kind: InvestmentTransactionKind;
  reviewWhen: AmountSign | null;
  maxFractionOfBalance: string | number | null;
  priority: number;
};

export const USER_RULE_ID_PREFIX = "user-";

function containsPattern(text: string): RegExp {
  return new RegExp(text.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
}

/** User rules as classifier rules: case-insensitive "contains" matching, highest priority first. */
export function toClassifierRules(
  userRules: readonly UserTransactionRule[],
): SimplefinTransactionRule[] {
  return [...userRules]
    .sort((a, b) => b.priority - a.priority || a.id - b.id)
    .map((r) => ({
      id: `${USER_RULE_ID_PREFIX}${r.id}`,
      institution: containsPattern(r.institutionContains),
      description: containsPattern(r.descriptionContains),
      ...(r.sign ? { sign: r.sign } : {}),
      ...(r.maxFractionOfBalance !== null
        ? { maxFractionOfBalance: Number(r.maxFractionOfBalance) }
        : {}),
      kind: r.kind,
      ...(r.reviewWhen ? { reviewWhen: r.reviewWhen } : {}),
    }));
}

/** The full rule list for read-time classification: the household's rules, then the built-ins. */
export function classifierRulesWith(
  userRules: readonly UserTransactionRule[],
): SimplefinTransactionRule[] {
  return [...toClassifierRules(userRules), ...SIMPLEFIN_TRANSACTION_RULES];
}

export type StoredTransactionForKind = {
  amount: number;
  description: string;
  kindOverride: InvestmentTransactionKind | null;
  kindOverrideSource: KindOverrideSource | null;
};

export type EffectiveKind = {
  kind: InvestmentTransactionKind;
  /** Amount to use — the classifier may fix the direction of a row type the feed sends with a flipped sign. */
  amount: number;
  /** Where the kind came from. */
  source: "override" | "locked" | "user_rule" | "built_in" | "unmatched";
  ruleId: string | null;
  needsReview: boolean;
};

/** The kind a stored row is shown and counted as. `rules` comes from {@link classifierRulesWith}. */
export function effectiveTransactionKind(
  institution: string,
  row: StoredTransactionForKind,
  options: {
    rules: readonly SimplefinTransactionRule[];
    accountBalance?: number;
  },
): EffectiveKind {
  const classified = classifySimplefinTransaction(institution, row, options);
  if (row.kindOverride) {
    return {
      kind: row.kindOverride,
      // Keep the classifier's direction fix only when it agrees on the kind.
      amount:
        classified.kind === row.kindOverride ? classified.amount : row.amount,
      source:
        row.kindOverrideSource === "ingest_redacted" ? "locked" : "override",
      ruleId: null,
      needsReview: false,
    };
  }
  return {
    kind: classified.kind,
    amount: classified.amount,
    source:
      classified.ruleId === null
        ? "unmatched"
        : classified.ruleId.startsWith(USER_RULE_ID_PREFIX)
          ? "user_rule"
          : "built_in",
    ruleId: classified.ruleId,
    needsReview: classified.needsReview,
  };
}

export type RuleImpactRow = StoredTransactionForKind & {
  institution: string;
  accountBalance?: number;
};

/**
 * What adding `candidate` would do to the stored rows: how many it matches
 * (rows with a per-row choice are never affected) and how many of those
 * would change kind or leave the review queue.
 */
export function previewRuleImpact(
  candidate: Omit<UserTransactionRule, "id">,
  existing: readonly UserTransactionRule[],
  rows: readonly RuleImpactRow[],
): { matched: number; changed: number } {
  const before = classifierRulesWith(existing);
  // Placeholder id, sorted with the candidate's priority like a saved rule.
  const after = classifierRulesWith([
    ...existing,
    { ...candidate, id: Number.MAX_SAFE_INTEGER },
  ]);
  const candidateId = `${USER_RULE_ID_PREFIX}${Number.MAX_SAFE_INTEGER}`;
  let matched = 0;
  let changed = 0;
  for (const row of rows) {
    if (row.kindOverride) continue;
    const opts = { accountBalance: row.accountBalance };
    const next = effectiveTransactionKind(row.institution, row, {
      ...opts,
      rules: after,
    });
    if (next.ruleId !== candidateId) continue;
    matched++;
    const prev = effectiveTransactionKind(row.institution, row, {
      ...opts,
      rules: before,
    });
    if (prev.kind !== next.kind || prev.needsReview !== next.needsReview)
      changed++;
  }
  return { matched, changed };
}
