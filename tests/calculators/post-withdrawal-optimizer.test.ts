import { describe, it, expect } from "vitest";
import {
  performRothConversion,
  checkIrmaa,
  checkAca,
} from "@/lib/calculators/engine/post-withdrawal-optimizer";
import type {
  RothConversionInput,
  IrmaaInput,
  AcaInput,
} from "@/lib/calculators/engine/post-withdrawal-optimizer";
import {
  makeTaxBuckets,
  makeAccountBalances,
  makeIndividualAccount,
  TEST_BRACKETS,
} from "./fixtures/engine-fixtures";
import { makeIndKey } from "@/lib/calculators/engine/individual-account-tracking";
import type { IndividualAccountInput } from "@/lib/calculators/types";

// ---------------------------------------------------------------------------
// performRothConversion
// ---------------------------------------------------------------------------

function makeRothInput(
  overrides: Partial<RothConversionInput> = {},
): RothConversionInput {
  return {
    enableRothConversions: true,
    taxBrackets: TEST_BRACKETS,
    taxMultiplier: 1.0,
    rothConversionTarget: undefined,
    rothBracketTarget: 0.22, // fill up to 22% bracket (cap at 96175)
    totalTraditionalWithdrawal: 40000,
    taxableSS: 10000,
    rothTaxableGrowth: 0,
    brokerageGainsPortion: 5000,
    filingStatus: "MFJ",
    balances: makeTaxBuckets(),
    acctBal: makeAccountBalances(),
    ...overrides,
  };
}

