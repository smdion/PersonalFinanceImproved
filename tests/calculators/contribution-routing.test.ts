import { describe, it, expect } from "vitest";
import {
  routeWaterfall,
  routePercentage,
  routeFromSpecs,
  capSpecs,
  slotLimits,
} from "@/lib/calculators/engine/contribution-routing";
import type { ContributionSpec } from "@/lib/calculators/types";
import {
  makeAccumulationConfig,
  makeYearLimits,
  makeEmployerMatch,
  makeContributionSpec,
} from "./fixtures/engine-fixtures";

function slotFor<T extends { category: string }>(slots: T[], cat: string) {
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

/** Limits far above any fixture amount — the formula tests don't cap. */
const ROOMY_LIMITS = {
  "401k_employee_limit": 1e6,
  "401k_catchup_limit": 0,
  "401k_super_catchup_limit": 0,
  ira_limit: 1e6,
  ira_catchup_limit: 0,
  hsa_individual_limit: 1e6,
  hsa_family_limit: 1e6,
  hsa_catchup_limit: 0,
};

/** Cap (capSpecs) then route one year: salary 130,000 on a 120,000 base,
 *  limits grown 3%. */
function route(
  specs: ContributionSpec[],
  config: ReturnType<typeof makeAccumulationConfig>,
  limits: Record<string, number> = ROOMY_LIMITS,
  filingStatus = "Single",
) {
  const employerMatch = makeEmployerMatch();
  const capped = capSpecs(
    specs,
    { projectedSalary: 130000, salaryBase: 120000, limitGrowthFactor: 1.03 },
    {
      ctx: { taxYear: 2030, filingStatus, limits },
      people: [
        { id: 1, birthYear: 1990 },
        { id: 2, birthYear: 1990 },
      ],
      employerMatch,
      wagesByPerson: null,
    },
  );
  const yearLimits = slotLimits(
    capped.groupLimits,
    Object.fromEntries(
      specs.map((sp, i) => [sp.category, capped.capped[i]!.cappedAnnual]),
    ),
  );
  return routeFromSpecs(specs, capped, yearLimits, employerMatch, config);
}

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
    const { slots } = route([spec], config);
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
    const { slots } = route([spec], config);
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
    const { slots } = route([spec], config);
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
    const { slots } = route([spec], config);
    const s403b = slotFor(slots, "403b")!;
    // 5000 * 1.03 = 5150, unaffected by projectedSalary/baseSalary
    expect(s403b.employeeContrib).toBe(5150);
  });
});

describe("routeFromSpecs — IRS caps per person", () => {
  const limits = { ...ROOMY_LIMITS, "401k_employee_limit": 20000 };

  it("caps each person at their own limit and overflows the excess to brokerage", () => {
    const { slots, warnings, totalOverflow } = route(
      [
        makeContributionSpec({
          category: "401k",
          method: "fixed_monthly",
          baseAnnual: 25000 / 1.03,
          taxTreatment: "tax_free",
          personId: 1,
          ownerName: "Avery",
        }),
        makeContributionSpec({
          category: "401k",
          method: "fixed_monthly",
          baseAnnual: 10000 / 1.03,
          taxTreatment: "pre_tax",
          personId: 2,
          ownerName: "Blake",
        }),
      ],
      makeAccumulationConfig(),
      limits,
    );
    const k = slotFor(slots, "401k")!;
    expect(k.employeeContrib).toBe(30000); // 20,000 + 10,000
    // The Roth share comes from the capped amounts: Avery's 20,000 Roth.
    expect(k.rothContrib).toBe(20000);
    expect(k.traditionalContrib).toBe(10000);
    expect(k.irsLimit).toBe(40000); // each person's limit, once
    expect(totalOverflow).toBe(5000);
    expect(slotFor(slots, "brokerage")!.employeeContrib).toBe(5000);
    expect(warnings.join(" ")).toContain("Avery");
  });

  it("applies the household's account cap after the IRS caps", () => {
    const config = makeAccumulationConfig();
    config.accountCaps["401k"] = 12000;
    const { slots, totalOverflow, warnings } = route(
      [
        makeContributionSpec({
          category: "401k",
          method: "fixed_monthly",
          baseAnnual: 15000 / 1.03,
          taxTreatment: "pre_tax",
          personId: 1,
        }),
      ],
      config,
      limits,
    );
    expect(slotFor(slots, "401k")!.employeeContrib).toBe(12000);
    expect(totalOverflow).toBe(3000);
    expect(warnings.join(" ")).toContain("account limit");
  });
});

describe("slotLimits", () => {
  it("splits a shared group's limit by employee money, room left to the leader", () => {
    const groups = new Map([["401k", 40000]]);
    expect(slotLimits(groups, { "401k": 10000, "403b": 5000 })).toMatchObject({
      "401k": 35000,
      "403b": 5000,
    });
    expect(slotLimits(groups, { "401k": 30000, "403b": 30000 })).toMatchObject({
      "401k": 20000,
      "403b": 20000,
    });
    expect(slotLimits(groups, {})).toMatchObject({ "401k": 40000, "403b": 0 });
  });
});

describe("routeFromSpecs — HSA with no coverage type", () => {
  it("is capped at the self-only limit (the lower bound), excess to brokerage", () => {
    const limits = {
      ...ROOMY_LIMITS,
      hsa_individual_limit: 4000,
      hsa_family_limit: 8000,
    };
    const { slots, totalOverflow } = route(
      [
        makeContributionSpec({
          category: "hsa",
          method: "fixed_monthly",
          baseAnnual: 6000 / 1.03,
          taxTreatment: "hsa",
          personId: 1,
          hsaCoverageType: null,
        }),
      ],
      makeAccumulationConfig(),
      limits,
    );
    const hsa = slotFor(slots, "hsa")!;
    expect(hsa.employeeContrib).toBe(4000);
    expect(hsa.irsLimit).toBe(4000);
    expect(totalOverflow).toBe(2000);
  });
});
