/**
 * `describeEligibility` words an account's eligibility exactly as
 * `computeWithdrawalEligibility` wrote it as prose before it returned a
 * structured reason (v0.10.3 plan commit 11): one case per string it
 * emitted, the expected text copied from that code.
 */
import { describe, it, expect } from "vitest";
import { describeEligibility } from "@/lib/config/eligibility-labels";
import type { EligibilityReason } from "@/lib/config/eligibility-reason";

const CASES: [EligibilityReason, string][] = [
  [{ kind: "no_owner" }, "No individual eligibility rule (joint account)"],
  [{ kind: "age_reached", gate: "age_59_half" }, "Eligible — age 59½ or older"],
  [
    { kind: "basis_remaining", basis: 15000 },
    "Eligible — $15,000.00 basis remaining, always penalty-free",
  ],
  [
    { kind: "basis_remaining", basis: 0 },
    "Eligible — $0.00 basis remaining, always penalty-free",
  ],
  [
    { kind: "basis_partial", basis: 15000, growthLocked: 2500.5 },
    "Partially eligible — $15,000.00 basis penalty-free, $2,500.50 growth locked until 59½",
  ],
  [{ kind: "no_basis" }, "Locked until age 59½ — no basis remaining"],
  [
    { kind: "locked", gate: "age_59_half", currentAge: 52 },
    "Locked until age 59½ (currently 52)",
  ],
  [
    { kind: "rule_of_55", separationYear: 2044 },
    "Eligible — Rule of 55 met (separated 2044)",
  ],
  [{ kind: "rule_of_55" }, "Eligible — Rule of 55 met"],
  [
    { kind: "locked", gate: "rule_of_55_unavailable", currentAge: 54 },
    "Locked until age 59½ — Rule of 55 marked unavailable for forecasting (currently 54)",
  ],
  [
    { kind: "locked", gate: "rule_of_55_or_age", currentAge: 40 },
    "Locked until Rule of 55 or age 59½ (currently 40)",
  ],
  [
    { kind: "locked", gate: "hsa_age_65", currentAge: 61 },
    "Locked until age 65 — non-medical withdrawal penalty (currently 61)",
  ],
  [{ kind: "age_reached", gate: "hsa_age_65" }, "Eligible — age 65 or older"],
  [
    { kind: "always_available" },
    "Always accessible — no age or employer restriction",
  ],
];

describe("describeEligibility", () => {
  it.each(CASES)("%j", (reason, text) => {
    expect(describeEligibility(reason)).toBe(text);
  });

  it("covers every kind and every locked gate", () => {
    const kinds = new Set(CASES.map(([r]) => r.kind));
    expect([...kinds].sort()).toEqual(
      [
        "age_reached",
        "always_available",
        "basis_partial",
        "basis_remaining",
        "locked",
        "no_basis",
        "no_owner",
        "rule_of_55",
      ].sort(),
    );
    const gates = new Set(
      CASES.flatMap(([r]) => (r.kind === "locked" ? [r.gate] : [])),
    );
    expect(gates.size).toBe(4);
  });
});
