import { describe, it, expect } from "vitest";
import {
  routeWaterfall,
  routePercentage,
  routeFromSpecs,
} from "@/lib/calculators/engine/contribution-routing";
import {
  makeAccumulationConfig,
  makeYearLimits,
  makeEmployerMatch,
  makeContributionSpec,
} from "./fixtures/engine-fixtures";

function slotFor(
  slots: { category: string; employeeContrib: number }[],
  cat: string,
) {
  return slots.find((s) => s.category === cat);
}

// ---------------------------------------------------------------------------
// routeWaterfall
// ---------------------------------------------------------------------------

describe("routeWaterfall", () => {
  it("fills accounts in priority order up to IRS limits", () => {
    const config = makeAccumulationConfig({
      accountOrder: ["401k", "hsa", "ira", "brokerage"],
    });
    const { slots, warnings } = routeWaterfall(
      50000,
      config,
      makeYearLimits(),
      makeEmployerMatch(),
    );
    const s401k = slotFor(slots, "401k")!;
    expect(s401k.employeeContrib).toBe(23500); // IRS limit
    expect(s401k.cappedByAccount).toBe(false);

    const sHsa = slotFor(slots, "hsa")!;
    expect(sHsa.employeeContrib).toBe(4300); // IRS limit

    const sIra = slotFor(slots, "ira")!;
    expect(sIra.employeeContrib).toBe(7000); // IRS limit

    // Remainder to brokerage: 50000 - 23500 - 4300 - 7000 = 15200
    const sBrok = slotFor(slots, "brokerage")!;
    expect(sBrok.employeeContrib).toBeCloseTo(15200, 0);
    expect(warnings).toHaveLength(0);
  });

  it("warns when account order is empty", () => {
    const config = makeAccumulationConfig({ accountOrder: [] });
    const { warnings } = routeWaterfall(
      50000,
      config,
      makeYearLimits(),
      makeEmployerMatch(),
    );
    expect(warnings.some((w) => w.includes("No account order"))).toBe(true);
  });

  it("respects artificial account caps", () => {
    const config = makeAccumulationConfig({
      accountOrder: ["401k", "brokerage"],
      accountCaps: {
        "401k": 10000,
        "403b": null,
        hsa: null,
        ira: null,
        brokerage: null,
      },
    });
    const { slots } = routeWaterfall(
      30000,
      config,
      makeYearLimits(),
      makeEmployerMatch(),
    );
    const s401k = slotFor(slots, "401k")!;
    expect(s401k.employeeContrib).toBe(10000);
    expect(s401k.cappedByAccount).toBe(true);
  });

  it("applies tax splits (Roth/Traditional)", () => {
    const config = makeAccumulationConfig({
      accountOrder: ["401k", "brokerage"],
      taxSplits: { "401k": 0.7 }, // 70% Roth
    });
    const { slots } = routeWaterfall(
      23500,
      config,
      makeYearLimits(),
      makeEmployerMatch(),
    );
    const s401k = slotFor(slots, "401k")!;
    expect(s401k.rothContrib).toBeCloseTo(23500 * 0.7, 0);
    expect(s401k.traditionalContrib).toBeCloseTo(23500 * 0.3, 0);
  });

  it("enforces cross-account roth tax-type cap", () => {
    const config = makeAccumulationConfig({
      accountOrder: ["401k", "ira", "brokerage"],
      taxSplits: { "401k": 1.0, ira: 1.0 }, // 100% Roth
      taxTypeCaps: { traditional: null, roth: 15000 },
    });
    const { slots } = routeWaterfall(
      30000,
      config,
      makeYearLimits(),
      makeEmployerMatch(),
    );
    const totalRoth = slots.reduce((s, sl) => s + sl.rothContrib, 0);
    expect(totalRoth).toBeLessThanOrEqual(15000);
  });

  it("handles zero salary (zero contribution target)", () => {
    const config = makeAccumulationConfig();
    const { slots } = routeWaterfall(
      0,
      config,
      makeYearLimits(),
      makeEmployerMatch(),
    );
    expect(slots.every((s) => s.employeeContrib === 0)).toBe(true);
  });

  it("includes employer match in slot output", () => {
    const config = makeAccumulationConfig({
      accountOrder: ["401k", "brokerage"],
    });
    const { slots } = routeWaterfall(
      23500,
      config,
      makeYearLimits(),
      makeEmployerMatch({ "401k": 5000 }),
    );
    const s401k = slotFor(slots, "401k")!;
    expect(s401k.employerMatch).toBe(5000);
  });
});

// ---------------------------------------------------------------------------
// routePercentage
// ---------------------------------------------------------------------------

