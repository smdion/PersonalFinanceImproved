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
import { calculateProjection } from "@/lib/pure/engine";
import {
  optimizeRothBracketTarget,
  ASSUMED_TERMINAL_RATE,
} from "@/lib/pure/retirement/withdrawal-bracket-optimizer";
import type {
  EngineDecumulationYear,
  ProjectionInput,
} from "@/lib/pure/engine/types";
import { capsFromBaseLimits, withCapsAge } from "../../helpers/irs-limit-caps";
import { shippedTaxTables } from "../../helpers/tax-data";
import { makeAccumulationDefaults } from "../fixtures/engine-fixtures";
import { onePerson } from "../../fixtures/engine-people";
import { engineInput } from "../fixtures/engine-input";

const AS_OF = new Date("2025-03-07");

const MFJ_BRACKETS = [
  { threshold: 23850, baseWithholding: 0, rate: 0.1 },
  { threshold: 96950, baseWithholding: 7310, rate: 0.12 },
  { threshold: 206700, baseWithholding: 20480, rate: 0.22 },
  { threshold: 394600, baseWithholding: 61818, rate: 0.24 },
  { threshold: 501050, baseWithholding: 87366, rate: 0.32 },
];

/** Deliberately discontinuous: tax falls by $4,925 crossing $96,950 (the 12%
 *  band starts from a base of $2,385, not the $7,310 the 10% band reaches).
 *  Just under the cliff a year can't meet its need, so the gross-up funds it
 *  at or above the cliff and spends up to the jump over budget. Also builds
 *  the depleting-candidate household. */
const CLIFF_BRACKETS = [
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
  brackets = MFJ_BRACKETS,
): ProjectionInput {
  return engineInput(
    withCapsAge({
      budgetContributionLines: 0,
      accumulationDefaults: makeAccumulationDefaults({
        contributionRate: 0.2,
        accountSplits: {
          "401k": 0.7,
          "403b": 0,
          hsa: 0.05,
          ira: 0.05,
          brokerage: 0.2,
        },
        taxSplits: { "401k": 0.9, ira: 1.0 },
      }),
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
          rothBracketOverlay: true,
          ...shippedTaxTables(),
          traditionalFallbackRate: 0.22,
          roth: 0,
          hsa: 0,
          brokerage: 0.15,
          rothBracketTarget: currentTarget,
          taxBrackets: brackets,
          enableRothConversions: conversionsOn,
          rothConversionTarget: conversionsOn ? currentTarget : undefined,
        },
      },
      accumulationOverrides: [],
      decumulationOverrides: [],
      currentAge: 62,
      people: onePerson(AS_OF.getFullYear() - 62),
      retirementYear: AS_OF.getFullYear() + 0,
      projectionEndYear: AS_OF.getFullYear() + 33,
      currentSalary: 0,
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
        currentAge: 62,
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
          parentCategory: "Retirement",
        },
        {
          name: "401k Roth",
          category: "401k",
          taxType: "taxFree",
          startingBalance: 80000,
          ownerName: "Owner",
          ownerPersonId: 1,
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
          parentCategory: "Retirement",
        },
        {
          name: "HSA",
          category: "hsa",
          taxType: "hsa",
          startingBalance: 20000,
          ownerName: "Owner",
          ownerPersonId: 1,
          parentCategory: "Retirement",
        },
        {
          name: "Brokerage",
          category: "brokerage",
          taxType: "afterTax",
          startingBalance: 150000,
          startingBasis: 100000,
          ownerName: "Owner",
          ownerPersonId: 1,
          parentCategory: "Retirement",
        },
      ],
    }),
  );
}

/**
 * A separate, smaller household tuned so the low targets (0.10, 0.12)
 * survive to end of plan while the higher candidates (0.22+, the current
 * one among them) genuinely deplete — found by sweeping the Traditional
 * balance, brokerage and spending of this shape. Exists to exercise the
 * hard-exclusion path; its dollar figures aren't pinned to anything
 * external. `shape` overrides the three swept inputs.
 */