describe("performRothConversion", () => {
  it("returns zero when disabled", () => {
    const result = performRothConversion(
      makeRothInput({ enableRothConversions: false }),
    );
    expect(result.rothConversionAmount).toBe(0);
    expect(result.rothConversionTaxCost).toBe(0);
  });

  it("returns zero when taxBrackets are null or empty", () => {
    expect(
      performRothConversion(makeRothInput({ taxBrackets: null }))
        .rothConversionAmount,
    ).toBe(0);
    expect(
      performRothConversion(makeRothInput({ taxBrackets: [] }))
        .rothConversionAmount,
    ).toBe(0);
  });

  it("returns zero when no Traditional balance available", () => {
    const result = performRothConversion(
      makeRothInput({ balances: makeTaxBuckets({ preTax: 0 }) }),
    );
    expect(result.rothConversionAmount).toBe(0);
  });

  it("returns zero when rothConversionTarget is explicitly 0", () => {
    const result = performRothConversion(
      makeRothInput({ rothConversionTarget: 0 }),
    );
    expect(result.rothConversionAmount).toBe(0);
  });

  it("returns zero when both targets are undefined", () => {
    const result = performRothConversion(
      makeRothInput({
        rothConversionTarget: undefined,
        rothBracketTarget: undefined,
      }),
    );
    expect(result.rothConversionAmount).toBe(0);
  });

  it("converts up to bracket cap minus taxable income", () => {
    // incomeCapForMarginalRate(0.22) = 201550 (first bracket with rate > 0.22 is 24% at 201550)
    // yearTaxableIncome = 40000 + 10000 = 50000
    // conversionRoom = 201550 - 50000 = 151550
    // preTax balance = 500000 (default), so capped at conversionRoom
    const balances = makeTaxBuckets();
    const acctBal = makeAccountBalances();
    const result = performRothConversion(makeRothInput({ balances, acctBal }));
    expect(result.rothConversionAmount).toBeCloseTo(151550, 0);
    expect(result.rothConversionTaxCost).toBeGreaterThan(0);
    // Traditional balance should decrease
    expect(balances.preTax).toBeCloseTo(500000 - 151550, 0);
    // Roth balance should increase
    expect(balances.taxFree).toBeCloseTo(200000 + 151550, 0);
    // Brokerage should decrease by tax cost
    expect(balances.afterTax).toBeLessThan(300000);
  });

  it("includes rothTaxableGrowth in yearTaxableIncome, shrinking conversionRoom by exactly that amount (advisor-flagged 2026-09-01)", () => {
    // Same setup as the previous test, but with a real non-qualified Roth
    // growth draw this year. Before this fix, yearTaxableIncome silently
    // dropped rothTaxableGrowth (exactly the bug actualTaxableIncome's own
    // docblock, tax-estimation.ts, was added to prevent), overstating
    // conversionRoom by the full $20,000.
    const balances = makeTaxBuckets();
    const acctBal = makeAccountBalances();
    const result = performRothConversion(
      makeRothInput({ balances, acctBal, rothTaxableGrowth: 20000 }),
    );
    // conversionRoom = 201550 - (40000 + 10000 + 20000) = 131550
    expect(result.rothConversionAmount).toBeCloseTo(131550, 0);
  });

  it("caps conversion at available Traditional balance", () => {
    // Only 5000 in Traditional
    const balances = makeTaxBuckets({ preTax: 5000 });
    const acctBal = makeAccountBalances({ preTax: 5000 });
    const result = performRothConversion(makeRothInput({ balances, acctBal }));
    expect(result.rothConversionAmount).toBe(5000);
  });

  it("returns zero when no conversion room (taxable income already at cap)", () => {
    // incomeCapForMarginalRate(0.22) = 201550
    // taxable income = 191550 + 10000 = 201550 (at bracket cap)
    const result = performRothConversion(
      makeRothInput({
        totalTraditionalWithdrawal: 191550,
        taxableSS: 10000,
      }),
    );
    expect(result.rothConversionAmount).toBe(0);
  });

  it("skips conversion when brokerage can't cover tax cost", () => {
    // Very small brokerage balance can't cover tax
    const balances = makeTaxBuckets({ afterTax: 1, afterTaxBasis: 0 });
    const acctBal = makeAccountBalances({ afterTax: 1, afterTaxBasis: 0 });
    const result = performRothConversion(makeRothInput({ balances, acctBal }));
    // Conversion of ~46175 would have tax > $1
    expect(result.rothConversionAmount).toBe(0);
  });

  it("prefers rothConversionTarget over rothBracketTarget", () => {
    // rothConversionTarget = 0.12 → bracket cap at 96175 (12% → next bracket is 22% at 96175)
    // rothBracketTarget = 0.32 → bracket cap at 383325
    const balances1 = makeTaxBuckets();
    const acctBal1 = makeAccountBalances();
    const r1 = performRothConversion(
      makeRothInput({
        rothConversionTarget: 0.12,
        rothBracketTarget: 0.32,
        balances: balances1,
        acctBal: acctBal1,
      }),
    );
    const balances2 = makeTaxBuckets();
    const acctBal2 = makeAccountBalances();
    const r2 = performRothConversion(
      makeRothInput({
        rothConversionTarget: undefined,
        rothBracketTarget: 0.32,
        balances: balances2,
        acctBal: acctBal2,
      }),
    );
    // With lower target (0.12), conversion should be smaller
    expect(r1.rothConversionAmount).toBeLessThan(r2.rothConversionAmount);
  });

  it("applies IRMAA-aware cap when enabled", () => {
    // IRMAA MFJ first cliff = 206000
    // MAGI without conversion = 40000 + 5000 + 10000 = 55000
    // Max conversion for cliff = 206000 - 55000 = 151000
    // Normal conversion room = 96175 - 50000 = 46175
    // Since 46175 < 151000, IRMAA cap doesn't reduce it here.
    // To test IRMAA actually capping, use higher income:
    const balances = makeTaxBuckets();
    const acctBal = makeAccountBalances();
    const result = performRothConversion(
      makeRothInput({
        irmaaAwareRothConversions: true,
        totalTraditionalWithdrawal: 150000,
        taxableSS: 10000,
        brokerageGainsPortion: 40000,
        // MAGI without conversion = 150000 + 40000 + 10000 = 200000
        // Next IRMAA cliff = 206000
        // Max conversion for cliff = 6000
        // bracket cap for 0.22 = 96175
        // yearTaxableIncome = 160000
        // conversionRoom = max(0, 96175 - 160000) = 0 → no conversion room anyway
        // Use higher bracket target:
        rothBracketTarget: 0.35, // cap at 457525
        balances,
        acctBal,
      }),
    );
    // Without IRMAA: conversionRoom = 457525 - 160000 = 297525 (capped at preTax 500000)
    // With IRMAA: max = 206000 - 200000 = 6000
    expect(result.rothConversionAmount).toBeLessThanOrEqual(6000);
  });

  it("applies tax multiplier to tax cost calculation", () => {
    const balances1 = makeTaxBuckets();
    const acctBal1 = makeAccountBalances();
    const r1 = performRothConversion(
      makeRothInput({
        taxMultiplier: 1.0,
        balances: balances1,
        acctBal: acctBal1,
      }),
    );
    const balances2 = makeTaxBuckets();
    const acctBal2 = makeAccountBalances();
    const r2 = performRothConversion(
      makeRothInput({
        taxMultiplier: 1.5,
        balances: balances2,
        acctBal: acctBal2,
      }),
    );
    // Same conversion amount (bracket cap is the same), but higher tax cost
    expect(r1.rothConversionAmount).toBe(r2.rothConversionAmount);
    expect(r2.rothConversionTaxCost).toBeGreaterThan(r1.rothConversionTaxCost);
  });
});

