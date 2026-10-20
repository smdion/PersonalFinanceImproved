/**
 * calculateHouseholdTax — federal on combined income with one standard
 * deduction, Social Security per person, Additional Medicare on the
 * household above the filing status's LIABILITY threshold (fictional
 * households; thresholds are passed in, as the router reads them from
 * reference data).
 */
import { describe, it, expect } from "vitest";
import { calculateHouseholdTax } from "@/lib/calculators/tax";
import { sumBracketTax } from "@/lib/calculators/tax-brackets";
import type { TaxBracketInput } from "@/lib/calculators/types";
import { MFJ_TAXABLE_INCOME_BRACKETS } from "./fixtures";

const B = MFJ_TAXABLE_INCOME_BRACKETS;
const MFJ_LIABILITY = 250_000;
const WITHHOLDING = B.medicareAdditionalThreshold; // 200k per employee
const SINGLE: TaxBracketInput = { ...B, filingStatus: "Single" };
const wages = (gross: number, preTaxFederal = 0, ficaWages = gross) => ({
  federalWages: gross - preTaxFederal,
  ficaWages,
});

describe("calculateHouseholdTax", () => {
  it("federal: one standard deduction on the combined income", () => {
    const r = calculateHouseholdTax({
      people: [wages(120_000, 10_000), wages(90_000, 5_000)],
      taxBrackets: B,
      medicareLiabilityThreshold: MFJ_LIABILITY,
    });
    expect(r.wageAgi).toBe(195_000);
    expect(r.taxableIncome).toBe(195_000 - B.standardDeduction);
    expect(r.federalTax).toBeCloseTo(
      sumBracketTax(195_000 - B.standardDeduction, B.brackets).total,
      2,
    );
    expect(r.effectiveRate).toBeCloseTo(r.federalTax / r.wageAgi, 10);
  });

  it("Social Security is capped per person, Medicare isn't", () => {
    const base = B.socialSecurityWageBase;
    const r = calculateHouseholdTax({
      people: [wages(base + 40_000), wages(60_000)],
      taxBrackets: B,
      medicareLiabilityThreshold: MFJ_LIABILITY,
    });
    expect(r.ficaSS).toBeCloseTo((base + 60_000) * B.socialSecurityRate, 2);
    expect(r.ficaMedicare).toBeCloseTo(
      (base + 100_000) * B.medicareRate + r.additionalMedicare,
      2,
    );
  });

  it("FICA is on FICA wages, not gross (Section 125, payroll HSA)", () => {
    const r = calculateHouseholdTax({
      people: [wages(100_000, 12_000, 92_000)],
      taxBrackets: B,
      medicareLiabilityThreshold: MFJ_LIABILITY,
    });
    expect(r.ficaSS).toBeCloseTo(92_000 * B.socialSecurityRate, 2);
    expect(r.ficaMedicare).toBeCloseTo(92_000 * B.medicareRate, 2);
  });

  it("MFJ, each spouse under the withholding threshold, together over the liability one: owed, and the warning says so", () => {
    const r = calculateHouseholdTax({
      people: [wages(150_000), wages(140_000)],
      taxBrackets: B,
      medicareLiabilityThreshold: MFJ_LIABILITY,
    });
    expect(r.additionalMedicare).toBeCloseTo(
      (290_000 - MFJ_LIABILITY) * B.medicareAdditionalRate,
      2,
    );
    expect(r.warnings.some((w) => w.includes("more is due"))).toBe(true);
  });

  it("MFJ, one spouse over the withholding threshold, household under the liability one: nothing owed, credit warning", () => {
    const r = calculateHouseholdTax({
      people: [wages(WITHHOLDING + 20_000), wages(10_000)],
      taxBrackets: B,
      medicareLiabilityThreshold: MFJ_LIABILITY,
    });
    expect(r.additionalMedicare).toBe(0);
    expect(r.warnings.some((w) => w.includes("credit"))).toBe(true);
  });

  it("MFJ under both thresholds: no Additional Medicare, no warning", () => {
    const r = calculateHouseholdTax({
      people: [wages(100_000), wages(100_000)],
      taxBrackets: B,
      medicareLiabilityThreshold: MFJ_LIABILITY,
    });
    expect(r.additionalMedicare).toBe(0);
    expect(r.warnings).toHaveLength(0);
  });

  it("Single over the threshold: owed and withheld match, no warning", () => {
    const r = calculateHouseholdTax({
      people: [wages(WITHHOLDING + 50_000)],
      taxBrackets: SINGLE,
      medicareLiabilityThreshold: WITHHOLDING,
    });
    expect(r.additionalMedicare).toBeCloseTo(
      50_000 * B.medicareAdditionalRate,
      2,
    );
    expect(r.warnings).toHaveLength(0);
  });

  it("missing liability row: uses the withholding threshold and says so", () => {
    const r = calculateHouseholdTax({
      people: [wages(150_000), wages(140_000)],
      taxBrackets: B,
      medicareLiabilityThreshold: null,
    });
    expect(r.additionalMedicare).toBeCloseTo(
      (290_000 - WITHHOLDING) * B.medicareAdditionalRate,
      2,
    );
    expect(
      r.warnings.some((w) => w.includes("no Additional Medicare liability")),
    ).toBe(true);
  });

  it("no income: all zero, no NaN", () => {
    const r = calculateHouseholdTax({
      people: [wages(0)],
      taxBrackets: B,
      medicareLiabilityThreshold: MFJ_LIABILITY,
    });
    expect(r.totalTax).toBe(0);
    expect(r.effectiveRate).toBe(0);
  });
});
