/** User transaction rules and read-time kinds. Invented rows only. */
import { describe, it, expect } from "vitest";
import {
  balanceAsOf,
  classifierRulesWith,
  effectiveTransactionKind,
  toClassifierRules,
  type UserTransactionRule,
} from "@/lib/pure/investment-transaction-rules";

const rule = (
  over: Partial<UserTransactionRule> & { id: number },
): UserTransactionRule => ({
  institutionContains: "Example Bank",
  descriptionContains: "PAYROLL",
  sign: null,
  kind: "contribution",
  reviewWhen: null,
  maxFractionOfBalance: null,
  priority: 0,
  ...over,
});

const row = (description: string, amount: number) => ({
  amount,
  description,
  kindOverride: null,
  kindOverrideSource: null,
});

describe("toClassifierRules", () => {
  it("matches text as a case-insensitive substring, never as a pattern", () => {
    const [r] = toClassifierRules([
      rule({ id: 1, descriptionContains: "A+B (x)" }),
    ]);
    expect(r!.description.test("transfer a+b (x) in")).toBe(true);
    expect(r!.description.test("AAB x")).toBe(false);
  });

  it("orders by priority, then age", () => {
    const ids = toClassifierRules([
      rule({ id: 3 }),
      rule({ id: 1 }),
      rule({ id: 2, priority: 5 }),
    ]).map((r) => r.id);
    expect(ids).toEqual(["user-2", "user-1", "user-3"]);
  });
});

describe("effectiveTransactionKind", () => {
  it("household rules win over built-in ones", () => {
    const rules = classifierRulesWith([
      rule({ id: 1, descriptionContains: "DIVIDEND", kind: "contribution" }),
    ]);
    const k = effectiveTransactionKind("Example Bank", row("DIVIDEND", 10), {
      rules,
    });
    expect(k).toMatchObject({
      kind: "contribution",
      source: "user_rule",
      ruleId: "user-1",
      needsReview: false,
    });
  });

  it("an institution-scoped rule leaves other institutions alone", () => {
    const rules = classifierRulesWith([rule({ id: 1 })]);
    const k = effectiveTransactionKind("Other Bank", row("PAYROLL", 10), {
      rules,
    });
    expect(k.source).not.toBe("user_rule");
  });

  it("a per-row choice wins over every rule", () => {
    const rules = classifierRulesWith([rule({ id: 1 })]);
    const k = effectiveTransactionKind(
      "Example Bank",
      {
        ...row("PAYROLL", 10),
        kindOverride: "other",
        kindOverrideSource: "user",
      },
      { rules },
    );
    expect(k).toMatchObject({ kind: "other", source: "override" });
  });

  it("reports the ingest lock separately from a user choice", () => {
    const k = effectiveTransactionKind(
      "Example Bank",
      {
        ...row("Medical withdrawal", -10),
        kindOverride: "withdrawal",
        kindOverrideSource: "ingest_redacted",
      },
      { rules: classifierRulesWith([]) },
    );
    expect(k).toMatchObject({ kind: "withdrawal", source: "locked" });
  });

  it("leaves unmatched rows for review", () => {
    const k = effectiveTransactionKind("Example Bank", row("ZZZ 123", 10), {
      rules: classifierRulesWith([]),
    });
    expect(k).toMatchObject({
      kind: "other",
      source: "unmatched",
      needsReview: true,
    });
  });
});

describe("sign fix with household rules", () => {
  // Built-in: Fidelity plan "contribution" rows are money in whatever sign
  // the feed sends (absoluteAmount).
  const flipped = row("contribution", -50);

  it("a household rule agreeing on the kind keeps the built-in fix", () => {
    const rules = classifierRulesWith([
      rule({
        id: 1,
        institutionContains: "Fidelity",
        descriptionContains: "contribution",
        kind: "contribution",
      }),
    ]);
    const k = effectiveTransactionKind("Fidelity Investments", flipped, {
      rules,
    });
    expect(k).toMatchObject({
      kind: "contribution",
      amount: 50,
      source: "user_rule",
      needsReview: false,
    });
  });

  it("a household rule choosing another kind uses the amount as sent", () => {
    const rules = classifierRulesWith([
      rule({
        id: 1,
        institutionContains: "Fidelity",
        descriptionContains: "contribution",
        kind: "withdrawal",
      }),
    ]);
    const k = effectiveTransactionKind("Fidelity Investments", flipped, {
      rules,
    });
    expect(k).toMatchObject({ kind: "withdrawal", amount: -50 });
  });
});

describe("balanceAsOf", () => {
  const history = [
    { day: "2026-05-10", balance: 1000 },
    { day: "2026-05-20", balance: 2000 },
  ];
  it("uses the last balance on or before the day", () => {
    expect(balanceAsOf(history, "2026-05-10")).toBe(1000);
    expect(balanceAsOf(history, "2026-05-19")).toBe(1000);
    expect(balanceAsOf(history, "2026-05-25")).toBe(2000);
  });
  it("uses the earliest balance for older rows", () => {
    expect(balanceAsOf(history, "2026-04-01")).toBe(1000);
  });
  it("has nothing without history", () => {
    expect(balanceAsOf([], "2026-04-01")).toBeUndefined();
  });
});
