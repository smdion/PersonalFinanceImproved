/**
 * Accumulation Sanity Tests
 *
 * Validates the deterministic projection engine against hand-calculable
 * financial formulas: compound growth, future value of annuity, salary
 * growth, expense inflation, and simple depletion.
 */
import { describe, it, expect } from "vitest";
import { calculateProjection } from "@/lib/calculators/engine";
import { makePureGrowthInput, makeStandardInput } from "./benchmark-helpers";

describe("Accumulation sanity — deterministic math", () => {
  describe("Rule of 72 / compound growth", () => {
    it("$100k at 7% for 10 years ≈ $196,715", () => {
      const input = makePureGrowthInput({
        currentAge: 35,
        retirementAge: 45,
        projectionEndAge: 45,
        returnRates: [{ label: "7%", rate: 0.07 }],
        startingBalances: {
          preTax: 0,
          taxFree: 0,
          hsa: 0,
          afterTax: 100000,
          afterTaxBasis: 100000,
        },
      });
      const result = calculateProjection(input);
      const lastYear =
        result.projectionByYear[result.projectionByYear.length - 1];
      const expected = 100000 * Math.pow(1.07, 10);

      // ±5% tolerance (engine may pro-rate first year based on asOfDate)
      expect(lastYear!.endBalance).toBeGreaterThan(expected * 0.95);
      expect(lastYear!.endBalance).toBeLessThan(expected * 1.05);
    });

    it("$100k at 10% for ~7.2 years doubles (Rule of 72)", () => {
      const input = makePureGrowthInput({
        currentAge: 35,
        retirementAge: 42,
        projectionEndAge: 42,
        returnRates: [{ label: "10%", rate: 0.1 }],
      });
      const result = calculateProjection(input);
      const lastYear =
        result.projectionByYear[result.projectionByYear.length - 1];

      // Should approximately double in ~7 years
      expect(lastYear!.endBalance).toBeGreaterThan(180000);
      expect(lastYear!.endBalance).toBeLessThan(220000);
    });
  });

  describe("Salary growth", () => {
    it("$150k at 3%/yr for 30 years → ~$364k", () => {
      const input = makeStandardInput({
        currentAge: 35,
        retirementAge: 65,
        projectionEndAge: 65,
      });
      const result = calculateProjection(input);
      const expected = 150000 * Math.pow(1.03, 30);

      // Find last accumulation year
      const accYears = result.projectionByYear.filter(
        (y) => y.phase === "accumulation",
      );
      const lastAccYear = accYears[accYears.length - 1];

      // ±3% tolerance (engine computes salary at year start)
      expect(lastAccYear!.projectedSalary).toBeGreaterThan(expected * 0.97);
      expect(lastAccYear!.projectedSalary).toBeLessThan(expected * 1.03);
    });
  });

  describe("Expense inflation", () => {
    it("$72k at 2.5%/yr for 30 years → ~$151k", () => {
      const input = makeStandardInput({
        currentAge: 35,
        retirementAge: 65,
        projectionEndAge: 90,
      });
      const result = calculateProjection(input);
      const expected = 72000 * Math.pow(1.025, 30);

      // Find first decumulation year
      const decYear = result.projectionByYear.find(
        (y) => y.phase === "decumulation",
      );

      // ±5% tolerance
      expect(decYear!.projectedExpenses).toBeGreaterThan(expected * 0.95);
      expect(decYear!.projectedExpenses).toBeLessThan(expected * 1.05);
    });
  });

  describe("Simple depletion (zero growth)", () => {
    it("$1M with $40k/yr withdrawal at 0% return depletes in ~25 years", () => {
      const input = makePureGrowthInput({
        currentAge: 65,
        retirementAge: 65,
        projectionEndAge: 95,
        returnRates: [{ label: "0%", rate: 0 }],
        startingBalances: {
          preTax: 0,
          taxFree: 0,
          hsa: 0,
          afterTax: 1000000,
          afterTaxBasis: 1000000,
        },
        startingAccountBalances: {
          "401k": { structure: "roth_traditional", traditional: 0, roth: 0 },
          "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
          hsa: { structure: "single_bucket", balance: 0 },
          ira: { structure: "roth_traditional", traditional: 0, roth: 0 },
          brokerage: {
            structure: "basis_tracking",
            balance: 1000000,
            basis: 1000000,
          },
        },
        annualExpenses: 40000,
        inflationRate: 0,
        socialSecurityAnnual: 0,
        ssStartAge: 99,
      });
      const result = calculateProjection(input);

      // $1M / $40k = 25 years → depletion at age 90
      expect(result.portfolioDepletionAge).not.toBeNull();
      expect(result.portfolioDepletionAge).toBeGreaterThanOrEqual(88);
      expect(result.portfolioDepletionAge).toBeLessThanOrEqual(92);
    });
  });

  describe("Accumulation with contributions (FV of annuity sanity)", () => {
    it("standard fixture accumulates to reasonable range at retirement", () => {
      const input = makeStandardInput();
      const result = calculateProjection(input);

      // Find retirement year balance
      const retYear = result.projectionByYear.find(
        (y) => y.phase === "decumulation",
      );

      // Starting $195k + ~$37k/yr contributions at ~7% for 30 years
      // Conservative: should be at least $1.5M
      // Generous: shouldn't exceed $8M
      expect(retYear!.endBalance).toBeGreaterThan(1_500_000);
      expect(retYear!.endBalance).toBeLessThan(8_000_000);
    });

    it("higher salary with higher contributions produces larger balance", () => {
      const lowSalary = makeStandardInput({ currentSalary: 100000 });
      const highSalary = makeStandardInput({ currentSalary: 200000 });

      const lowResult = calculateProjection(lowSalary);
      const highResult = calculateProjection(highSalary);

      const lowRet = lowResult.projectionByYear.find(
        (y) => y.phase === "decumulation",
      );
      const highRet = highResult.projectionByYear.find(
        (y) => y.phase === "decumulation",
      );

      expect(highRet!.endBalance).toBeGreaterThan(lowRet!.endBalance);
    });
  });

  describe("Social Security timing", () => {
    it("SS income is zero before ssStartAge and non-zero after", () => {
      const input = makeStandardInput({
        socialSecurityAnnual: 36000,
        ssStartAge: 67,
      });
      const result = calculateProjection(input);

      const beforeSS = result.projectionByYear.find(
        (y) => y.phase === "decumulation" && y.age === 66,
      );
      const afterSS = result.projectionByYear.find(
        (y) => y.phase === "decumulation" && y.age === 67,
      );

      if (beforeSS && beforeSS.phase === "decumulation") {
        expect(beforeSS.ssIncome).toBe(0);
      }
      if (afterSS && afterSS.phase === "decumulation") {
        expect(afterSS.ssIncome).toBeGreaterThan(0);
      }
    });
  });

  describe("Return rate sensitivity", () => {
    it("higher return rate produces higher terminal balance", () => {
      const low = makePureGrowthInput({
        returnRates: [{ label: "4%", rate: 0.04 }],
      });
      const high = makePureGrowthInput({
        returnRates: [{ label: "10%", rate: 0.1 }],
      });

      const lowResult = calculateProjection(low);
      const highResult = calculateProjection(high);

      const lowEnd =
        lowResult.projectionByYear[lowResult.projectionByYear.length - 1]!
          .endBalance;
      const highEnd =
        highResult.projectionByYear[highResult.projectionByYear.length - 1]!
          .endBalance;

      expect(highEnd).toBeGreaterThan(lowEnd);
    });
  });
});
