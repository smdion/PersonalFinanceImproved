/**
 * The IRMAA lookback's record (`irmaa-lookback.ts`) and a working year's
 * income (`working-year-wages.ts`): which tax year a premium year reads.
 * Self-derived; the engine's figures are answer-keyed in
 * `tests/config/answer-key-irmaa.test.ts` (ret/I30:engine).
 */
import { describe, expect, it } from "vitest";
import {
  irmaaLookbackYear,
  recordIrmaaTaxYear,
  type IrmaaTaxYears,
} from "@/lib/pure/engine/projection-year-handlers/irmaa-lookback";
import {
  fullYearWages,
  payrollTaxSkipped,
  workingYearIncome,
} from "@/lib/pure/engine/projection-year-handlers/working-year-wages";
import { getAllCategories } from "@/lib/config/account-types";
import type { AccumulationSlot } from "@/lib/pure/engine/types/routing";
import type { YearIncome } from "@/lib/pure/tax/year-income";

const slot = (
  category: AccumulationSlot["category"],
  employeeContrib: number,
  rothContrib = 0,
): AccumulationSlot =>
  ({
    category,
    employeeContrib,
    rothContrib,
    traditionalContrib: employeeContrib - rothContrib,
  }) as AccumulationSlot;

const cuts = (given: Partial<Record<AccumulationSlot["category"], number>>) =>
  Object.fromEntries(
    getAllCategories().map((c) => [c, given[c] ?? 0]),
  ) as Record<AccumulationSlot["category"], number>;

const retiredIncome = (traditionalDraws: number): YearIncome => ({
  wages: 0,
  traditionalDraws,
  rothConversions: 0,
  rothTaxableGrowth: 0,
  realizedGains: 0,
  socialSecurity: { gross: 0, taxable: 0 },
});

describe("fullYearWages", () => {
  // 401(k) 15,000 of which 5,000 Roth, HSA 4,000, IRA 6,000, brokerage
  // 3,000: income tax skips the 401(k)'s Traditional 10,000 and the HSA's
  // 4,000; the IRA isn't a payroll account and the brokerage is after tax.
  const slots = [
    slot("401k", 15_000, 5_000),
    slot("hsa", 4_000),
    slot("ira", 6_000),
    slot("brokerage", 3_000),
  ];
  const noCut = cuts({});

  it("a working year's wages are its pay less its pre-tax and HSA payroll money", () => {
    expect(fullYearWages(100_000, slots, 1, noCut)).toBe(86_000);
    expect(payrollTaxSkipped(slots)).toBe(14_000);
  });

  it("year 0's part-year contributions count at a full year's rate", () => {
    // Half the year left: the slots hold half a year's contributions.
    const half = slots.map((s) =>
      slot(s.category, s.employeeContrib / 2, s.rothContrib / 2),
    );
    expect(fullYearWages(100_000, half, 0.5, noCut)).toBe(86_000);
  });

  it("a percent-of-pay row over the IRS limit counts the limit, not twice what's left", () => {
    // Limit 23,500, configured 30,000, half the year left: 15,000 is paid
    // already, so 8,500 is left; the year's cut is 11,750 − 8,500 = 3,250
    // (yearZeroBasis). The year's pre-tax money is 23,500: wages 76,500
    // (grossing up the slot alone would say 17,000 and 83,000).
    const over = [slot("401k", 8_500)];
    expect(fullYearWages(100_000, over, 0.5, cuts({ "401k": 3_250 }))).toBe(
      76_500,
    );
  });

  it("a job's leftThisYear counts the year's whole contribution", () => {
    // 20,000 a year, 2,000 left this year with half the year to go: the
    // cut is 10,000 − 2,000 = 8,000, and the year's pre-tax money 20,000.
    const ending = [slot("401k", 2_000)];
    expect(fullYearWages(100_000, ending, 0.5, cuts({ "401k": 8_000 }))).toBe(
      80_000,
    );
  });

  it("the Roth part of a cut isn't skipped money", () => {
    // Half Roth: 4,000 in the slot (2,000 Traditional), cut 6,000: the
    // year's 20,000 holds 10,000 Traditional.
    const split = [slot("401k", 4_000, 2_000)];
    expect(fullYearWages(100_000, split, 0.5, cuts({ "401k": 6_000 }))).toBe(
      90_000,
    );
  });

  it("is recorded as a worked tax year whose MAGI is its wages", () => {
    const years: IrmaaTaxYears = new Map();
    const wages = fullYearWages(100_000, slots, 1, noCut);
    recordIrmaaTaxYear(years, 2026, workingYearIncome(wages));
    expect(years.get(2026)).toEqual({
      year: 2026,
      magi: 86_000,
      rothConversion: 0,
      worked: true,
    });
  });

  it("a gap year's record adds the draw and the year's taxable Social Security", () => {
    const years: IrmaaTaxYears = new Map();
    const income = workingYearIncome(200_000, {
      traditionalDraws: 10_000,
      rothTaxableGrowth: 0,
      realizedGains: 1_000,
      socialSecurity: { gross: 40_000, taxable: 34_000 },
    });
    expect(recordIrmaaTaxYear(years, 2026, income).magi).toBe(245_000);
  });
});

describe("irmaaLookbackYear", () => {
  const worked = (pay: number) => workingYearIncome(pay);

  it("reads the tax year two before the premium year", () => {
    const years: IrmaaTaxYears = new Map();
    recordIrmaaTaxYear(years, 2026, worked(300_000));
    recordIrmaaTaxYear(years, 2027, worked(310_000));
    expect(irmaaLookbackYear(years, 2028, 2026)?.magi).toBe(300_000);
    expect(irmaaLookbackYear(years, 2029, 2026)?.magi).toBe(310_000);
  });

  it("a year before a working plan's first reads that first year", () => {
    const years: IrmaaTaxYears = new Map();
    recordIrmaaTaxYear(years, 2026, worked(300_000));
    expect(irmaaLookbackYear(years, 2027, 2026)?.year).toBe(2026);
    expect(irmaaLookbackYear(years, 2026, 2026)?.year).toBe(2026);
  });

  it("reads the plan's start year as given, not the first year recorded", () => {
    const years: IrmaaTaxYears = new Map();
    recordIrmaaTaxYear(years, 2027, worked(310_000));
    recordIrmaaTaxYear(years, 2026, worked(300_000));
    expect(irmaaLookbackYear(years, 2027, 2026)?.magi).toBe(300_000);
  });

  it("a plan that starts retired knows no earlier year", () => {
    const years: IrmaaTaxYears = new Map();
    recordIrmaaTaxYear(years, 2026, retiredIncome(150_000));
    expect(years.get(2026)?.worked).toBe(false);
    expect(irmaaLookbackYear(years, 2027, 2026)).toBeUndefined();
    expect(irmaaLookbackYear(years, 2028, 2026)?.magi).toBe(150_000);
  });
});
