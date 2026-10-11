/** User transaction rules and read-time kinds. Invented rows only. */
import { describe, it, expect } from "vitest";
import {
  classifierRulesWith,
  effectiveTransactionKind,
  previewRuleImpact,
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

describe("previewRuleImpact", () => {
  const rows = [
    { ...row("ZZZ PAYROLL", 100), institution: "Example Bank" },
    { ...row("ZZZ PAYROLL", 100), institution: "Example Bank" },
    { ...row("ZZZ PAYROLL", 100), institution: "Other Bank" },
    {
      ...row("ZZZ PAYROLL", 100),
      institution: "Example Bank",
      kindOverride: "trade" as const,
      kindOverrideSource: "user" as const,
    },
  ];

  it("counts matching rows, skipping per-row choices and other institutions", () => {
    const { id: _id, ...candidate } = rule({ id: 0 });
    expect(previewRuleImpact(candidate, [], rows)).toEqual({
      matched: 2,
      changed: 2,
    });
  });

  it("counts nothing a higher-priority existing rule already claims", () => {
    const { id: _id, ...candidate } = rule({ id: 0 });
    const existing = [rule({ id: 7, priority: 9, kind: "trade" })];
    expect(previewRuleImpact(candidate, existing, rows)).toEqual({
      matched: 0,
      changed: 0,
    });
  });
});
