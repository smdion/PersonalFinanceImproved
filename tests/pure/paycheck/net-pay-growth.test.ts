/**
 * `projectedNetPay` (lib/pure/paycheck/net-pay-growth.ts): the one growth
 * walk both extra-paycheck materializers (Budget and Savings mode) use for
 * a later year's net pay (CALCULATIONS PAY-30). Guards the cross-path rule:
 * a percentage applies to the running pay, a dollar bump carries forward,
 * and a year with no entry (or a zero one) leaves the pay alone.
 */
import { describe, it, expect } from "vitest";
import { projectedNetPay } from "@/lib/pure/paycheck/net-pay-growth";

describe("projectedNetPay", () => {
  it("returns the base for the base year or earlier", () => {
    expect(
      projectedNetPay(2000, 2026, 2026, { "2026": { type: "pct", value: 10 } }),
    ).toBe(2000);
    expect(projectedNetPay(2000, 2025, 2026, {})).toBe(2000);
  });

  it("compounds percentages on the running pay and carries dollar bumps", () => {
    // 2027: +10% -> 2200; 2028: none; 2029: +$100 -> 2300; 2030: +10% -> 2530.
    const growth = {
      "2027": { type: "pct" as const, value: 10 },
      "2028": { type: "pct" as const, value: 0 },
      "2029": { type: "dollar" as const, value: 100 },
      "2030": { type: "pct" as const, value: 10 },
    };
    expect(projectedNetPay(2000, 2029, 2026, growth)).toBe(2300);
    expect(projectedNetPay(2000, 2030, 2026, growth)).toBeCloseTo(2530, 9);
  });
});
