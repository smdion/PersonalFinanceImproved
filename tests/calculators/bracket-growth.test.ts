import { describe, it, expect } from "vitest";
import {
  taxGrowthYears,
  taxGrowthFactor,
  growAmount,
  growWithholdingBrackets,
  growLtcgBrackets,
  growIrmaaBrackets,
} from "@/lib/calculators/engine/bracket-growth";
import {
  estimateEffectiveTaxRate,
  computeTaxableSS,
} from "@/lib/calculators/engine/tax-estimation";
import { computeLtcgTax, LTCG_BRACKETS } from "@/lib/config/tax-tables";
import { IRMAA_BRACKETS } from "@/lib/config/irmaa-tables";
import { NIIT_THRESHOLDS, computeNiit } from "@/lib/config/niit";
import { TEST_BRACKETS } from "./fixtures/engine-fixtures";
import { calculateProjection } from "@/lib/calculators/engine";
import type { ProjectionInput } from "@/lib/calculators/types";

describe("taxGrowthYears", () => {
  it("is 0 when year equals taxDataYear", () => {
    expect(taxGrowthYears(2026, 2026)).toBe(0);
  });

  it("is 0 (clamped) when year is before taxDataYear", () => {
    expect(taxGrowthYears(2020, 2026)).toBe(0);
  });

  it("grows with the gap between year and taxDataYear", () => {
    expect(taxGrowthYears(2044, 2026)).toBe(18);
  });

  it("is 0 when taxDataYear is undefined — treat as already current", () => {
    expect(taxGrowthYears(2044, undefined)).toBe(0);
  });
});

describe("taxGrowthFactor", () => {
  it("is exactly 1.0 (no-op) at yearIndex 0 — must not change today's numbers", () => {
    expect(taxGrowthFactor(2026, 2026, 0.03)).toBe(1);
  });

  it("compounds by (1+inflationRate)^years", () => {
    expect(taxGrowthFactor(2044, 2026, 0.03)).toBeCloseTo(
      Math.pow(1.03, 18),
      10,
    );
  });

  it("is 1.0 when inflationRate is 0, at any year gap", () => {
    expect(taxGrowthFactor(2066, 2026, 0)).toBe(1);
  });
});

describe("growAmount", () => {
  it("returns undefined when base is undefined — matches existing 'undefined ⇒ omitted' convention", () => {
    expect(growAmount(undefined, 1.5)).toBeUndefined();
  });

  it("is a no-op at growthFactor 1", () => {
    expect(growAmount(32200, 1)).toBe(32200);
  });

  it("scales linearly", () => {
    expect(growAmount(32200, 1.5)).toBeCloseTo(48300, 5);
  });
});

