/**
 * The payroll money W-2 wages leave out (`payrollTaxSkipped`): each slot's
 * part by its tax type, pre-tax and HSA, and payroll accounts only.
 * Self-derived.
 */
import { describe, expect, it } from "vitest";
import { payrollTaxSkipped } from "@/lib/pure/engine/projection-year-handlers/working-year-wages";
import type { AccumulationSlot } from "@/lib/pure/engine/types/routing";

const slot = (
  category: AccumulationSlot["category"],
  employeeContrib: number,
  rothContrib = 0,
): AccumulationSlot =>
  ({
    category,
    employeeContrib,
    rothContrib,
    traditionalContrib: employeeContrib - rothContrib,
  }) as AccumulationSlot;

describe("payrollTaxSkipped", () => {
  it("leaves out a 401(k)'s Traditional part and the HSA, not its Roth part", () => {
    // 15,000 of which 5,000 Roth: 10,000; HSA 4,000: 14,000.
    expect(
      payrollTaxSkipped([slot("401k", 15_000, 5_000), slot("hsa", 4_000)]),
    ).toBe(14_000);
  });

  it("after-tax brokerage saving and an IRA (not a payroll account) aren't left out", () => {
    expect(
      payrollTaxSkipped([slot("brokerage", 3_000), slot("ira", 6_000)]),
    ).toBe(0);
  });
});
