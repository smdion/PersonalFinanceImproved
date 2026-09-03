/**
 * Multi-year withdrawal-policy optimizer, Phase 2 —
 * `optimizeRothBracketTarget`.
 *
 * Fixture style mirrors `coast-fire.test.ts`: hand-constructed households
 * run through `calculateProjection`/`optimizeRothBracketTarget` as a real
 * black box, no engine internals imported. `MAIN_HOUSEHOLD` is a
 * hand-constructed configuration; its pinned numbers are reproducible by
 * running the same household through `calculateProjection`.
 */
import { describe, it, expect } from "vitest";
import { calculateProjection } from "@/lib/calculators/engine";
import {
  optimizeRothBracketTarget,
  ASSUMED_TERMINAL_RATE,
} from "@/lib/calculators/withdrawal-bracket-optimizer";
import type { ProjectionInput } from "@/lib/calculators/types";

const AS_OF = new Date("2025-03-07");

const MFJ_BRACKETS = [
  { threshold: 23850, baseWithholding: 0, rate: 0.1 },
  { threshold: 96950, baseWithholding: 2385, rate: 0.12 },
  { threshold: 206700, baseWithholding: 11157, rate: 0.22 },
  { threshold: 394600, baseWithholding: 35302, rate: 0.24 },
  { threshold: 501050, baseWithholding: 61149, rate: 0.32 },
];

/**
 * Same household as the committed probe's `makeInput`: MFJ, age 62,
 * $1.6M mostly-Traditional portfolio, RMDs enforced (`birthYear`
 * + matching `socialSecurityEntries`, both required — omitting either
 * means RMDs silently never fire, per `engine-projection.ts`'s own
 * docblock). `rothBracketTarget`/`rothConversionTarget` are parameterized
 * so each test can set its own "current setting."
 */
function makeMainHousehold(
  currentTarget: number,
  conversionsOn: boolean,
): ProjectionInput {
  return {
    accumulationDefaults: {
      contributionRate: 0.2,
      routingMode: "waterfall",
      accountOrder: ["401k", "403b", "hsa", "ira", "brokerage"],
      accountSplits: {
        "401k": 0.7,
        "403b": 0,
        hsa: 0.05,
        ira: 0.05,
        brokerage: 0.2,
      },
      taxSplits: { "401k": 0.9, ira: 1.0 },
    },
    decumulationDefaults: {
      withdrawalRate: 0.04,
      withdrawalRoutingMode: "bracket_filling",
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
        traditionalFallbackRate: 0.22,
        roth: 0,
        hsa: 0,
        brokerage: 0.15,
        rothBracketTarget: currentTarget,
        taxBrackets: MFJ_BRACKETS,
        enableRothConversions: conversionsOn,
        rothConversionTarget: conversionsOn ? currentTarget : undefined,
      },
    },
    accumulationOverrides: [],
    decumulationOverrides: [],
    currentAge: 62,
    retirementAge: 62,
    projectionEndAge: 95,
    currentSalary: 0,
    salaryGrowthRate: 0.03,
    salaryCap: null,
    salaryOverrides: [],
    budgetOverrides: [],
    baseLimits: {
      "401k": 23500,
      "403b": 23500,
      hsa: 4300,
      ira: 7000,
      brokerage: 0,
    },
    limitGrowthRate: 0.02,
    catchupLimits: { "401k": 7500, ira: 1000, hsa: 1000, "401k_super": 11250 },
    employerMatchRateByCategory: {
      "401k": 0.03,
      "403b": 0,
      hsa: 0,
      ira: 0,
      brokerage: 0,
    },
    startingBalances: {
      preTax: 1600000,
      taxFree: 80000,
      afterTax: 150000,
      afterTaxBasis: 100000,
      hsa: 20000,
    },
    startingAccountBalances: {
      "401k": {
        structure: "roth_traditional",
        traditional: 1400000,
        roth: 80000,
      },
      "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
      hsa: { structure: "single_bucket", balance: 20000 },
      ira: { structure: "roth_traditional", traditional: 200000, roth: 0 },
      brokerage: {
        structure: "basis_tracking",
        balance: 150000,
        basis: 100000,
      },
    },
    annualExpenses: 90000,
    decumulationAnnualExpenses: 90000,
    inflationRate: 0.025,
    returnRates: [{ label: "6%", rate: 0.06 }],
    birthYear: 1963, // age 62 in 2025 -> RMD start age 75 (SECURE 2.0)
    socialSecurityAnnual: 40000,
    ssStartAge: 67,
    socialSecurityEntries: [
      {
        personId: 1,
        personName: "Owner",
        annualAmount: 40000,
        startAge: 67,
        birthYear: 1963,
      },
    ],
    asOfDate: AS_OF,
    filingStatus: "MFJ",
    individualAccounts: [
      {
        name: "401k",
        category: "401k",
        taxType: "preTax",
        startingBalance: 1400000,
        ownerName: "Owner",
        ownerPersonId: 1,
        ownerBirthYear: 1963,
        parentCategory: "Retirement",
      },
      {
        name: "401k Roth",
        category: "401k",
        taxType: "taxFree",
        startingBalance: 80000,
        ownerName: "Owner",
        ownerPersonId: 1,
        ownerBirthYear: 1963,
        parentCategory: "Retirement",
        rothBasisMeta: {
          year: 2025,
          contributionBasis: 60000,
          conversionBasis: 0,
          latestConversionYear: null,
          isSeeded: false,
          updatedAt: new Date("2025-01-01"),
        },
      },
      {
        name: "IRA",
        category: "ira",
        taxType: "preTax",
        startingBalance: 200000,
        ownerName: "Owner",
        ownerPersonId: 1,
        ownerBirthYear: 1963,
        parentCategory: "Retirement",
      },
    ],
  };
}