describe("growWithholdingBrackets", () => {
  it("is a no-op at growthFactor 1 — must not change today's numbers", () => {
    expect(growWithholdingBrackets(TEST_BRACKETS, 1)).toEqual(TEST_BRACKETS);
  });

  it("scales both threshold and baseWithholding by the identical factor", () => {
    const grown = growWithholdingBrackets(TEST_BRACKETS, 1.5);
    for (let i = 0; i < TEST_BRACKETS.length; i++) {
      expect(grown[i]!.threshold).toBeCloseTo(
        TEST_BRACKETS[i]!.threshold * 1.5,
        5,
      );
      expect(grown[i]!.baseWithholding).toBeCloseTo(
        TEST_BRACKETS[i]!.baseWithholding * 1.5,
        5,
      );
      expect(grown[i]!.rate).toBe(TEST_BRACKETS[i]!.rate); // rate never scales
    }
  });

  // The specific correctness risk this module's docblock calls out:
  // tax(k·x) = k·tax(x) for a uniformly-scaled schedule. Proven here by
  // actually computing tax at a grown bracket table and confirming it
  // matches k times the tax at the base table — not just asserting the
  // formula, executing it.
  it("preserves tax(k·x) = k·tax(x): tax computed against the grown table at k·income equals k times tax computed against the base table at income", () => {
    const k = 2.5;
    const grown = growWithholdingBrackets(TEST_BRACKETS, k);
    for (const income of [10000, 50000, 100000, 250000, 500000]) {
      const baseTax = estimateEffectiveTaxRate(income, TEST_BRACKETS) * income;
      const grownTax =
        estimateEffectiveTaxRate(income * k, grown) * (income * k);
      expect(grownTax).toBeCloseTo(baseTax * k, 2);
    }
  });

  it("preserves the same identity even with a standardDeduction applied, when the deduction is grown by the SAME factor (the coupling this fix depends on)", () => {
    const k = 1.75;
    const standardDeduction = 32200;
    const grown = growWithholdingBrackets(TEST_BRACKETS, k);
    const grownStandardDeduction = growAmount(standardDeduction, k)!;
    for (const income of [40000, 80000, 150000, 300000]) {
      const baseTax =
        estimateEffectiveTaxRate(income, TEST_BRACKETS, 1, standardDeduction) *
        income;
      const grownTax =
        estimateEffectiveTaxRate(income * k, grown, 1, grownStandardDeduction) *
        (income * k);
      expect(grownTax).toBeCloseTo(baseTax * k, 2);
    }
  });

  it("desyncs (fails the identity) when standardDeduction is NOT grown by the same factor — guards against ever re-introducing this bug", () => {
    const k = 1.75;
    const standardDeduction = 32200;
    const grown = growWithholdingBrackets(TEST_BRACKETS, k);
    const income = 80000;
    const baseTax =
      estimateEffectiveTaxRate(income, TEST_BRACKETS, 1, standardDeduction) *
      income;
    // Deliberately using the UNGROWN standardDeduction against the GROWN
    // brackets -- the mistake this test exists to catch if ever repeated.
    const desyncedTax =
      estimateEffectiveTaxRate(income * k, grown, 1, standardDeduction) *
      (income * k);
    expect(desyncedTax).not.toBeCloseTo(baseTax * k, 2);
  });
});

describe("growLtcgBrackets", () => {
  const DB_BRACKETS = {
    MFJ: [
      { threshold: 98900, rate: 0 },
      { threshold: 613700, rate: 0.15 },
      { threshold: null, rate: 0.2 }, // DB convention: null = top/Infinity bracket
    ],
  };

  it("is a no-op at growthFactor 1", () => {
    expect(growLtcgBrackets(DB_BRACKETS, 1)).toEqual(DB_BRACKETS);
  });

  it("scales every real threshold by the growth factor", () => {
    const grown = growLtcgBrackets(DB_BRACKETS, 1.5);
    expect(grown.MFJ![0]!.threshold).toBeCloseTo(98900 * 1.5, 5);
    expect(grown.MFJ![1]!.threshold).toBeCloseTo(613700 * 1.5, 5);
    expect(grown.MFJ![0]!.rate).toBe(0); // rate never scales
  });

  it("leaves a null threshold (the top bracket) as null, not 0 — the specific bug this exists to guard against (null * k coerces to 0 in JS)", () => {
    const grown = growLtcgBrackets(DB_BRACKETS, 1.5);
    expect(grown.MFJ![2]!.threshold).toBeNull();
  });

  it("falls back to the hardcoded LTCG_BRACKETS default (grown) when no DB override is passed — the common case, since most households have no ltcg_brackets DB row", () => {
    const grown = growLtcgBrackets(undefined, 1.5);
    expect(grown.MFJ![0]!.threshold).toBeCloseTo(
      LTCG_BRACKETS.MFJ[0]!.threshold * 1.5,
      5,
    );
    // The hardcoded default's own top bracket is a literal Infinity (not
    // null) -- must survive multiplication as Infinity, not become NaN
    // or a finite number.
    expect(grown.MFJ![2]!.threshold).toBe(Infinity);
  });

  it("maps over every filing-status key, not just one", () => {
    const grown = growLtcgBrackets(undefined, 1.5);
    expect(Object.keys(grown).sort()).toEqual(["HOH", "MFJ", "Single"]);
  });

  // The specific correctness risk: unlike ordinary brackets, LTCG tax has
  // no baseWithholding-style cumulative shortcut, but computeLtcgTax DOES
  // take two income arguments (ordinary income AND capital gains) that
  // both need to scale together with the grown thresholds. Proven here by
  // actually computing tax, not just asserting the formula holds.
  it("preserves computeLtcgTax(k·ordinary, k·gains) = k·computeLtcgTax(ordinary, gains) when both incomes AND thresholds scale together", () => {
    const k = 2.5;
    const grown = growLtcgBrackets(DB_BRACKETS, k);
    for (const [ordinary, gains] of [
      [0, 50000],
      [80000, 30000],
      [98900, 20000], // exactly at the 0% ceiling
      [500000, 200000], // spans 0%/15%/20%
    ]) {
      const baseTax = computeLtcgTax(ordinary!, gains!, "MFJ", DB_BRACKETS);
      const grownTax = computeLtcgTax(ordinary! * k, gains! * k, "MFJ", grown);
      expect(grownTax).toBeCloseTo(baseTax * k, 2);
    }
  });
});

