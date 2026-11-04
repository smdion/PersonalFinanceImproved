/**
 * Distribution tax rates and deductions for the engine. The first block
 * uses invented figures; the answer-key block (tax/DTR-*) runs the shipped
 * 2026 limits for each filing status, so a status reading another's keys
 * fails (survivors m32, m36, m45 in the November tax verdicts).
 */
import { describe, it, expect } from "vitest";
import { buildDistributionTaxRates } from "@/lib/pure/distribution-tax-rates";
import {
  shippedTaxTables,
  taxDataLimitMap,
  taxDataWithholding,
} from "../helpers/tax-data";
import type { ReturnFilingStatus } from "@/lib/config/filing-status";

const settings = {
  distributionTaxRateTraditional: "0.2",
  distributionTaxRateBrokerage: "0.15",
  distributionTaxRateRoth: "0",
  distributionTaxRateHsa: null,
  taxMultiplier: "1",
  grossUpForTaxes: true,
  rothBracketTarget: "0.12",
  enableRothConversions: false,
  rothConversionTarget: null,
};
const limitsMap = {
  standard_deduction_mfj: 30000,
  additional_std_deduction_65_married: 1500,
  additional_std_deduction_65_unmarried: 2000,
  qcd_annual_limit: 100000,
};
const base = {
  settings,
  filingStatus: "MFJ" as const,
  limitsMap,
  bracketData: [],
  ltcgBracketData: {
    MFJ: [
      { threshold: 90000, rate: 0 },
      { threshold: 600000, rate: 0.15 },
      { threshold: null, rate: 0.2 },
    ],
  },
  irmaaBracketData: { MFJ: [{ magiThreshold: 200000, annualSurcharge: 1000 }] },
  fplByHousehold: { 1: 15000, 2: 20000 },
  latestTaxYear: 2026,
  taxParamsVersion: 1,
  accumulationExpenses: 80000,
  decumulationExpenses: 80000,
  annualExpensesVal: 80000,
};

describe("buildDistributionTaxRates", () => {
  it("uses the household's flat rates when no brackets are seeded", () => {
    const r = buildDistributionTaxRates(base);
    expect(r.traditionalFallbackRate).toBe(0.2);
    expect(r.brokerage).toBe(0.15);
    expect(r.hsa).toBe(0);
    expect(r.taxBrackets).toBeUndefined();
    expect(r.standardDeduction).toBe(30000);
    expect(r.additionalStdDeduction65PerSenior).toBe(1500);
    expect(r.taxDataYear).toBe(2026);
  });

  it("estimates the fallback rate from the year's brackets when seeded", () => {
    const r = buildDistributionTaxRates({
      ...base,
      bracketData: [
        { threshold: 20000, baseWithholding: 0, rate: 0.1 },
        { threshold: 90000, baseWithholding: 2000, rate: 0.12 },
        { threshold: Infinity, baseWithholding: 10400, rate: 0.22 },
      ],
    });
    expect(r.traditionalFallbackRate).toBeGreaterThan(0);
    expect(r.traditionalFallbackRate).toBeLessThan(0.12);
    expect(r.taxBrackets).toHaveLength(3);
  });

  it("an expired senior deduction degrades to none; a missing standard deduction fails loudly", () => {
    expect(
      buildDistributionTaxRates(base).obbbaSeniorDeductionPerPerson,
    ).toBeUndefined();
    expect(() => buildDistributionTaxRates({ ...base, limitsMap: {} })).toThrow(
      /standard_deduction_mfj/,
    );
  });
});

describe("answer key: buildDistributionTaxRates per status, shipped 2026 limits", () => {
  // Every 2026 limit as shipped (`tax-data/us-federal/2026.json`), keyed
  // as the payload builder's `limitsMap`.
  const limits2026 = Object.fromEntries(
    [...taxDataLimitMap()]
      .filter(([k]) => k.startsWith("2026:"))
      .map(([k, v]) => [k.slice("2026:".length), v]),
  );
  const tables = shippedTaxTables(2026);
  const run = (filingStatus: ReturnFilingStatus) =>
    buildDistributionTaxRates({
      ...base,
      filingStatus,
      limitsMap: limits2026,
      bracketData: taxDataWithholding().find(
        (t) =>
          t.taxYear === 2026 &&
          t.filingStatus === filingStatus &&
          !t.w4Checkbox,
      )!.brackets,
      ltcgBracketData: tables.ltcgBrackets,
      irmaaBracketData: tables.irmaaBrackets,
      fplByHousehold: tables.fplByHousehold,
    });

  // Standard deduction: RP25 § 4.14(1) (16,100 / 32,200 / 24,150). Age
  // add-on per person 65+: RP25 § 4.14(3), 2,050 unmarried (Single, HOH),
  // 1,650 married (IRC 63(f)). Senior-deduction phase-out start: IRC
  // 151(d)(5)(C)(iii)(I), 150,000 on a joint return, 75,000 otherwise
  // (spec § 4.2, § 4.4).
  it("tax/DTR-S [TAX-25] Single: std 16,100, add-on 2,050, senior start 75,000", () => {
    const r = run("Single");
    expect(r.standardDeduction).toBe(16_100);
    expect(r.additionalStdDeduction65PerSenior).toBe(2_050);
    expect(r.obbbaSeniorPhaseoutStart).toBe(75_000);
  });

  it("tax/DTR-MFJ [TAX-25] MFJ: std 32,200, add-on 1,650, senior start 150,000", () => {
    const r = run("MFJ");
    expect(r.standardDeduction).toBe(32_200);
    expect(r.additionalStdDeduction65PerSenior).toBe(1_650);
    expect(r.obbbaSeniorPhaseoutStart).toBe(150_000);
  });

  it("tax/DTR-HOH [TAX-25] HOH: std 24,150, add-on 2,050, senior start 75,000", () => {
    const r = run("HOH");
    expect(r.standardDeduction).toBe(24_150);
    expect(r.additionalStdDeduction65PerSenior).toBe(2_050);
    expect(r.obbbaSeniorPhaseoutStart).toBe(75_000);
  });
});