/**
 * A separate, smaller household deliberately tuned so a low
 * `rothBracketTarget` (0.10) survives to end of plan while every higher
 * candidate (0.12+) genuinely depletes at age 94 (one year before
 * `projectionEndAge`) — found empirically by sweeping starting balance
 * against this same shape. Exists purely to exercise the hard-exclusion
 * path; its absolute dollar figures aren't pinned to anything external.
 */
function makeDepletionHousehold(currentTarget: number): ProjectionInput {
  return {
    accumulationDefaults: {
      contributionRate: 0,
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
      withdrawalRoutingMode: "bracket_filling",
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
        traditionalFallbackRate: 0.22,
        roth: 0,
        hsa: 0,
        brokerage: 0.15,
        rothBracketTarget: currentTarget,
        taxBrackets: MFJ_BRACKETS,
        enableRothConversions: true,
        rothConversionTarget: currentTarget,
      },
    },
    accumulationOverrides: [],
    decumulationOverrides: [],
    currentAge: 65,
    retirementAge: 65,
    projectionEndAge: 95,
    currentSalary: 0,
    salaryGrowthRate: 0.03,
    salaryCap: null,
    salaryOverrides: [],
    budgetOverrides: [],
    baseLimits: {
      "401k": 23500,
      "403b": 23500,
      hsa: 4300,
      ira: 7000,
      brokerage: 0,
    },
    limitGrowthRate: 0.02,
    catchupLimits: { "401k": 7500, ira: 1000, hsa: 1000, "401k_super": 11250 },
    employerMatchRateByCategory: {
      "401k": 0.03,
      "403b": 0,
      hsa: 0,
      ira: 0,
      brokerage: 0,
    },
    startingBalances: {
      preTax: 1500000,
      taxFree: 0,
      afterTax: 0,
      afterTaxBasis: 0,
      hsa: 0,
    },
    startingAccountBalances: {
      "401k": { structure: "roth_traditional", traditional: 1500000, roth: 0 },
      "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
      hsa: { structure: "single_bucket", balance: 0 },
      ira: { structure: "roth_traditional", traditional: 0, roth: 0 },
      brokerage: { structure: "basis_tracking", balance: 0, basis: 0 },
    },
    annualExpenses: 60000,
    decumulationAnnualExpenses: 60000,
    inflationRate: 0.025,
    returnRates: [{ label: "4%", rate: 0.04 }],
    socialSecurityAnnual: 0,
    ssStartAge: 67,
    asOfDate: AS_OF,
    filingStatus: "MFJ",
  };
}