// Regression guard (advisor review, 2026-08-31, following the reverted
// NIIT mistake earlier this same session): NIIT's MAGI threshold and
// Social Security's provisional-income taxation thresholds are genuinely
// flat NOMINAL by law and must NEVER be grown by this module or anything
// that consumes it. Neither function below takes a year/growth-related
// parameter at all — structurally can't be affected by bracket-growth.ts
// — this test exists so that guarantee stays explicit and visible, not
// just true by omission.
describe("NIIT and Social Security taxation thresholds stay untouched by bracket growth", () => {
  it("NIIT_THRESHOLDS are still the flat nominal law values", () => {
    expect(NIIT_THRESHOLDS.MFJ).toBe(250000);
    expect(NIIT_THRESHOLDS.Single).toBe(200000);
    expect(NIIT_THRESHOLDS.HOH).toBe(200000);
  });

  it("computeNiit takes no year/growth parameter — same result regardless of how far in the future it's called for", () => {
    expect(computeNiit(300000, 80000, "MFJ")).toBe(1900);
  });

  it("computeTaxableSS's signature has no year/growth parameter to accidentally wire growth into", () => {
    expect(computeTaxableSS.length).toBeLessThanOrEqual(4);
    expect(computeTaxableSS(30000, 80000, "MFJ")).toBeGreaterThan(0);
  });
});

// End-to-end wiring regression guard (advisor review, 2026-08-31): every
// UNIT test above exercises the helpers in isolation, and every OTHER
// engine test in this suite leaves `taxDataYear` undefined (growth is a
// no-op for all of them) -- meaning if someone later "cleans up" one of
// the five splice points in decumulation-year.ts back to the raw
// `taxRates` object, the entire rest of the suite stays green and the
// household silently gets pre-fix (frozen-bracket) numbers again. This
// runs the REAL engine end-to-end with taxDataYear set in the past and
// asserts the grown number, the one thing a unit test of the helpers
// alone can't prove.
const AS_OF = new Date("2025-03-07");
const MFJ_BRACKETS = [
  { threshold: 0, baseWithholding: 0, rate: 0 },
  { threshold: 23850, baseWithholding: 0, rate: 0.1 },
  { threshold: 96950, baseWithholding: 2385, rate: 0.12 },
  { threshold: 206700, baseWithholding: 11157, rate: 0.22 },
  { threshold: 394600, baseWithholding: 35302, rate: 0.24 },
];

function makeInput(
  overrides: {
    taxDataYear?: number;
    inflationRate?: number;
  } = {},
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
        rothBracketTarget: 0.12,
        taxBrackets: MFJ_BRACKETS,
        standardDeduction: 32200,
        enableRothConversions: false,
        taxDataYear: overrides.taxDataYear,
      },
    },
    accumulationOverrides: [],
    decumulationOverrides: [],
    currentAge: 60,
    retirementAge: 60,
    projectionEndAge: 75,
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
    inflationRate: overrides.inflationRate ?? 0.03,
    returnRates: [{ label: "6%", rate: 0.06 }],
    birthYear: 1965,
    socialSecurityAnnual: 0,
    ssStartAge: 67,
    asOfDate: AS_OF,
    filingStatus: "MFJ",
  } as ProjectionInput;
}