function makeDepletionHousehold(
  currentTarget: number,
  shape = { preTax: 1_700_000, brokerage: 50_000, expenses: 70_000 },
): ProjectionInput {
  const { preTax, brokerage, expenses } = shape;
  return engineInput(
    withCapsAge({
      budgetContributionLines: 0,
      accumulationDefaults: makeAccumulationDefaults({
        contributionRate: 0,
        accountSplits: {
          "401k": 0.4,
          "403b": 0,
          hsa: 0.1,
          ira: 0.15,
          brokerage: 0.35,
        },
      }),
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
          rothBracketOverlay: true,
          ...shippedTaxTables(),
          traditionalFallbackRate: 0.22,
          roth: 0,
          hsa: 0,
          brokerage: 0.15,
          rothBracketTarget: currentTarget,
          taxBrackets: CLIFF_BRACKETS,
          enableRothConversions: true,
          rothConversionTarget: currentTarget,
        },
      },
      accumulationOverrides: [],
      decumulationOverrides: [],
      currentAge: 65,
      people: onePerson(AS_OF.getFullYear() - 65),
      retirementYear: AS_OF.getFullYear() + 0,
      projectionEndYear: AS_OF.getFullYear() + 30,
      currentSalary: 0,
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
        currentAge: 65,
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
        preTax,
        taxFree: 0,
        afterTax: brokerage,
        afterTaxBasis: brokerage,
        hsa: 0,
      },
      startingAccountBalances: {
        "401k": {
          structure: "roth_traditional",
          traditional: preTax,
          roth: 0,
        },
        "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
        hsa: { structure: "single_bucket", balance: 0 },
        ira: { structure: "roth_traditional", traditional: 0, roth: 0 },
        brokerage: {
          structure: "basis_tracking",
          balance: brokerage,
          basis: brokerage,
        },
      },
      annualExpenses: expenses,
      decumulationAnnualExpenses: expenses,
      inflationRate: 0.025,
      returnRates: [{ label: "4%", rate: 0.04 }],
      socialSecurityAnnual: 0,
      ssStartAge: 67,
      asOfDate: AS_OF,
      filingStatus: "MFJ",
    }),
  );
}