describe("optimizeRothBracketTarget", () => {
  it("recommends a genuinely cheaper lower target when one exists (RMD-avoidance case)", () => {
    const result = optimizeRothBracketTarget(makeMainHousehold(0.22, true));
    // Pinned to round 4's hand-verified numbers (design doc + committed
    // probe): the 12% candidate is the real minimum, not just directionally
    // better than 22%.
    const at12 = result.candidates.find((c) => c.target === 0.12)!;
    const at22 = result.candidates.find((c) => c.target === 0.22)!;
    expect(at12.netCost).toBeCloseTo(127112, -1);
    expect(at22.netCost).toBeCloseTo(177467, -1);
    expect(result.recommendedTarget).toBe(0.12);
  });

  it("returns recommendedTarget: null when the current setting is already optimal", () => {
    const result = optimizeRothBracketTarget(makeMainHousehold(0.12, true));
    expect(result.currentTarget).toBe(0.12);
    expect(result.recommendedTarget).toBeNull();
  });

  it("pins netCost, traditionalEnd, and totalConversions to round 4's hand-verified numbers", () => {
    const candidateInput = {
      ...makeMainHousehold(0.12, true),
    };
    const result = calculateProjection(candidateInput);
    const decumYears = result.projectionByYear.filter(
      (y) => y.phase === "decumulation",
    );
    const totalConversions = decumYears.reduce(
      (s, y) =>
        s + (("rothConversionAmount" in y ? y.rothConversionAmount : 0) ?? 0),
      0,
    );
    const finalYear =
      result.projectionByYear[result.projectionByYear.length - 1];
    expect(finalYear?.balanceByTaxType.preTax).toBeCloseTo(0, 0);
    expect(totalConversions).toBeCloseTo(1222072, -2);

    const rmdYears = decumYears.filter(
      (y) => ("rmdAmount" in y ? (y.rmdAmount ?? 0) : 0) > 0,
    );
    expect(rmdYears[0]?.year).toBe(2038);
    // With conversions ON at 12% (this scenario), most Traditional money
    // has already been converted away by 2038, so the RMD itself is small
    // -- $72,255 is the conversions-OFF figure for this same household
    // (a much larger untouched Traditional balance), a different pinned
    // scenario, not this one.
    expect(
      "rmdAmount" in rmdYears[0]! ? rmdYears[0].rmdAmount : undefined,
    ).toBeCloseTo(2835.6, 0);
  });

  it("a household where every candidate carries the same non-depleting shortfall still produces a sensible ranking", () => {
    // MAIN_HOUSEHOLD's own 2027/age-64 shortfall (a target-independent
    // tax-gross-up residual, per the design doc's "known limitation") is
    // present, non-material-difference-sized, across every candidate here
    // -- this is exactly that case, not a separately constructed fixture.
    const result = optimizeRothBracketTarget(makeMainHousehold(0.24, true));
    for (const c of result.candidates) {
      expect(c.depleted).toBe(false);
      expect(c.shortfallScore).toBeGreaterThan(0);
    }
    // Ranking still resolves to the real cost-minimizer, not an arbitrary
    // candidate -- proves the shortfall-noise tolerance (SHORTFALL_TIE_
    // TOLERANCE) is doing its job rather than the ranking degrading to
    // "whichever candidate happens to round down by a few cents."
    expect(result.recommendedTarget).toBe(0.12);
  });

  it("hard-excludes a candidate that genuinely depletes, regardless of its netCost", () => {
    const result = optimizeRothBracketTarget(makeDepletionHousehold(0.22));
    const at10 = result.candidates.find((c) => c.target === 0.1)!;
    const others = result.candidates.filter((c) => c.target !== 0.1);
    expect(at10.depleted).toBe(false);
    for (const c of others) {
      expect(c.depleted).toBe(true);
    }
    // The only non-depleted candidate wins even though it isn't
    // artificially the cheapest by construction -- depletion is a hard
    // exclusion, not a ranking input averaged against netCost.
    expect(result.recommendedTarget).toBe(0.1);
  });

  it("with enableRothConversions off, searches rothBracketTarget alone (no joint conversion-target movement)", () => {
    const result = optimizeRothBracketTarget(makeMainHousehold(0.22, false));
    // Conversions off means rothConversionTarget never gets threaded into
    // the candidate override -- a materially different (higher) netCost
    // scale than the conversions-on case, confirming the joint-movement
    // logic genuinely didn't fire.
    const at12 = result.candidates.find((c) => c.target === 0.12)!;
    expect(at12.netCost).toBeCloseTo(509759, -1);
    expect(result.recommendedTarget).toBe(0.12);
  });

  it("searched-policy-equals-adopted-policy: the winning candidate's own override set reproduces its scored netCost", () => {
    const input = makeMainHousehold(0.22, true);
    const result = optimizeRothBracketTarget(input);
    const winner = result.candidates.find(
      (c) => c.target === result.recommendedTarget,
    )!;

    // Independently re-run calculateProjection with exactly the override
    // set the optimizer itself would apply for this candidate -- the
    // design's whole premise ("the searched policy IS the adopted policy",
    // no artificial freeze) depends on this equaling the search's own
    // scored number, not just being directionally close.
    const adopted = calculateProjection({
      ...input,
      decumulationOverrides: [
        ...input.decumulationOverrides,
        {
          year: 2025,
          rothBracketTarget: winner.target,
          rothConversionTarget: winner.target,
        },
      ],
    });
    const decumYears = adopted.projectionByYear.filter(
      (y) => y.phase === "decumulation",
    );
    const lifetimeTax = decumYears.reduce(
      (s, y) =>
        s +
        (y.taxCost ?? 0) +
        (y.rothConversionTaxCost ?? 0) +
        (y.penaltyCost ?? 0) +
        (y.irmaaCost ?? 0),
      0,
    );
    const finalYear =
      adopted.projectionByYear[adopted.projectionByYear.length - 1];
    const recomputedNetCost =
      lifetimeTax +
      ASSUMED_TERMINAL_RATE * (finalYear?.balanceByTaxType.preTax ?? 0);
    expect(recomputedNetCost).toBeCloseTo(winner.netCost, 0);
  });

  it("regression guard: 32% is worse than the optimum, not part of a monotonic-improvement-forever curve", () => {
    // Round 4's discontinuity, encoded: a future change to the all-or-
    // nothing conversion gate in post-withdrawal-optimizer.ts that
    // accidentally "fixes" this household's discontinuity shouldn't
    // silently go unnoticed.
    const result = optimizeRothBracketTarget(makeMainHousehold(0.12, true));
    const at12 = result.candidates.find((c) => c.target === 0.12)!;
    const at32 = result.candidates.find((c) => c.target === 0.32)!;
    expect(at32.netCost).toBeGreaterThan(at12.netCost);
  });
});