describe("end-to-end: bracketTraditionalCap actually grows through the real engine", () => {
  it("equals the base cap unchanged when taxDataYear is undefined (pre-fix behavior preserved)", () => {
    const result = calculateProjection(makeInput({ taxDataYear: undefined }));
    const firstDecumYear = result.projectionByYear.find(
      (y) => y.phase === "decumulation",
    )!;
    // rothBracketTarget 0.12 against MFJ_BRACKETS + $32,200 SD, ungrown:
    // incomeCapForMarginalRate(0.12) finds the 0.22 bracket's threshold
    // (206700), residual = max(0, 32200 - 19300-equivalent-first-taxed-
    // threshold)... asserted structurally instead of hand-deriving twice:
    // must be IDENTICAL across both years below when taxDataYear is unset.
    const laterYear = result.projectionByYear.find(
      (y) => y.phase === "decumulation" && y.year === firstDecumYear.year + 10,
    )!;
    expect(laterYear.bracketTraditionalCap).toBeCloseTo(
      firstDecumYear.bracketTraditionalCap!,
      2,
    );
  });

  it("grows bracketTraditionalCap by (1+inflationRate)^(year - taxDataYear) when taxDataYear is set — the actual regression this test exists to catch", () => {
    const inflationRate = 0.03;
    const baseResult = calculateProjection(
      makeInput({ taxDataYear: undefined, inflationRate }),
    );
    const baseCap = baseResult.projectionByYear.find(
      (y) => y.phase === "decumulation",
    )!.bracketTraditionalCap!;

    const firstDecumYearCalendarYear = baseResult.projectionByYear.find(
      (y) => y.phase === "decumulation",
    )!.year;
    const taxDataYear = firstDecumYearCalendarYear - 10; // tax data is 10 years stale
    const grownResult = calculateProjection(
      makeInput({ taxDataYear, inflationRate }),
    );
    const grownYear = grownResult.projectionByYear.find(
      (y) => y.phase === "decumulation",
    )!;
    const expectedCap = baseCap * Math.pow(1 + inflationRate, 10);
    expect(grownYear.bracketTraditionalCap).toBeCloseTo(expectedCap, 0);
    // And it keeps growing further into the projection, not just a one-time bump.
    const laterGrownYear = grownResult.projectionByYear.find(
      (y) => y.phase === "decumulation" && y.year === grownYear.year + 5,
    )!;
    expect(laterGrownYear.bracketTraditionalCap!).toBeGreaterThan(
      grownYear.bracketTraditionalCap!,
    );
  });
});

// Phase 2 end-to-end wiring guard (2026-08-31) — same reasoning as the
// bracketTraditionalCap guard above, for LTCG brackets specifically.
// Verified live against real production data first (a small-Traditional,
// large-brokerage household): growing the LTCG threshold moved
// discretionary brokerage draws that used to spill into the 15% bracket
// every year into the free 0% tier instead, dropping real tax cost to $0
// in later years — this fixture reproduces that same shape in miniature.
function makeLtcgHeavyInput(
  taxDataYear?: number,
  rothConversionOverrides: {
    enableRothConversions?: boolean;
    rothConversionTarget?: number;
  } = {},
  afterTaxBasis = 500000,
  preTax = 200000,
): ProjectionInput {
  return {
    accumulationDefaults: {
      contributionRate: 0.2,
      routingMode: "waterfall",
      accountOrder: ["401k", "403b", "hsa", "ira", "brokerage"],
      accountSplits: {
        "401k": 0.2,
        "403b": 0,
        hsa: 0.05,
        ira: 0.05,
        brokerage: 0.7,
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
        traditionalFallbackRate: 0.1,
        roth: 0,
        hsa: 0,
        brokerage: 0.15,
        rothBracketTarget: 0.1, // small target -> lots of discretionary need
        taxBrackets: MFJ_BRACKETS,
        standardDeduction: 32200,
        enableRothConversions:
          rothConversionOverrides.enableRothConversions ?? false,
        rothConversionTarget: rothConversionOverrides.rothConversionTarget,
        taxDataYear,
      },
    },
    accumulationOverrides: [],
    decumulationOverrides: [],
    currentAge: 60,
    retirementAge: 60,
    projectionEndAge: 80,
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
      preTax, // small -> Traditional's own cap covers little
      taxFree: 0,
      afterTax: 3000000, // huge -> brokerage carries most of the burden
      afterTaxBasis, // large realized-gains portion by default
      hsa: 0,
    },
    startingAccountBalances: {
      "401k": { structure: "roth_traditional", traditional: preTax, roth: 0 },
      "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
      hsa: { structure: "single_bucket", balance: 0 },
      ira: { structure: "roth_traditional", traditional: 0, roth: 0 },
      brokerage: {
        structure: "basis_tracking",
        balance: 3000000,
        basis: afterTaxBasis,
      },
    },
    annualExpenses: 150000,
    decumulationAnnualExpenses: 150000,
    inflationRate: 0.03,
    returnRates: [{ label: "6%", rate: 0.06 }],
    birthYear: 1965,
    socialSecurityAnnual: 0,
    ssStartAge: 67,
    asOfDate: AS_OF,
    filingStatus: "MFJ",
  } as ProjectionInput;
}

