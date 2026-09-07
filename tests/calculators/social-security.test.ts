/**
 * Social Security claiming-age calculator — spousal "greater of" logic and
 * the claiming-age sweep.
 *
 * Fixture style mirrors `withdrawal-bracket-optimizer.test.ts`: a
 * hand-constructed household run through `calculateProjection`/
 * `sweepClaimingAges` as a real black box, no engine internals imported.
 */
import { describe, it, expect } from "vitest";
import { calculateProjection } from "@/lib/calculators/engine";
import {
  computeAdjustedBenefit,
  computeSpousalBenefit,
  sweepClaimingAges,
} from "@/lib/calculators/social-security";
import type { ProjectionInput } from "@/lib/calculators/types";

const AS_OF = new Date("2025-03-07");

/**
 * Single-person household, deliberately similar in shape to
 * `withdrawal-bracket-optimizer.test.ts`'s `MAIN_HOUSEHOLD` — enough
 * balance that no claiming-age candidate in the default 62-70 sweep
 * depletes the portfolio, so the sweep exercises real ranking rather than
 * the depletion-exclusion path.
 */
function makeSingleHousehold(): ProjectionInput {
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
        taxBrackets: [
          { threshold: 23850, baseWithholding: 0, rate: 0.1 },
          { threshold: 96950, baseWithholding: 2385, rate: 0.12 },
          { threshold: 206700, baseWithholding: 11157, rate: 0.22 },
        ],
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
    birthYear: 1963, // age 62 in 2025 -> FRA 66y10m (1955-1959 band doesn't apply; 1960+ is 67 — 1963 is 1960+)
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
    filingStatus: "Single",
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

describe("computeAdjustedBenefit", () => {
  it("returns PIA unchanged when claiming exactly at FRA", () => {
    // birthYear 1963 -> FRA 67y0m (1960+ band)
    expect(computeAdjustedBenefit(30000, 1963, 67 * 12)).toBeCloseTo(30000, 2);
  });

  it("reduces PIA for early claiming", () => {
    expect(computeAdjustedBenefit(30000, 1963, 62 * 12)).toBeCloseTo(
      30000 * 0.7,
      2,
    );
  });

  it("increases PIA for delayed claiming", () => {
    expect(computeAdjustedBenefit(30000, 1963, 70 * 12)).toBeCloseTo(
      30000 * 1.24,
      2,
    );
  });
});

describe("computeSpousalBenefit — greater-of logic", () => {
  const workerPia = 40000; // the OTHER person's PIA
  const spouseBirthYear = 1963; // claiming spouse — FRA 67

  it("returns the spousal amount when it exceeds the spouse's own benefit", () => {
    // Spouse's own adjusted benefit is small; spousal (50% of 40000 = 20000
    // at FRA) dwarfs it.
    const result = computeSpousalBenefit(
      2000,
      workerPia,
      spouseBirthYear,
      67 * 12, // spouse claims spousal benefit at FRA, no reduction
    );
    expect(result).toBeCloseTo(20000, 2);
  });

  it("returns the spouse's own benefit when it exceeds the spousal amount", () => {
    const result = computeSpousalBenefit(
      25000, // spouse's own benefit already exceeds any spousal amount
      workerPia,
      spouseBirthYear,
      67 * 12,
    );
    expect(result).toBe(25000);
  });

  it("never adds own + spousal — the household gets the greater, not both", () => {
    const ownBenefit = 18000;
    const result = computeSpousalBenefit(
      ownBenefit,
      workerPia,
      spouseBirthYear,
      67 * 12,
    );
    // At FRA, spousal = 50% * 40000 = 20000, which exceeds ownBenefit (18000)
    // -> result should be 20000, NOT 18000 + 20000 = 38000.
    expect(result).toBeCloseTo(20000, 2);
    expect(result).not.toBeCloseTo(ownBenefit + 20000, 2);
  });

  it("applies the spousal early-claiming reduction at the CLAIMING SPOUSE's FRA", () => {
    // FRA 67, claiming spousal at 62 (60 months early) -> 32.5% of PIA total
    // (confirmed against SSA's published spousal table in
    // tests/config/social-security.test.ts).
    const result = computeSpousalBenefit(
      0,
      workerPia,
      spouseBirthYear,
      62 * 12,
    );
    expect(result).toBeCloseTo(workerPia * 0.325, 0);
  });

  it("keys the reduction off the CLAIMING SPOUSE's FRA, not the worker's (mixed-FRA couple)", () => {
    // Claiming spouse born 1962 -> FRA 67; worker born 1954 -> FRA 66.
    // Spouse claims spousal at 62 = 60 months before THEIR FRA (67):
    //   36 * 25/36% + 24 * 5/12% = 25% + 10% = 35% reduction -> 0.65 mult.
    // If it wrongly used the WORKER's FRA (66), that's 48 months early ->
    //   36 * 25/36% + 12 * 5/12% = 30% -> 0.70 mult (would overstate ~7.7%).
    const correct = computeSpousalBenefit(0, workerPia, 1962, 62 * 12);
    expect(correct).toBeCloseTo(workerPia * 0.5 * 0.65, 0);
    // Guard against the old bug's number specifically.
    expect(correct).not.toBeCloseTo(workerPia * 0.5 * 0.7, 0);
  });

  describe("exact own+excess formula (with spouseOwnPia)", () => {
    it("matches max() at FRA", () => {
      // Own PIA 12k, worker PIA 48k, both at FRA 67.
      // exact: reducedOwn 12000*1 + excess max(0,24000-12000)*1 = 24000.
      // max(): max(12000, 24000) = 24000. Identical.
      const exact = computeSpousalBenefit(12000, 48000, 1963, 67 * 12, 12000);
      const shortcut = computeSpousalBenefit(12000, 48000, 1963, 67 * 12);
      expect(exact).toBeCloseTo(24000, 2);
      expect(exact).toBeCloseTo(shortcut, 2);
    });

    it("exceeds max() for an early claimer (the two reduction schedules differ)", () => {
      // Own PIA 12k, worker PIA 48k, claim at 62 (FRA 67).
      // reducedOwn = 12000 * 0.70 = 8400.
      // excess = max(0, 24000 - 12000) = 12000; spousal mult at 62 = 0.65.
      // reducedExcess = 12000 * 0.65 = 7800. total = 16200.
      // shortcut max(): max(8400, 24000*0.65=15600) = 15600.
      const exact = computeSpousalBenefit(8400, 48000, 1963, 62 * 12, 12000);
      const shortcut = computeSpousalBenefit(8400, 48000, 1963, 62 * 12);
      expect(exact).toBeCloseTo(16200, 2);
      expect(shortcut).toBeCloseTo(15600, 2);
      expect(exact).toBeGreaterThan(shortcut);
    });

    it("no spousal top-up when own PIA already exceeds half the worker's PIA", () => {
      // Own PIA 30k > 0.5 * 48k = 24k -> excess is 0 -> just the reduced
      // own benefit (delayed here: claim at 70, FRA 67 -> 1.24).
      const result = computeSpousalBenefit(37200, 48000, 1963, 70 * 12, 30000);
      expect(result).toBeCloseTo(30000 * 1.24, 2);
    });
  });
});

describe("sweepClaimingAges", () => {
  it("with no socialSecurityEntries (single-person household), sweeps via the scalar path instead of throwing", () => {
    const input: ProjectionInput = {
      ...makeSingleHousehold(),
      socialSecurityEntries: undefined,
    };
    const result = sweepClaimingAges({
      input,
      personId: 1,
      pia: 30000,
      birthYear: 1963,
      ages: [62, 70],
    });

    expect(result.candidates).toHaveLength(2);
    // Each candidate's amount matches computeAdjustedBenefit directly —
    // proves the scalar override path (not a synthesized entries array)
    // produced these numbers.
    for (const candidate of result.candidates) {
      expect(candidate.adjustedAnnualBenefit).toBeCloseTo(
        computeAdjustedBenefit(30000, 1963, candidate.claimingAge * 12),
        2,
      );
    }
  });

  it("with no socialSecurityEntries, never synthesizes one — mirrors build-engine-payload.ts's single-person scalar path exactly", () => {
    // Regression guard for the same class of bug caught in
    // build-engine-payload.ts (step 5): populating socialSecurityEntries
    // for a single-person household silently activates per-person RMD
    // tracking a real single-person projection never uses. Per-person RMD
    // requires BOTH `rmdStartAgeByPerson.size > 0` (from
    // socialSecurityEntries) AND `hasIndividualAccounts` (context.ts's
    // gate) — makeSingleHousehold() already has owned individualAccounts,
    // so this fixture alone exercises that second gate; adding an
    // UNASSIGNED (ownerPersonId: undefined) pre-tax account is what
    // actually produces a numeric difference between the two paths (an
    // unassigned balance drops out of the per-person RMD base but not the
    // household one) — this is the exact case build-engine-payload.ts's
    // own comment names.
    //
    // This test is checked against a REAL sweepClaimingAges call (not
    // reimplemented), and was verified to actually fail (not silently
    // pass) against a deliberately-reintroduced bug before being kept:
    // temporarily changing buildCandidateInput to synthesize a
    // socialSecurityEntries array on the no-entries branch made this
    // assertion fail, confirming it's a real regression guard, not a
    // tautology comparing two things the test itself constructed the
    // same way (the earlier version of this test had exactly that flaw).
    const base = makeSingleHousehold();
    const withUnassignedAccount: ProjectionInput = {
      ...base,
      socialSecurityEntries: undefined,
      // The household-level preTax total must ACTUALLY include the
      // unassigned account's balance for a divergence to exist — adding
      // it only to individualAccounts without also growing
      // startingBalances.preTax means the household total and the
      // owned-accounts total are coincidentally equal, and nothing drops
      // out of the per-person base at all (the mistake an earlier version
      // of this test made, which is why it didn't reproduce anything).
      startingBalances: {
        ...base.startingBalances,
        preTax: base.startingBalances.preTax + 200000,
      },
      individualAccounts: [
        ...(base.individualAccounts ?? []),
        {
          name: "Unassigned 401k",
          category: "401k",
          taxType: "preTax",
          startingBalance: 200000,
          ownerName: "Household",
          ownerPersonId: undefined,
          parentCategory: "Retirement",
        },
      ],
    };

    const pia = 30000;
    const birthYear = 1963;
    const claimingAge = 62;
    const adjustedAmount = computeAdjustedBenefit(
      pia,
      birthYear,
      claimingAge * 12,
    );

    // The REAL sweep — `finalNetWorth` here is computed by the ACTUAL
    // internal buildCandidateInput → calculateProjection pipeline, not
    // reimplemented in this test. If buildCandidateInput's no-entries
    // branch ever started synthesizing a socialSecurityEntries array
    // instead of setting the scalar fields, this number would reflect
    // THAT (buggy) computation instead.
    const sweep = sweepClaimingAges({
      input: withUnassignedAccount,
      personId: 1,
      pia,
      birthYear,
      ages: [claimingAge],
    });
    const realFinalNetWorth = sweep.candidates[0]!.finalNetWorth;

    // The CORRECT expectation: production's actual single-person scalar
    // path (build-engine-payload.ts's own construction), computed
    // independently here via a direct calculateProjection call.
    const expectedResult = calculateProjection({
      ...withUnassignedAccount,
      socialSecurityAnnual: adjustedAmount,
      ssStartAge: claimingAge,
    });
    const expectedFinal =
      expectedResult.projectionByYear[
        expectedResult.projectionByYear.length - 1
      ];
    const expectedFinalNetWorth = expectedFinal?.balanceByTaxType
      ? expectedFinal.balanceByTaxType.preTax +
        expectedFinal.balanceByTaxType.taxFree +
        expectedFinal.balanceByTaxType.hsa +
        expectedFinal.balanceByTaxType.afterTax
      : 0;

    expect(realFinalNetWorth).toBeCloseTo(expectedFinalNetWorth, 2);
  });

  it("throws for a multi-person input (socialSecurityEntries present) with no buildCandidateInput supplied", () => {
    // makeSingleHousehold() carries a (single-entry) socialSecurityEntries
    // array — enough to exercise the guard. The default builder can't
    // safely handle ANY entries-shaped input on its own: patching one
    // entry in place while leaving a spouse's spousal top-up frozen is
    // exactly the bug this guard exists to prevent (see the module
    // docblock and ClaimingAgeSweepOptions.buildCandidateInput). A real
    // multi-person caller (the sweepSocialSecurityClaimingAges router)
    // must supply its own builder via buildSocialSecurityEntries.
    const input = makeSingleHousehold();
    expect(() =>
      sweepClaimingAges({ input, personId: 1, pia: 30000, birthYear: 1963 }),
    ).toThrow(/requires an explicit buildCandidateInput/);
  });

  it("returns one candidate per default age (62-70 inclusive = 9)", () => {
    const input: ProjectionInput = {
      ...makeSingleHousehold(),
      socialSecurityEntries: undefined,
    };
    const result = sweepClaimingAges({
      input,
      personId: 1,
      pia: 30000,
      birthYear: 1963,
    });
    expect(result.candidates).toHaveLength(9);
    expect(
      result.candidates.map((c) => c.claimingAge).sort((a, b) => a - b),
    ).toEqual([62, 63, 64, 65, 66, 67, 68, 69, 70]);
  });

  it("each candidate's adjustedAnnualBenefit matches computeAdjustedBenefit directly (no drift between the sweep and a manual single-age run)", () => {
    const input: ProjectionInput = {
      ...makeSingleHousehold(),
      socialSecurityEntries: undefined,
    };
    const result = sweepClaimingAges({
      input,
      personId: 1,
      pia: 30000,
      birthYear: 1963,
      ages: [62, 67, 70],
    });
    for (const candidate of result.candidates) {
      expect(candidate.adjustedAnnualBenefit).toBeCloseTo(
        computeAdjustedBenefit(30000, 1963, candidate.claimingAge * 12),
        2,
      );
    }
  });

  it("honors a caller-supplied subset of ages", () => {
    const input: ProjectionInput = {
      ...makeSingleHousehold(),
      socialSecurityEntries: undefined,
    };
    const result = sweepClaimingAges({
      input,
      personId: 1,
      pia: 30000,
      birthYear: 1963,
      ages: [65, 70],
    });
    expect(
      result.candidates.map((c) => c.claimingAge).sort((a, b) => a - b),
    ).toEqual([65, 70]);
  });

  it("recommends a non-null, non-depleted age for a well-funded household", () => {
    const input: ProjectionInput = {
      ...makeSingleHousehold(),
      socialSecurityEntries: undefined,
    };
    const result = sweepClaimingAges({
      input,
      personId: 1,
      pia: 30000,
      birthYear: 1963,
    });
    expect(result.recommendedAge).not.toBeNull();
    const recommended = result.candidates.find(
      (c) => c.claimingAge === result.recommendedAge,
    );
    expect(recommended?.depleted).toBe(false);
  });

  it("a caller-supplied buildCandidateInput can vary a SPOUSE's entry per candidate age (the mechanism the multi-person router relies on)", () => {
    // Proves the injected builder actually drives what calculateProjection
    // sees, at every candidate age — not just the swept person's own
    // amount. A spouse's entry here is deliberately set to a DIFFERENT
    // amount at each claiming age (spouseAmountForAge), standing in for
    // real spousal-top-up math the router computes via
    // buildSocialSecurityEntries. If the sweep ignored the callback (fell
    // through to the default patch-in-place builder), the spouse's
    // benefit would be frozen at whatever the base input carried instead
    // of tracking the swept age, and this test would still "pass" only by
    // coincidence unless the resulting net worth actually differs — so
    // assert the two single-age sweeps below (age 62 vs 70) produce
    // DIFFERENT final net worth purely from the spouse-side change.
    const base: ProjectionInput = {
      ...makeSingleHousehold(),
      socialSecurityEntries: undefined,
    };
    const spouseAmountForAge = (claimingAge: number) =>
      claimingAge === 62 ? 5000 : 25000;

    function buildCandidateInput(
      claimingAge: number,
      adjustedAnnualBenefit: number,
    ): ProjectionInput {
      return {
        ...base,
        socialSecurityEntries: [
          {
            personId: 1,
            personName: "Owner",
            annualAmount: adjustedAnnualBenefit,
            startAge: claimingAge,
            birthYear: 1963,
          },
          {
            personId: 2,
            personName: "Spouse",
            annualAmount: spouseAmountForAge(claimingAge),
            startAge: 67,
            birthYear: 1965,
          },
        ],
      };
    }

    const at62 = sweepClaimingAges({
      input: base,
      personId: 1,
      pia: 30000,
      birthYear: 1963,
      ages: [62],
      buildCandidateInput,
    });
    const at70 = sweepClaimingAges({
      input: base,
      personId: 1,
      pia: 30000,
      birthYear: 1963,
      ages: [70],
      buildCandidateInput,
    });

    expect(at62.candidates).toHaveLength(1);
    expect(at70.candidates).toHaveLength(1);
    expect(at62.candidates[0]!.finalNetWorth).not.toBeCloseTo(
      at70.candidates[0]!.finalNetWorth,
      -3, // differ by at least $500 — proves the spouse-side amount (not
      // just the swept person's own claiming-age adjustment) reached the
      // projection.
    );
  });
});

// Plan §8's required check: "a person with socialSecurityPia set produces
// the same result as manually pre-computing the adjusted amount and passing
// it via the existing flat field — proves the integration is equivalent,
// not a parallel code path with its own bugs." Run at the true engine
// level (calculateProjection), not just checking build-engine-payload's
// output shape — an earlier version of the server-side wiring (caught by
// advisor review before commit) passed this kind of shape-only check while
// still silently changing RMD behavior via a different field
// (socialSecurityEntries also drives per-person RMD tracking). This test
// exercises the SINGLE-PERSON path specifically — build-engine-payload.ts
// routes a single person's PIA through the scalar socialSecurityAnnual
// field precisely so this equivalence holds with zero side effects; a
// version that routed it through socialSecurityEntries instead would still
// pass this test's assertions (annualAmount is correct either way) while
// failing the RMD side of the picture, which is why
// tests/server/build-engine-payload.test.ts separately asserts
// socialSecurityEntries stays undefined for a single-person household.
describe("PIA wiring equivalence (plan §8) — engine level", () => {
  it("a PIA-derived annualAmount produces an identical projection to manually passing the same pre-computed amount", () => {
    const pia = 30000;
    const birthYear = 1963; // FRA 67
    const claimingAge = 63; // 48 months early
    // Golden literal, NOT computeAdjustedBenefit called a second time — an
    // earlier version of this test called the same function on both sides
    // and only proved calculateProjection is deterministic (f(x) === f(x)).
    // FRA 67, 48 months early: 36mo * 5/9% + 12mo * 5/12% = 20% + 5% = 25%
    // reduction -> 0.75 multiplier (same formula golden-tested directly in
    // tests/config/social-security.test.ts).
    const expectedAdjustedAmount = pia * 0.75;

    const base = makeSingleHousehold();
    const viaFlatField: ProjectionInput = {
      ...base,
      ssStartAge: claimingAge,
      socialSecurityAnnual: expectedAdjustedAmount,
      socialSecurityEntries: undefined,
    };
    // What build-engine-payload.ts's single-person PIA path does under the
    // hood: compute the adjusted amount, then set it on the SAME scalar
    // field — not a different code path, just a different source for the
    // number.
    const computedAmount = computeAdjustedBenefit(
      pia,
      birthYear,
      claimingAge * 12,
    );
    expect(computedAmount).toBeCloseTo(expectedAdjustedAmount, 2);
    const viaPiaWiring: ProjectionInput = {
      ...base,
      ssStartAge: claimingAge,
      socialSecurityAnnual: computedAmount,
      socialSecurityEntries: undefined,
    };

    const resultA = calculateProjection(viaFlatField);
    const resultB = calculateProjection(viaPiaWiring);

    expect(resultB.projectionByYear).toEqual(resultA.projectionByYear);
    expect(resultB.portfolioDepletionAge).toBe(resultA.portfolioDepletionAge);
  });
});
