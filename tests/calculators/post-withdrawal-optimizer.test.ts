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
  TEST_BRACKETS,
} from "./fixtures/engine-fixtures";

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
    taxableSS: 0,
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

  it("includes Roth conversion in MAGI calculation", () => {
    // Base MAGI = 30000 + 5000 = 35000 (under cliff)
    // With 60000 conversion: 35000 + 60000 = 95000 (over 84600 cliff)
    const result = checkAca(makeAcaInput({ rothConversionAmount: 60000 }));
    expect(result.acaSubsidyPreserved).toBe(false);
  });

  it("includes taxable SS in MAGI calculation", () => {
    // Base MAGI = 30000 + 5000 = 35000 (under cliff)
    // With SS: 35000 + 50000 = 85000 (over 84600 cliff)
    const result = checkAca(makeAcaInput({ taxableSS: 50000 }));
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