describe("end-to-end: LTCG brackets actually grow through the real engine", () => {
  it("a stale (grown) LTCG threshold shifts real dollars out of the 15% tier and into the free 0% tier, versus the ungrown baseline", () => {
    const base = calculateProjection(makeLtcgHeavyInput(undefined));
    const grown = calculateProjection(makeLtcgHeavyInput(2015)); // 10y stale

    const baseYear3 = base.projectionByYear.filter(
      (y) => y.phase === "decumulation",
    )[2]!;
    const grownYear3 = grown.projectionByYear.filter(
      (y) => y.phase === "decumulation",
    )[2]!;

    const pricedAmount = (yr: typeof baseYear3) =>
      (yr.discretionaryTierBreakdown ?? [])
        .filter((t) => t.source === "brokerage" && t.costRate > 0)
        .reduce((s, t) => s + t.amount, 0);

    // Base (ungrown, 10 years past the tax data's vintage): a real chunk
    // of the brokerage draw spills into the priced 15% tier every year.
    expect(pricedAmount(baseYear3)).toBeGreaterThan(0);
    // Grown: the same household, same need, but with a correctly-grown
    // LTCG threshold -- less (here, none) of the draw needs the priced
    // tier at all.
    expect(pricedAmount(grownYear3)).toBeLessThan(pricedAmount(baseYear3));
  });

  it("real tax cost is lower with the grown (correct) LTCG threshold than with the frozen one, for an identical household/need", () => {
    const base = calculateProjection(makeLtcgHeavyInput(undefined));
    const grown = calculateProjection(makeLtcgHeavyInput(2015));

    const baseYear3 = base.projectionByYear.filter(
      (y) => y.phase === "decumulation",
    )[2]!;
    const grownYear3 = grown.projectionByYear.filter(
      (y) => y.phase === "decumulation",
    )[2]!;

    expect(grownYear3.taxCost).toBeLessThan(baseYear3.taxCost);
  });
});