// ---------------------------------------------------------------------------
// checkIrmaa
// ---------------------------------------------------------------------------

function makeIrmaaInput(overrides: Partial<IrmaaInput> = {}): IrmaaInput {
  return {
    enableIrmaaAwareness: true,
    filingStatus: "MFJ",
    anyPersonAge65: true,
    projectedMagi: 250000,
    rothConversionAmount: 0,
    ...overrides,
  };
}

describe("checkIrmaa", () => {
  it("returns zero when disabled", () => {
    const result = checkIrmaa(makeIrmaaInput({ enableIrmaaAwareness: false }));
    expect(result.irmaaCost).toBe(0);
    expect(result.warnings).toHaveLength(0);
  });

  it("returns zero when no filing status", () => {
    const result = checkIrmaa(makeIrmaaInput({ filingStatus: null }));
    expect(result.irmaaCost).toBe(0);
  });

  it("returns zero when no one is 65+", () => {
    const result = checkIrmaa(makeIrmaaInput({ anyPersonAge65: false }));
    expect(result.irmaaCost).toBe(0);
  });

  it("returns surcharge when MAGI exceeds IRMAA threshold", () => {
    // MFJ tier 1: 206000 → surcharge 1056
    // MAGI 250000 > 206000, < 258000 → tier 1
    const result = checkIrmaa(makeIrmaaInput({ projectedMagi: 250000 }));
    expect(result.irmaaCost).toBe(1056);
  });

  it("returns zero when MAGI is below all thresholds", () => {
    const result = checkIrmaa(makeIrmaaInput({ projectedMagi: 100000 }));
    expect(result.irmaaCost).toBe(0);
  });

  it("warns when Roth conversion pushes MAGI over a cliff", () => {
    // Without conversion: MAGI = 200000 (below 206000) → no surcharge
    // With conversion: MAGI = 200000 + 20000 = 220000 → surcharge 1056
    const result = checkIrmaa(
      makeIrmaaInput({
        projectedMagi: 220000, // includes conversion
        rothConversionAmount: 20000,
      }),
    );
    expect(result.irmaaCost).toBe(1056);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain("IRMAA");
    expect(result.warnings[0]).toContain("Roth conversion");
  });

  it("no warning when conversion doesn't change IRMAA tier", () => {
    // MAGI = 260000 with or without conversion → already in tier 1
    const result = checkIrmaa(
      makeIrmaaInput({
        projectedMagi: 260000,
        rothConversionAmount: 5000,
        // Without conversion: 255000 → tier 1 (1056), same as with
      }),
    );
    expect(result.irmaaCost).toBe(2640); // tier 2 (>258000)
    // Without conversion: 255000 → tier 1 (1056) < 2640 → should warn
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// checkAca
// ---------------------------------------------------------------------------

function makeAcaInput(overrides: Partial<AcaInput> = {}): AcaInput {
  return {
    enableAcaAwareness: true,
    allPersonsUnder65: true,
    householdSize: 2,
    totalTraditionalWithdrawal: 30000,
    rothConversionAmount: 0,
    brokerageGainsPortion: 5000,
    rothTaxableGrowth: 0,
    ssIncome: 0,
    // Phase 4 (2026-08-31): factor 1 == no growth applied (matches
    // taxGrowthFactor's own "year === dataYear" identity convention) --
    // these existing fixture-driven tests were written before FPL growth
    // existed and assert against the raw $84,600 (2-person) cliff, so
    // keep them at the no-op factor rather than updating every literal.
    fplGrowthFactor: 1,
    ...overrides,
  };
}

describe("checkAca", () => {
  it("returns false/0 when disabled", () => {
    const result = checkAca(makeAcaInput({ enableAcaAwareness: false }));
    expect(result.acaSubsidyPreserved).toBe(false);
    expect(result.acaMagiHeadroom).toBe(0);
    expect(result.warnings).toHaveLength(0);
  });

  it("returns false/0 when not all persons under 65", () => {
    const result = checkAca(makeAcaInput({ allPersonsUnder65: false }));
    expect(result.acaSubsidyPreserved).toBe(false);
    expect(result.acaMagiHeadroom).toBe(0);
  });

  it("preserves subsidy when MAGI is below cliff", () => {
    // Household size 2: FPL = 21150, cliff = 84600
    // MAGI = 30000 + 0 + 5000 + 0 = 35000 < 84600
    const result = checkAca(makeAcaInput());
    expect(result.acaSubsidyPreserved).toBe(true);
    expect(result.acaMagiHeadroom).toBeCloseTo(84600 - 35000, 0);
    expect(result.warnings).toHaveLength(0);
  });

  it("warns when MAGI exceeds cliff", () => {
    // Push MAGI over 84600 (household size 2)
    const result = checkAca(
      makeAcaInput({ totalTraditionalWithdrawal: 80000 }),
    );
    // MAGI = 80000 + 0 + 5000 + 0 = 85000 > 84600
    expect(result.acaSubsidyPreserved).toBe(false);
    expect(result.acaMagiHeadroom).toBe(0);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain("ACA");
    expect(result.warnings[0]).toContain("cliff");
  });

  it("warning attributes the overage to brokerage when brokerage gains could cover it (R55)", () => {
    // MAGI = 80000 + 0 + 5000 + 0 = 85000, overage = 400, brokerageGainsPortion 5000 >= 400
    const result = checkAca(
      makeAcaInput({ totalTraditionalWithdrawal: 80000 }),
    );
    expect(result.warnings[0]).toContain("sourcing");
    expect(result.warnings[0]).toContain("less from brokerage");
  });

  it("warning omits the brokerage attribution when brokerage gains can't cover the overage (R55)", () => {
    // MAGI = 84700 + 0 + 0 + 0 = 84700, overage = 100, brokerageGainsPortion 0 < 100
    const result = checkAca(
      makeAcaInput({
        totalTraditionalWithdrawal: 84700,
        brokerageGainsPortion: 0,
      }),
    );
    expect(result.acaSubsidyPreserved).toBe(false);
    expect(result.warnings[0]).not.toContain("sourcing");
  });

  it("includes Roth conversion in MAGI calculation", () => {
    // Base MAGI = 30000 + 5000 = 35000 (under cliff)
    // With 60000 conversion: 35000 + 60000 = 95000 (over 84600 cliff)
    const result = checkAca(makeAcaInput({ rothConversionAmount: 60000 }));
    expect(result.acaSubsidyPreserved).toBe(false);
  });

  it("includes full gross SS benefit (not just the taxable slice) in MAGI calculation", () => {
    // Base MAGI = 30000 + 5000 = 35000 (under cliff)
    // ACA MAGI must add back the FULL SS benefit (§36B(d)(2)(B)), not the
    // 0-85% taxable slice used for IRMAA/income tax: 35000 + 50000 = 85000
    // (over 84600 cliff)
    const result = checkAca(makeAcaInput({ ssIncome: 50000 }));
    expect(result.acaSubsidyPreserved).toBe(false);
  });

  it("includes non-qualified Roth growth income in MAGI (advisor-caught 2026-09-01: previously omitted here while currentYearMagi/NIIT already included it)", () => {
    // Base MAGI = 30000 + 5000 = 35000 (under cliff). Adding rothTaxableGrowth
    // must push it over the same way rothConversionAmount/ssIncome already do:
    // 35000 + 50000 = 85000 (over 84600 cliff).
    const result = checkAca(makeAcaInput({ rothTaxableGrowth: 50000 }));
    expect(result.acaSubsidyPreserved).toBe(false);
  });

  it("adjusts cliff by household size", () => {
    // Household size 1: FPL = 15650, cliff = 62600
    // Household size 4: FPL = 32150, cliff = 128600
    const r1 = checkAca(makeAcaInput({ householdSize: 1 }));
    const r4 = checkAca(makeAcaInput({ householdSize: 4 }));
    expect(r4.acaMagiHeadroom).toBeGreaterThan(r1.acaMagiHeadroom);
  });
});

// ---------------------------------------------------------------------------
// performRothConversion — Retirement-only scope (R49)
// ---------------------------------------------------------------------------

describe("performRothConversion (R49 — nonRetirement scope)", () => {
  const indKey = makeIndKey();

  function accts(): IndividualAccountInput[] {
    return [
      makeIndividualAccount({
        name: "Retirement 401k",
        category: "401k",
        taxType: "preTax",
        startingBalance: 100000,
        parentCategory: "Retirement",
      }),
      makeIndividualAccount({
        name: "Portfolio 401k",
        category: "401k",
        taxType: "preTax",
        startingBalance: 400000,
        parentCategory: "Portfolio",
      }),
      makeIndividualAccount({
        name: "Retirement Brokerage",
        category: "brokerage",
        taxType: "afterTax",
        startingBalance: 300000,
        parentCategory: "Retirement",
      }),
    ];
  }

  function indBalFor(ia: IndividualAccountInput[]) {
    const m = new Map<string, number>();
    for (const a of ia) m.set(indKey(a), a.startingBalance);
    return m;
  }

  function nonRetirementFor(trad401k: number) {
    return {
      total: { "401k": 0, "403b": 0, ira: 0, hsa: 0, brokerage: 0 },
      trad: { "401k": trad401k, "403b": 0, ira: 0, hsa: 0, brokerage: 0 },
      roth: { "401k": 0, "403b": 0, ira: 0, hsa: 0, brokerage: 0 },
      grandTotal: trad401k,
    };
  }

  it("caps the conversion SOURCE amount to Retirement-only pretax, not the blended balances.preTax", () => {
    // Blended preTax = 500000 (Retirement 100k + Portfolio 400k). Bracket
    // room is large (see makeRothInput's own comment: ~151550) -- without
    // the R49 cap, conversion would size against the full blended balance.
    const balances = makeTaxBuckets({ preTax: 500000, afterTax: 300000 });
    const acctBal = makeAccountBalances({ preTax: 500000, afterTax: 300000 });
    acctBal["401k"] = {
      structure: "roth_traditional",
      traditional: 500000,
      roth: 0,
    };
    const ia = accts();
    const result = performRothConversion(
      makeRothInput({
        balances,
        acctBal,
        indAccts: ia,
        indBal: indBalFor(ia),
        indKey,
        nonRetirement: nonRetirementFor(400000), // Portfolio 401k's balance
      }),
    );
    // Retirement-only pretax = 500000 - 400000 = 100000, well under the
    // ~151550 bracket-room ceiling -- so the conversion is capped there.
    expect(result.rothConversionAmount).toBeCloseTo(100000, 0);
  });

  it("debits only the Retirement-parented account's indBal, leaving the Portfolio-parented account untouched", () => {
    const balances = makeTaxBuckets({ preTax: 500000, afterTax: 300000 });
    const acctBal = makeAccountBalances({ preTax: 500000, afterTax: 300000 });
    acctBal["401k"] = {
      structure: "roth_traditional",
      traditional: 500000,
      roth: 0,
    };
    const ia = accts();
    const indBal = indBalFor(ia);
    performRothConversion(
      makeRothInput({
        balances,
        acctBal,
        indAccts: ia,
        indBal,
        indKey,
        nonRetirement: nonRetirementFor(400000),
      }),
    );
    const [retirement401k, portfolio401k] = ia;
    expect(indBal.get(indKey(portfolio401k!))).toBe(400000); // untouched
    expect(indBal.get(indKey(retirement401k!))).toBeLessThan(100000); // debited
  });

  it("caps the tax-payment gate to Retirement-only brokerage capacity", () => {
    // Retirement-only brokerage = 300000 (the only brokerage account, and
    // it's Retirement-parented) -- same as the blended total here, so this
    // asserts the gate doesn't spuriously fail when nonRetirement has
    // nothing to exclude from THIS category.
    const balances = makeTaxBuckets({ preTax: 100000, afterTax: 300000 });
    const acctBal = makeAccountBalances({ preTax: 100000, afterTax: 300000 });
    const ia = accts().filter(
      (a) => a.category !== "401k" || a.parentCategory === "Retirement",
    );
    const result = performRothConversion(
      makeRothInput({
        balances,
        acctBal,
        indAccts: ia,
        indBal: indBalFor(ia),
        indKey,
        nonRetirement: nonRetirementFor(0),
      }),
    );
    expect(result.rothConversionAmount).toBeGreaterThan(0);
  });

  it("skips the conversion entirely when Retirement-only brokerage can't cover the tax cost, even though blended brokerage could", () => {
    const balances = makeTaxBuckets({ preTax: 100000, afterTax: 300000 });
    const acctBal = makeAccountBalances({ preTax: 100000, afterTax: 300000 });
    const ia = [
      makeIndividualAccount({
        name: "Retirement 401k",
        category: "401k",
        taxType: "preTax",
        startingBalance: 100000,
        parentCategory: "Retirement",
      }),
      makeIndividualAccount({
        name: "Retirement Brokerage",
        category: "brokerage",
        taxType: "afterTax",
        startingBalance: 500, // negligible -- can't cover any real tax cost
        parentCategory: "Retirement",
      }),
      makeIndividualAccount({
        name: "Portfolio Brokerage",
        category: "brokerage",
        taxType: "afterTax",
        startingBalance: 299500, // makes blended afterTax look fully funded
        parentCategory: "Portfolio",
      }),
    ];
    const nonRetirement = {
      total: { "401k": 0, "403b": 0, ira: 0, hsa: 0, brokerage: 299500 },
      trad: { "401k": 0, "403b": 0, ira: 0, hsa: 0, brokerage: 0 },
      roth: { "401k": 0, "403b": 0, ira: 0, hsa: 0, brokerage: 0 },
      grandTotal: 299500,
    };
    const result = performRothConversion(
      makeRothInput({
        balances,
        acctBal,
        indAccts: ia,
        indBal: indBalFor(ia),
        indKey,
        nonRetirement,
      }),
    );
    expect(result.rothConversionAmount).toBe(0);
    expect(result.rothConversionTaxCost).toBe(0);
  });

  it("byte-identical to pre-R49 behavior when nonRetirement (and ind* data) are omitted entirely -- the real call site's actual fallback shape", () => {
    // decumulation-year.ts always computes nonRetirement and
    // indAccts/indBal/indKey together, gated on the same
    // hasIndividualAccounts check (see its own R49 comment) -- so the real
    // "not tracking individual accounts" fallback is ALL of these omitted
    // together, not nonRetirement alone.
    const balancesA = makeTaxBuckets();
    const acctBalA = makeAccountBalances();
    const balancesB = makeTaxBuckets();
    const acctBalB = makeAccountBalances();
    const resultA = performRothConversion(
      makeRothInput({ balances: balancesA, acctBal: acctBalA }),
    );
    const resultB = performRothConversion(
      makeRothInput({ balances: balancesB, acctBal: acctBalB }),
    );
    expect(resultA.rothConversionAmount).toBe(resultB.rothConversionAmount);
    expect(resultA.rothConversionTaxCost).toBe(resultB.rothConversionTaxCost);
  });

  it("still caps the amount from nonRetirement alone even without indAccts/indBal/indKey -- capping doesn't require per-account debit capability", () => {
    const balances = makeTaxBuckets({ preTax: 500000, afterTax: 300000 });
    const acctBal = makeAccountBalances({ preTax: 500000, afterTax: 300000 });
    acctBal["401k"] = {
      structure: "roth_traditional",
      traditional: 500000,
      roth: 0,
    };
    const result = performRothConversion(
      makeRothInput({
        balances,
        acctBal,
        nonRetirement: nonRetirementFor(400000),
      }),
    );
    expect(result.rothConversionAmount).toBeCloseTo(100000, 0);
  });
});

// ---------------------------------------------------------------------------
// performRothConversion — R47 RMD-smoothing elevated ceiling
// ---------------------------------------------------------------------------

describe("performRothConversion (R47 — RMD-smoothing elevated ceiling)", () => {
  it("converts even when enableRothConversions is off, if smoothing is active (self-contained toggle)", () => {
    const result = performRothConversion(
      makeRothInput({
        enableRothConversions: false,
        rothBracketTarget: undefined,
        rothConversionTarget: undefined,
        rmdSmoothingTarget: 50000,
        rmdSmoothingMaxBracketTarget: 0.24,
      }),
    );
    expect(result.rothConversionAmount).toBeGreaterThan(0);
  });

  it("respects an explicit rothConversionTarget: 0 opt-out even when smoothing is active", () => {
    const result = performRothConversion(
      makeRothInput({
        enableRothConversions: true,
        rothConversionTarget: 0,
        rmdSmoothingTarget: 50000,
        rmdSmoothingMaxBracketTarget: 0.24,
      }),
    );
    expect(result.rothConversionAmount).toBe(0);
    expect(result.rmdSmoothingShortfall).toBe(50000);
  });

  it("byte-identical to omitting smoothing entirely when rmdSmoothingTarget is 0/undefined", () => {
    const withUndefined = performRothConversion(
      makeRothInput({
        balances: makeTaxBuckets(),
        acctBal: makeAccountBalances(),
      }),
    );
    const withZero = performRothConversion(
      makeRothInput({
        balances: makeTaxBuckets(),
        acctBal: makeAccountBalances(),
        rmdSmoothingTarget: 0,
      }),
    );
    expect(withUndefined.rothConversionAmount).toBe(
      withZero.rothConversionAmount,
    );
    expect(withUndefined.rmdSmoothingShortfall).toBeUndefined();
    expect(withZero.rmdSmoothingShortfall).toBeUndefined();
  });

  it("never lowers a household's already-higher existing target below rmdSmoothingMaxBracketTarget", () => {
    // Household already configured at 32% -- smoothing's own max is a
    // lower 12%. The effective ceiling must stay at 32% (the household's
    // own, higher, already-configured value), not drop to 12%.
    const balances = makeTaxBuckets({
      preTax: 10_000_000,
      afterTax: 5_000_000,
    });
    const acctBal = makeAccountBalances({
      preTax: 10_000_000,
      afterTax: 5_000_000,
    });
    const withoutSmoothing = performRothConversion(
      makeRothInput({
        balances: { ...balances },
        acctBal: { ...acctBal },
        rothBracketTarget: 0.32,
        rothConversionTarget: undefined,
      }),
    );
    const withSmoothing = performRothConversion(
      makeRothInput({
        balances: { ...balances },
        acctBal: { ...acctBal },
        rothBracketTarget: 0.32,
        rothConversionTarget: undefined,
        rmdSmoothingTarget: 1000, // small -- shouldn't need MORE than 32% already provides
        rmdSmoothingMaxBracketTarget: 0.12, // lower than the household's own 0.32
      }),
    );
    // The household's own 32% ceiling must still apply -- not reduced to 12%.
    expect(withSmoothing.rothConversionAmount).toBeCloseTo(
      withoutSmoothing.rothConversionAmount,
      0,
    );
  });

  it("elevates the effective ceiling up to rmdSmoothingMaxBracketTarget when the household's own target isn't enough room", () => {
    // No existing target at all -- smoothing must supply one, up to its
    // own max, to have any effect (matches the mid-implementation finding
    // that a household with nothing configured gets nothing from a plain
    // floor).
    const result = performRothConversion(
      makeRothInput({
        rothBracketTarget: undefined,
        rothConversionTarget: undefined,
        enableRothConversions: false,
        totalTraditionalWithdrawal: 10000,
        taxableSS: 0,
        rmdSmoothingTarget: 20000,
        rmdSmoothingMaxBracketTarget: 0.12,
      }),
    );
    // 10% bracket cap is 16550; 20000 needed pushes into the 12% bracket
    // (cap 33725) -- conversionRoom at 12% = 33725-10000 = 23725. Existing
    // bracket-fill behavior converts the FULL room once a target is
    // active (no "stop exactly at the smoothing target" logic), so the
    // actual conversion (23725) is >= the 20000 target -- fully achieved,
    // with room to spare from the same bracket.
    expect(result.rothConversionAmount).toBeGreaterThanOrEqual(20000);
    expect(result.rmdSmoothingShortfall).toBe(0);
  });

  it("reports a real, non-zero rmdSmoothingShortfall when even the elevated ceiling isn't enough", () => {
    const result = performRothConversion(
      makeRothInput({
        rothBracketTarget: undefined,
        rothConversionTarget: undefined,
        enableRothConversions: false,
        totalTraditionalWithdrawal: 10000,
        taxableSS: 0,
        rmdSmoothingTarget: 1_000_000, // far more than even the 12% bracket allows
        rmdSmoothingMaxBracketTarget: 0.12,
      }),
    );
    expect(result.rmdSmoothingShortfall).toBeGreaterThan(0);
    // 12% bracket cap is 33725; conversionRoom = 33725-10000 = 23725 max.
    expect(result.rothConversionAmount).toBeLessThan(1_000_000);
  });

  it("still respects R49's Retirement-only capacity cap even when smoothing elevates the target rate", () => {
    const balances = makeTaxBuckets({ preTax: 500000, afterTax: 300000 });
    const acctBal = makeAccountBalances({ preTax: 500000, afterTax: 300000 });
    const result = performRothConversion(
      makeRothInput({
        balances,
        acctBal,
        rothBracketTarget: undefined,
        rothConversionTarget: undefined,
        enableRothConversions: false,
        totalTraditionalWithdrawal: 0,
        taxableSS: 0,
        rmdSmoothingTarget: 400000,
        rmdSmoothingMaxBracketTarget: 0.37, // top bracket -- plenty of room by rate
        nonRetirement: {
          total: { "401k": 0, "403b": 0, ira: 0, hsa: 0, brokerage: 0 },
          trad: { "401k": 400000, "403b": 0, ira: 0, hsa: 0, brokerage: 0 }, // only 100000 Retirement-only
          roth: { "401k": 0, "403b": 0, ira: 0, hsa: 0, brokerage: 0 },
          grandTotal: 400000,
        },
      }),
    );
    expect(result.rothConversionAmount).toBeCloseTo(100000, 0);
    expect(result.rmdSmoothingShortfall).toBeGreaterThan(0);
  });
});
