/**
 * T24 — locks in H10: retirement catch-up/super-catch-up contribution
 * eligibility must be gated per-person (by each individual's own projected
 * age), not by a household-average age.
 *
 * Before the fix, a 40-year-old and a 61-year-old contributing to the same
 * 401k limit group got a single averaged age (51) applied to both — so
 * BOTH received the standard $7,500 catchup (total $15,000 extra room)
 * instead of only the 61-year-old getting the SECURE 2.0 super-catchup
 * ($11,250), a $3,750 overstatement of legal contribution room.
 */
import { describe, it, expect } from "vitest";
import { calculateProjection } from "@/lib/calculators/engine";
import type {
  ProjectionInput,
  ContributionSpec,
  AccountCategory,
} from "@/lib/calculators/types";
import { capsFromBaseLimits, withCapsAge } from "../helpers/irs-limit-caps";
import { shippedTaxTables } from "../helpers/tax-data";

const AS_OF = new Date("2025-01-01");

function makeInput(overrides: Partial<ProjectionInput> = {}): ProjectionInput {
  return withCapsAge({
    accumulationDefaults: {
      contributionRate: 0.25,
      routingMode: "waterfall",
      accountOrder: ["401k", "403b", "hsa", "ira", "brokerage"],
      accountSplits: {
        "401k": 0.4,
        "403b": 0,
        hsa: 0.1,
        ira: 0.15,
        brokerage: 0.35,
      },
      taxSplits: { "401k": 0.5, ira: 1.0 },
    },
    decumulationDefaults: {
      withdrawalRate: 0.04,
      withdrawalRoutingMode: "waterfall",
      withdrawalOrder: ["401k", "403b", "ira", "brokerage", "hsa"],
      withdrawalSplits: {
        "401k": 0.35,
        "403b": 0,
        ira: 0.25,
        brokerage: 0.3,
        hsa: 0.1,
      },
      withdrawalTaxPreference: { "401k": "traditional", ira: "traditional" },
      distributionTaxRates: {
        ...shippedTaxTables(),
        traditionalFallbackRate: 0.22,
        roth: 0,
        hsa: 0,
        brokerage: 0.15,
      },
    },
    accumulationOverrides: [],
    decumulationOverrides: [],
    currentAge: 40,
    retirementAge: 65,
    projectionEndAge: 90,
    currentSalary: 150000,
    salaryGrowthRate: 0.03,
    salaryCap: null,
    salaryOverrides: [],
    budgetOverrides: [],
    irsLimitCaps: capsFromBaseLimits({
      baseLimits: {
        "401k": 23500,
        "403b": 23500,
        hsa: 4300,
        ira: 7000,
        brokerage: 0,
      },
      catchupLimits: {
        "401k": 7500,
        ira: 1000,
        hsa: 1000,
        "401k_super": 11250,
      },
      currentAge: 40,
    }),
    limitGrowthRate: 0.02,

    employerMatchRateByCategory: {
      "401k": 0.03,
      "403b": 0,
      hsa: 0,
      ira: 0,
      brokerage: 0,
    },
    startingBalances: {
      preTax: 110000,
      taxFree: 40000,
      afterTax: 30000,
      afterTaxBasis: 20000,
      hsa: 15000,
    },
    startingAccountBalances: {
      "401k": {
        structure: "roth_traditional",
        traditional: 80000,
        roth: 20000,
      },
      "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
      hsa: { structure: "single_bucket", balance: 15000 },
      ira: { structure: "roth_traditional", traditional: 30000, roth: 20000 },
      brokerage: { structure: "basis_tracking", balance: 30000, basis: 20000 },
    },
    annualExpenses: 72000,
    inflationRate: 0.025,
    returnRates: [{ label: "7%", rate: 0.07 }],
    socialSecurityAnnual: 36000,
    ssStartAge: 67,
    asOfDate: AS_OF,
    ...overrides,
  });
}