// Advisor review of this same Phase-2 diff (2026-08-31) flagged that the
// two tests above set enableRothConversions: false, so the entire
// rothConversionAmount > 0 branch in decumulation-year.ts's Roth-conversion
// recompute block -- 4 of the 6 splice points this phase swapped from
// taxRates.ltcgBrackets to grownLtcgBrackets (the computeLtcgTax call and
// both branches of the post-conversion getLtcgRate lookup) -- was never
// exercised growth-aware. This is exactly the "missing wiring-regression
// test" class of finding Phase 1's diff review made; this block closes it.
describe("end-to-end: LTCG brackets grow through the Roth-conversion recompute path too", () => {
  // Comparing base-vs-grown taxCost alone would be confounded: ordinary
  // bracket + standard deduction growth (Phase 1, already covered) also
  // shifts taxCost, so a naive delta could pass even if this phase's
  // grownLtcgBrackets wiring into the conversion recompute block
  // (computeLtcgTax's brokerageTaxCost call, decumulation-year.ts:862)
  // were silently reverted to the raw ungrown table. Isolate the
  // LTCG-specific contribution with a differences-in-differences design
  // instead: run the SAME conversion scenario twice, once with a large
  // embedded brokerage gain (LTCG bracket growth matters a lot) and once
  // with almost none (LTCG bracket growth is nearly irrelevant — basis is
  // almost the whole balance). Ordinary-bracket growth affects both
  // pairs equally; only the LTCG-specific growth should make the
  // large-gains pair's base-vs-grown delta meaningfully bigger than the
  // near-zero-gains pair's delta. Verified by mutation: reverting the
  // computeLtcgTax call at line 862 to the raw (ungrown) table collapses
  // this gap to ~0, while it survives untouched today.
  it("the LTCG-driven portion of the base-vs-grown tax delta is real, not just the ordinary-bracket delta leaking through", () => {
    const opts = { enableRothConversions: true, rothConversionTarget: 0.22 };
    const preTax = 150000; // sized so the conversion lands ordinary income near the LTCG bracket boundary that growth actually moves

    const largeGainsBase = calculateProjection(
      makeLtcgHeavyInput(undefined, opts, 500000, preTax),
    );
    const largeGainsGrown = calculateProjection(
      makeLtcgHeavyInput(2015, opts, 500000, preTax),
    );
    const nearZeroGainsBase = calculateProjection(
      makeLtcgHeavyInput(undefined, opts, 2999000, preTax),
    );
    const nearZeroGainsGrown = calculateProjection(
      makeLtcgHeavyInput(2015, opts, 2999000, preTax),
    );

    // The small Traditional balance in this fixture converts almost
    // entirely in the FIRST decumulation year (there's little left to
    // convert afterward), so that's the year that actually exercises the
    // recompute block -- not a later one.
    const firstDecum = (r: typeof largeGainsBase) =>
      r.projectionByYear.find((y) => y.phase === "decumulation")!;

    const lgBase = firstDecum(largeGainsBase);
    const lgGrown = firstDecum(largeGainsGrown);
    const zgBase = firstDecum(nearZeroGainsBase);
    const zgGrown = firstDecum(nearZeroGainsGrown);

    // All four scenarios must actually be exercising conversions --
    // otherwise this test would pass vacuously without ever touching the
    // recompute block it exists to cover.
    for (const y of [lgBase, lgGrown, zgBase, zgGrown]) {
      expect(y.rothConversionAmount ?? 0).toBeGreaterThan(0);
    }

    // The display-only `getLtcgRate` splice points (postConversionLtcgRate,
    // emitted as `ltcgRate`) are separate from the taxCost-affecting
    // computeLtcgTax splice checked below -- assert those directly too.
    // Verified by mutation: reverting either getLtcgRate call inside the
    // rothConversionAmount > 0 branch back to taxRates.ltcgBrackets makes
    // lgGrown.ltcgRate equal lgBase.ltcgRate (0.15) instead of dropping to 0.
    expect(lgGrown.ltcgRate).not.toBe(lgBase.ltcgRate);

    const largeGainsDelta = lgBase.taxCost - lgGrown.taxCost;
    const nearZeroGainsDelta = zgBase.taxCost - zgGrown.taxCost;

    // The LTCG-specific contribution to the delta -- isolated from the
    // ordinary-bracket growth both scenarios share equally -- must clear
    // a threshold verified (by mutation) to sit between the fixed
    // (~$6,521) and mutated (~$5,088) values: reverting the
    // computeLtcgTax call inside the rothConversionAmount > 0 branch in
    // decumulation-year.ts back to the raw taxRates.ltcgBrackets drops
    // this gap below the threshold below.
    expect(largeGainsDelta - nearZeroGainsDelta).toBeGreaterThan(5500);
  });
});