describe("optimizeRothBracketTarget", () => {
  it("recommends a genuinely cheaper lower target when one exists (RMD-avoidance case)", () => {
    const result = optimizeRothBracketTarget(makeMainHousehold(0.22, true));
    // Re-pinned for v0.9.5: continuous brackets (the old table had a tax
    // cliff), Social Security's COLA and its tax counted. The 12% candidate
    // is still the real minimum, not just directionally better than 22%.
    const at12 = result.candidates.find((c) => c.target === 0.12)!;
    const at22 = result.candidates.find((c) => c.target === 0.22)!;
    expect(at12.netCost).toBeCloseTo(261565, -1);
    // The 22% path's IRMAA ($13,860.25 over the plan) counts whether or
    // not IRMAA awareness is on. CV1 (v0.11.1): its years whose brokerage
    // can't pay the whole conversion tax now convert what it can pay
    // instead of skipping, $310,541 → $304,582.
    expect(at22.netCost).toBeCloseTo(304582, -1);
    expect(result.recommendedTarget).toBe(0.12);
  });

  it("returns recommendedTarget: null when the current setting is already optimal", () => {
    const result = optimizeRothBracketTarget(makeMainHousehold(0.12, true));
    expect(result.currentTarget).toBe(0.12);
    expect(result.recommendedTarget).toBeNull();
  });

  it("pins traditionalEnd, totalConversions and the first RMD", () => {
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
    expect(totalConversions).toBeCloseTo(1201641, -2);

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
    ).toBeCloseTo(4913.39, 0);
  });

  it("a household where every candidate carries the same non-depleting shortfall still produces a sensible ranking", () => {
    // A shortfall every candidate carries: for the first five retirement
    // years every account is capped below the $90k budget, so no bracket
    // target can fund them; the caps lift before the money runs low.
    const start = AS_OF.getFullYear();
    const result = optimizeRothBracketTarget({
      ...makeMainHousehold(0.24, true),
      decumulationOverrides: [
        {
          year: start,
          withdrawalAccountCaps: {
            "401k": 20000,
            "403b": 0,
            ira: 10000,
            brokerage: 10000,
            hsa: 0,
          },
        },
        { year: start + 5, reset: true },
      ],
    });
    for (const c of result.candidates) {
      expect(c.depleted).toBe(false);
      expect(c.shortfallScore).toBeGreaterThan(0);
    }
    // Ranking still resolves to a real candidate: the least shortfall wins,
    // ties (SHORTFALL_TIE_TOLERANCE) going to the cheaper.
    const least = Math.min(...result.candidates.map((c) => c.shortfallScore));
    const winner = result.candidates.find(
      (c) => c.target === result.recommendedTarget,
    );
    expect(winner?.shortfallScore).toBeCloseTo(least, -2);
  });

  it("funds every year across the tax cliff, overspending by at most the jump", () => {
    // The tax CLIFF_BRACKETS drops at its 12% threshold: the 10% band's tax
    // there less the 12% band's base.
    const [ten, twelve] = CLIFF_BRACKETS;
    const jump =
      ten!.baseWithholding +
      ten!.rate * (twelve!.threshold - ten!.threshold) -
      twelve!.baseWithholding;
    expect(jump).toBeCloseTo(4925, 2);
    for (const target of [0.1, 0.12, 0.22, 0.24]) {
      const result = calculateProjection(
        makeMainHousehold(target, true, CLIFF_BRACKETS),
      );
      expect(result.retirementDepletionAge ?? null).toBeNull();
      const years = result.projectionByYear.filter(
        (y): y is EngineDecumulationYear =>
          y.phase === "decumulation" && !y.withdrawalSized,
      );
      for (const y of years) {
        expect(y.unmetNeedMaterial ?? false).toBe(false);
        // RMD years carry the NIIT charged after routing; the equation is
        // exact only outside them.
        if (y.rmdAmount > 0 || y.afterTaxNeed === 0) continue;
        const over = y.spending - y.projectedExpenses;
        expect(over).toBeGreaterThan(-0.025);
        expect(over).toBeLessThanOrEqual(jump);
      }
    }
  });

  it("hard-excludes a candidate that genuinely depletes, regardless of its netCost", () => {
    const result = optimizeRothBracketTarget(makeDepletionHousehold(0.22));
    const survivors = result.candidates.filter((c) => !c.depleted);
    expect(survivors.map((c) => c.target).sort()).toEqual([0.1, 0.12]);
    // The current 0.22 and every higher target deplete, and rank after
    // every survivor -- depletion is a hard exclusion, not a ranking
    // input averaged against netCost.
    const order = result.candidates.map((c) => c.depleted);
    expect(order).toEqual([false, false, true, true, true]);
    expect(result.recommendedTarget).toBe(result.candidates[0]!.target);
    expect([0.1, 0.12]).toContain(result.recommendedTarget);
  });

  it("an empty brokerage still converts the tax-free room, so no candidate depletes (CV1)", () => {
    // A conversion's tax comes only from the brokerage, and a short
    // brokerage shrinks the conversion to what it can pay: with none, to
    // the room that costs no tax. The earlier depletion shape (empty
    // brokerage, 1,500,000 Traditional, 60,000 of spending) skipped every
    // conversion; now each candidate survives and 0.12 is the cheapest.
    const shape = { preTax: 1_500_000, brokerage: 0, expenses: 60_000 };
    const years = calculateProjection(
      makeDepletionHousehold(0.1, shape),
    ).projectionByYear;
    expect(
      years.some(
        (y) =>
          y.phase === "decumulation" &&
          (y.rothConversionAmount ?? 0) > 0 &&
          (y.rothConversionTaxCost ?? 0) === 0,
      ),
    ).toBe(true);
    const result = optimizeRothBracketTarget(
      makeDepletionHousehold(0.22, shape),
    );
    expect(result.candidates.every((c) => !c.depleted)).toBe(true);
    expect(result.recommendedTarget).toBe(0.12);
  });

  it("with enableRothConversions off, searches rothBracketTarget alone (no joint conversion-target movement)", () => {
    const result = optimizeRothBracketTarget(makeMainHousehold(0.22, false));
    // Conversions off means rothConversionTarget never gets threaded into
    // the candidate override -- a materially different (higher) netCost
    // scale than the conversions-on case, confirming the joint-movement
    // logic genuinely didn't fire.
    const at12 = result.candidates.find((c) => c.target === 0.12)!;
    // Includes its IRMAA ($3,445.21 over the plan), counted with awareness off.
    expect(at12.netCost).toBeCloseTo(821512.0652, -1);
    expect(result.recommendedTarget).toBe(0.12);
  });

  it("a saved conversion rate of 0 keeps conversions off in every candidate (Q-conversion-zero-2)", () => {
    // Conversions on with a rate of 0 is off: each candidate must score
    // the plan the household has, the same as with the switch off.
    const rateZero = makeMainHousehold(0.22, true);
    rateZero.decumulationDefaults.distributionTaxRates.rothConversionTarget = 0;
    const switchOff = makeMainHousehold(0.22, false);
    const scores = (input: ProjectionInput) =>
      optimizeRothBracketTarget(input).candidates.map((c) => [
        c.target,
        Math.round(c.netCost * 100) / 100,
      ]);
    expect(scores(rateZero)).toEqual(scores(switchOff));
  });

  it("a 0% current target with conversions on and no conversion rate scores staying put as it runs: converting the 0% room (Q-conversion-zero-2)", () => {
    // The CZ2 shape: the 0% candidate is the household's own setting, so
    // its score is the plan unchanged. Brokerage drawn first leaves the 0%
    // room to the conversion. A conversion rate of 0 would turn conversions
    // off; the candidate leaves the rate unset instead.
    const input: ProjectionInput = makeMainHousehold(0, true);
    const { decumulationDefaults: d } = input;
    d.distributionTaxRates.rothConversionTarget = undefined;
    d.distributionTaxRates.rothBracketOverlay = false;
    d.withdrawalRoutingMode = "waterfall";
    d.withdrawalOrder = ["brokerage", "401k", "403b", "ira", "hsa"];
    const result = optimizeRothBracketTarget(input);
    const atZero = result.candidates.find((c) => c.target === 0)!;
    const asIs = calculateProjection(input).projectionByYear;
    const decum = asIs.filter((y) => y.phase === "decumulation");
    expect(decum.some((y) => (y.rothConversionAmount ?? 0) > 0)).toBe(true);
    const lifetimeTax = decum.reduce(
      (s, y) =>
        s +
        (y.taxCost ?? 0) +
        (y.rothConversionTaxCost ?? 0) +
        (y.penaltyCost ?? 0) +
        (y.irmaaCost ?? 0),
      0,
    );
    const preTaxEnd = asIs[asIs.length - 1]?.balanceByTaxType.preTax ?? 0;
    expect(atZero.netCost).toBeCloseTo(
      lifetimeTax + ASSUMED_TERMINAL_RATE * preTaxEnd,
      0,
    );
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
    // nothing conversion gate in roth-conversion.ts that
    // accidentally "fixes" this household's discontinuity shouldn't
    // silently go unnoticed.
    const result = optimizeRothBracketTarget(makeMainHousehold(0.12, true));
    const at12 = result.candidates.find((c) => c.target === 0.12)!;
    const at32 = result.candidates.find((c) => c.target === 0.32)!;
    expect(at32.netCost).toBeGreaterThan(at12.netCost);
  });
});