describe("routePercentage", () => {
  it("splits contributions by configured percentages", () => {
    const config = makeAccumulationConfig({
      routingMode: "percentage",
      accountSplits: {
        "401k": 0.5,
        "403b": 0,
        hsa: 0.15,
        ira: 0.15,
        brokerage: 0.2,
      },
    });
    const { slots } = routePercentage(
      40000,
      config,
      makeYearLimits(),
      makeEmployerMatch(),
    );
    const s401k = slotFor(slots, "401k")!;
    // 50% of 40k = 20000, plus overflow from HSA/IRA caps redistributed
    expect(s401k.employeeContrib).toBeGreaterThanOrEqual(20000);

    const sHsa = slotFor(slots, "hsa")!;
    expect(sHsa.employeeContrib).toBeCloseTo(4300, -2); // capped by IRS limit (4300 < 6000)
  });

  it("redistributes overflow from capped accounts", () => {
    const config = makeAccumulationConfig({
      routingMode: "percentage",
      accountSplits: {
        "401k": 0.3,
        "403b": 0,
        hsa: 0.7, // wants 70000, but HSA limit is 4300
        ira: 0,
        brokerage: 0,
      },
    });
    const { slots } = routePercentage(
      100000,
      config,
      makeYearLimits(),
      makeEmployerMatch(),
    );
    const sHsa = slotFor(slots, "hsa")!;
    expect(sHsa.employeeContrib).toBe(4300); // capped

    // 401k is also capped at IRS limit 23500. Overflow from both HSA and 401k
    // ultimately goes to brokerage.
    const s401k = slotFor(slots, "401k")!;
    expect(s401k.employeeContrib).toBe(23500); // capped at IRS limit

    // Remaining overflow goes to brokerage
    const sBrok = slotFor(slots, "brokerage")!;
    expect(sBrok.employeeContrib).toBeGreaterThan(0);
  });

  it("overflow ultimately goes to brokerage", () => {
    const config = makeAccumulationConfig({
      routingMode: "percentage",
      accountSplits: {
        "401k": 0.5,
        "403b": 0,
        hsa: 0.3,
        ira: 0.2,
        brokerage: 0,
      },
    });
    const { slots } = routePercentage(
      200000,
      config,
      makeYearLimits(),
      makeEmployerMatch(),
    );
    // All limited accounts should hit their IRS caps
    // Overflow to brokerage
    const sBrok = slotFor(slots, "brokerage")!;
    expect(sBrok.employeeContrib).toBeGreaterThan(0);
  });

  it("applies tax splits within each account", () => {
    const config = makeAccumulationConfig({
      routingMode: "percentage",
      accountSplits: {
        "401k": 1.0,
        "403b": 0,
        hsa: 0,
        ira: 0,
        brokerage: 0,
      },
      taxSplits: { "401k": 0.5 }, // 50% Roth
    });
    const { slots } = routePercentage(
      20000,
      config,
      makeYearLimits(),
      makeEmployerMatch(),
    );
    const s401k = slotFor(slots, "401k")!;
    expect(s401k.rothContrib).toBeCloseTo(10000, -2);
    expect(s401k.traditionalContrib).toBeCloseTo(10000, -2);
  });
});

// ---------------------------------------------------------------------------
// routeFromSpecs
//
// Pinned-value tests for the per-spec projection formula, ahead of a planned
// consolidation with the identical formula duplicated in
// individual-account-tracking.ts. These pin
// TODAY's output for each of the formula's 4 branches so the refactor can be
// verified to produce byte-identical results.
// ---------------------------------------------------------------------------

describe("routeFromSpecs", () => {
  const config = makeAccumulationConfig();

  it("percent_of_salary: projectedSalary × salaryFraction × value", () => {
    const spec = makeContributionSpec({
      category: "ira",
      method: "percent_of_salary",
      value: 0.1,
      salaryFraction: 0.5,
      taxTreatment: "pre_tax",
    });
    const { slots } = routeFromSpecs(
      [spec],
      130000,
      120000,
      makeYearLimits(),
      makeEmployerMatch(),
      1.03,
      config,
    );
    const ira = slotFor(slots, "ira")!;
    // 130000 * 0.5 * 0.1 = 6500
    expect(ira.employeeContrib).toBe(6500);
    expect(ira.rothContrib).toBe(0);
    expect(ira.traditionalContrib).toBe(6500);
  });

  it("contributionScaling fixed_amount: baseAnnual × limitGrowthFactor, salary-independent", () => {
    const spec = makeContributionSpec({
      category: "hsa",
      method: "fixed_monthly",
      contributionScaling: "fixed_amount",
      baseAnnual: 4000,
      taxTreatment: "hsa",
    });
    const { slots } = routeFromSpecs(
      [spec],
      130000,
      120000,
      makeYearLimits(),
      makeEmployerMatch(),
      1.03,
      config,
    );
    const hsa = slotFor(slots, "hsa")!;
    // 4000 * 1.03 = 4120, unaffected by projectedSalary/baseSalary
    expect(hsa.employeeContrib).toBe(4120);
  });

  it("fixedContribScalesWithSalary category: baseAnnual × (projectedSalary / baseSalary)", () => {
    const spec = makeContributionSpec({
      category: "brokerage",
      method: "fixed_monthly",
      baseAnnual: 10000,
      taxTreatment: "after_tax",
    });
    const { slots } = routeFromSpecs(
      [spec],
      130000,
      120000,
      makeYearLimits(),
      makeEmployerMatch(),
      1.03,
      config,
    );
    const brok = slotFor(slots, "brokerage")!;
    // 10000 * (130000 / 120000) = 10833.33
    expect(brok.employeeContrib).toBe(10833.33);
  });

  it("plain fixed (no scaling flag, no fixed_amount): baseAnnual × limitGrowthFactor", () => {
    const spec = makeContributionSpec({
      category: "403b",
      method: "fixed_monthly",
      baseAnnual: 5000,
      taxTreatment: "pre_tax",
    });
    const { slots } = routeFromSpecs(
      [spec],
      130000,
      120000,
      makeYearLimits(),
      makeEmployerMatch(),
      1.03,
      config,
    );
    const s403b = slotFor(slots, "403b")!;
    // 5000 * 1.03 = 5150, unaffected by projectedSalary/baseSalary
    expect(s403b.employeeContrib).toBe(5150);
  });
});