describe("growIrmaaBrackets", () => {
  const DB_BRACKETS = {
    MFJ: [
      { magiThreshold: 206000, annualSurcharge: 1056 },
      { magiThreshold: 258000, annualSurcharge: 2640 },
    ],
  };

  it("is a no-op at growthFactor 1", () => {
    expect(growIrmaaBrackets(DB_BRACKETS, 1)).toEqual(DB_BRACKETS);
  });

  // Unlike growLtcgBrackets (threshold only), BOTH fields scale here --
  // annualSurcharge growth isn't optional decoration, it keeps IRMAA's
  // weight in withdrawal-bracket-optimizer.ts's lifetimeTax objective
  // consistent with the now-grown taxCost/rothConversionTaxCost terms it's
  // summed against (see growIrmaaBrackets' own docblock).
  it("scales both magiThreshold and annualSurcharge by the growth factor", () => {
    const grown = growIrmaaBrackets(DB_BRACKETS, 1.5);
    expect(grown.MFJ![0]!.magiThreshold).toBeCloseTo(206000 * 1.5, 5);
    expect(grown.MFJ![0]!.annualSurcharge).toBeCloseTo(1056 * 1.5, 5);
    expect(grown.MFJ![1]!.magiThreshold).toBeCloseTo(258000 * 1.5, 5);
    expect(grown.MFJ![1]!.annualSurcharge).toBeCloseTo(2640 * 1.5, 5);
  });

  it("falls back to the hardcoded IRMAA_BRACKETS default (grown) when no DB override is passed -- irmaa_brackets DB rows exist but nothing in the engine payload reads them yet", () => {
    const grown = growIrmaaBrackets(undefined, 1.5);
    expect(grown.MFJ![0]!.magiThreshold).toBeCloseTo(
      IRMAA_BRACKETS.MFJ[0]!.magiThreshold * 1.5,
      5,
    );
  });

  it("maps over every filing-status key, not just one", () => {
    const grown = growIrmaaBrackets(undefined, 1.5);
    expect(Object.keys(grown).sort()).toEqual(["HOH", "MFJ", "Single"]);
  });
});