describe("T24 — per-person catch-up gating (H10)", () => {
  it("grants super-catchup only to the 61-year-old, not standard catchup to both", () => {
    // AS_OF is 2025-01-01, so projection year 0 = 2025.
    // Person 1: born 1985 -> age 40 in 2025 (under catchupAge 50, gets nothing extra)
    // Person 2: born 1964 -> age 61 in 2025 (in superCatchupAgeRange [60,63])
    const specs: ContributionSpec[] = [
      {
        category: "401k" as AccountCategory,
        name: "401k — Person 1",
        method: "fixed_monthly",
        value: 1000,
        salaryFraction: 1,
        periodsPerYear: 12,
        baseAnnual: 12000,
        taxTreatment: "pre_tax",
        personId: 1,
      },
      {
        category: "401k" as AccountCategory,
        name: "401k — Person 2",
        method: "fixed_monthly",
        value: 1000,
        salaryFraction: 1,
        periodsPerYear: 12,
        baseAnnual: 12000,
        taxTreatment: "pre_tax",
        personId: 2,
      },
    ];

    const base = makeInput({ contributionSpecs: specs });
    const input = makeInput({
      contributionSpecs: specs,
      irsLimitCaps: {
        ...base.irsLimitCaps,
        people: [
          { id: 1, birthYear: 1985 },
          { id: 2, birthYear: 1964 },
        ],
      },
    });

    const result = calculateProjection(input);
    const year0 = result.projectionByYear[0];
    if (year0!.phase !== "accumulation")
      throw new Error("expected year 0 to be accumulation phase");
    const slot401k = year0!.slots.find((s) => s.category === "401k");
    if (!slot401k) throw new Error("expected a 401k slot in year 0");

    // Each person's own limit: person 1 23,500 (too young for catch-up),
    // person 2 23,500 + super catch-up 11,250 — never standard catch-up
    // for both, and never one household limit shared by the two.
    expect(slot401k.irsLimit).toBe(23500 + 23500 + 11250);
  });

  it("a spec with no owner is held to the household's limit, catch-up by age", () => {
    // One person aged 55 (catch-up, not super catch-up); a joint spec has no
    // limit of its own, so the household's applies.
    const specs: ContributionSpec[] = [
      {
        category: "401k" as AccountCategory,
        name: "401k",
        method: "fixed_monthly",
        value: 2000,
        salaryFraction: 1,
        periodsPerYear: 12,
        baseAnnual: 24000,
        taxTreatment: "pre_tax",
      },
    ];

    const input = makeInput({
      contributionSpecs: specs,
      currentAge: 55, // >= catchupAge 50, < superCatchupAgeRange[0] 60
    });

    const result = calculateProjection(input);
    const year0 = result.projectionByYear[0];
    if (year0!.phase !== "accumulation")
      throw new Error("expected year 0 to be accumulation phase");
    const slot401k = year0!.slots.find((s) => s.category === "401k");
    if (!slot401k) throw new Error("expected a 401k slot in year 0");

    expect(slot401k.irsLimit).toBe(23500 + 7500);
  });
});

describe("year 0 — a contribution over its IRS limit, late in the year", () => {
  it("has only max(0, capped − configured × elapsed) left, not capped × the rest of the year", () => {
    const spec = (configuredAnnual?: number): ContributionSpec => ({
      category: "401k" as AccountCategory,
      name: "401k",
      method: "fixed_monthly",
      value: 23500 / 12,
      salaryFraction: 1,
      baseAnnual: 23500, // capped
      taxTreatment: "pre_tax",
      personId: 1,
      ...(configuredAnnual !== undefined ? { configuredAnnual } : {}),
    });
    const zero = { "401k": 0, "403b": 0, hsa: 0, ira: 0, brokerage: 0 };
    const run = (s: ContributionSpec) => {
      const year0 = calculateProjection(
        makeInput({
          asOfDate: new Date("2025-10-01"),
          contributionSpecs: [s],
          baseYearContributions: { ...zero, "401k": 23500 },
          baseYearEmployerMatch: zero,
        }),
      ).projectionByYear[0]!;
      if (year0.phase !== "accumulation") throw new Error("accumulation");
      return year0.slots.find((x) => x.category === "401k")!.employeeContrib;
    };
    const plain = run(spec());
    const proRate = plain / 23500;
    // Configured at 30,000: by October most of the limit is already used.
    expect(run(spec(30000))).toBeCloseTo(
      Math.max(0, 23500 - 30000 * (1 - proRate)),
      1,
    );
    // So far over that the limit was reached before now: nothing left.
    expect(run(spec(200000))).toBe(0);
  });
});