// Phase 3 end-to-end wiring guard (2026-08-31) -- IRMAA has TWO
// independent call sites that both needed the grown table threaded in,
// on TWO DIFFERENT growth vintages (see decumulation-year.ts's
// grownIrmaaBracketsForCheck/grownIrmaaBracketsForCap docblocks):
//
//  1. checkIrmaa (post-withdrawal-optimizer.ts) -- reports irmaaCost/
//     warnings, grown to the CURRENT year's vintage.
//  2. performRothConversion's IRMAA-aware cap -- actually LIMITS
//     rothConversionAmount (a real withdrawal number, not just display),
//     grown to year+2's vintage (IRMAA's own 2-year MAGI lookback).
//
// Both tests below are verified BY ACTUAL MUTATION, not assumed: omitting
// `irmaaBrackets: grownIrmaaBracketsForCheck` from the checkIrmaa call
// site collapses year 2028's irmaaCost from $0 back to $1,056 (the
// household's MAGI no longer clears the still-frozen cliff) while leaving
// every rothConversionAmount byte-identical to the fixed run (this
// mutation is fully isolated to the check side). Omitting
// `irmaaBrackets: grownIrmaaBracketsForCap` from the performRothConversion
// call site instead leaves year 2026's rothConversionAmount at $42,767.46
// (vs. $3,312.86 fixed) -- and this one is NOT isolated: the much larger
// conversion raises MAGI, which (via the module's own documented
// Roth-conversions-affect-MAGI-affects-IRMAA feedback chain) ALSO flips
// year 2028's irmaaCost away from its correctly-grown trajectory, so a
// cap-side revert fails BOTH tests below, not just the cap one. Advisor
// diff review (2026-08-31) verified this cross-contamination directly and
// flagged an earlier draft of this comment that incorrectly claimed the
// two paths were independent -- they're independent in wiring (neither
// call site's grown-table SOURCE depends on the other), but not in the
// values they produce, because of the feedback loop.
function makeIrmaaHouseholdInput(): ProjectionInput {
  const MFJ_BRACKETS = [
    { threshold: 0, baseWithholding: 0, rate: 0 },
    { threshold: 23850, baseWithholding: 0, rate: 0.1 },
    { threshold: 96950, baseWithholding: 2385, rate: 0.12 },
    { threshold: 206700, baseWithholding: 11157, rate: 0.22 },
    { threshold: 394600, baseWithholding: 35302, rate: 0.24 },
  ];
  return {
    accumulationDefaults: {
      contributionRate: 0.2,
      routingMode: "waterfall",
      accountOrder: ["401k", "403b", "hsa", "ira", "brokerage"],
      accountSplits: {
        "401k": 0.2,
        "403b": 0,
        hsa: 0.05,
        ira: 0.05,
        brokerage: 0.7,
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
        traditionalFallbackRate: 0.15,
        roth: 0,
        hsa: 0,
        brokerage: 0.15,
        rothBracketTarget: 0.22,
        taxBrackets: MFJ_BRACKETS,
        standardDeduction: 32200,
        enableRothConversions: true,
        rothConversionTarget: 0.24,
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
      preTax: 1000000,
      taxFree: 100000,
      afterTax: 500000,
      afterTaxBasis: 300000,
      hsa: 0,
    },
    startingAccountBalances: {
      "401k": { structure: "roth_traditional", traditional: 1000000, roth: 0 },
      "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
      hsa: { structure: "single_bucket", balance: 0 },
      ira: { structure: "roth_traditional", traditional: 0, roth: 0 },
      brokerage: {
        structure: "basis_tracking",
        balance: 500000,
        basis: 300000,
      },
    },
    annualExpenses: 195000,
    decumulationAnnualExpenses: 195000,
    inflationRate: 0.03,
    returnRates: [{ label: "6%", rate: 0.06 }],
    birthYear: 1960,
    socialSecurityAnnual: 0,
    ssStartAge: 67,
    asOfDate: new Date("2025-03-07"),
    filingStatus: "MFJ",
    enableIrmaaAwareness: true,
  } as ProjectionInput;
}

describe("end-to-end: IRMAA brackets grow through both the check and Roth-conversion-cap paths", () => {
  it("checkIrmaa's irmaaCost reflects the grown (current-year) threshold, not the frozen one", () => {
    const r = calculateProjection(makeIrmaaHouseholdInput());
    const y2028 = r.projectionByYear.find(
      (y) => y.phase === "decumulation" && y.year === 2028,
    )!;
    // Verified by mutation: with grownIrmaaBracketsForCheck correctly
    // wired, this household's MAGI clears the (grown) first IRMAA tier by
    // 2028 -- irmaaCost drops to 0. Omitting the wiring (falling back to
    // the frozen 2026 threshold) keeps it pinned at $1,056 indefinitely.
    expect(y2028.irmaaCost).toBe(0);
  });

  it("performRothConversion's IRMAA-aware cap uses the grown (year+2) threshold, materially changing rothConversionAmount", () => {
    const r = calculateProjection(makeIrmaaHouseholdInput());
    const y2026 = r.projectionByYear.find(
      (y) => y.phase === "decumulation" && y.year === 2026,
    )!;
    // Verified by mutation: with grownIrmaaBracketsForCap correctly wired,
    // the cap allows $3,312.86 of conversion this year. Omitting the
    // wiring (capping against the ungrown, year-2026-vintage cliff instead
    // of the year-2028 one that actually governs this year's MAGI) instead
    // allows $42,767.46 -- more than 10x as much. The mechanism is a TIER
    // CHANGE, not a proportional gap: this household's pre-conversion MAGI
    // sits between the raw $206,000 first-tier threshold and its grown
    // ~$218,545 (year+2) value, so the ungrown cap sees MAGI already past
    // tier 1 (getNextIrmaaCliff returns tier 2's $258,000, leaving far more
    // room before the NEXT cliff) while the correctly-grown cap sees MAGI
    // still below tier 1 (returns $218,545, leaving much less room).
    // Growing the threshold can tighten a cap as easily as loosen one,
    // depending on which side of a tier boundary a household's MAGI lands
    // on -- advisor-caught (2026-08-31) after an earlier draft of this
    // comment wrongly described it as a proportional "two extra years of
    // growth" gap.
    expect(y2026.rothConversionAmount).toBeGreaterThan(0);
    expect(y2026.rothConversionAmount).toBeLessThan(20000);
  });
});
