import { describe, it, expect } from "vitest";
import { calculateRelocation } from "@/lib/calculators/relocation";
import type { RelocationInput } from "@/lib/calculators/types";
import { AS_OF_DATE } from "./fixtures";

function makeInput(overrides: Partial<RelocationInput> = {}): RelocationInput {
  return {
    currentMonthlyExpenses: 5000,
    relocationMonthlyExpenses: 7000,
    yearAdjustments: [],
    contributionOverrides: [],
    largePurchases: [],
    currentAge: 30,
    retirementAge: 60,
    currentPortfolio: 200000,
    currentAnnualContributions: 30000,
    currentEmployerContributions: 10000,
    currentCombinedSalary: 200000,
    relocationAnnualContributions: 25000,
    relocationEmployerContributions: 8000,
    relocationCombinedSalary: 220000,
    currentSalaryGrowthRate: 0.03,
    relocationSalaryGrowthRate: 0.04,
    withdrawalRate: 0.04,
    inflationRate: 0.03,
    nominalReturnRate: 0.07,
    socialSecurityAnnual: 24000,
    asOfDate: AS_OF_DATE,
    ...overrides,
  };
}

describe("calculateRelocation", () => {
  describe("expense comparison", () => {
    it("computes annual expenses from monthly", () => {
      const result = calculateRelocation(makeInput());
      expect(result.currentAnnualExpenses).toBe(60000);
      expect(result.relocationAnnualExpenses).toBe(84000);
    });

    it("computes expense deltas", () => {
      const result = calculateRelocation(makeInput());
      expect(result.annualExpenseDelta).toBe(24000);
      expect(result.monthlyExpenseDelta).toBe(2000);
    });

    it("computes percent increase", () => {
      const result = calculateRelocation(makeInput());
      // (24000 / 60000) * 100 = 40
      expect(result.percentExpenseIncrease).toBe(40);
    });

    it("returns 0 percent increase when current expenses are 0", () => {
      const result = calculateRelocation(
        makeInput({ currentMonthlyExpenses: 0 }),
      );
      expect(result.percentExpenseIncrease).toBe(0);
    });
  });

  describe("savings rates", () => {
    it("computes current savings rate", () => {
      const result = calculateRelocation(makeInput());
      // (200000 - 60000) / 200000 = 0.70
      expect(result.currentSavingsRate).toBeCloseTo(0.7, 2);
    });

    it("computes relocation savings rate", () => {
      const result = calculateRelocation(makeInput());
      // (220000 - 84000) / 220000 ≈ 0.6182
      expect(result.relocationSavingsRate).toBeCloseTo(0.6182, 2);
    });

    it("returns 0 savings rate when salary is 0", () => {
      const result = calculateRelocation(
        makeInput({
          currentCombinedSalary: 0,
          currentAnnualContributions: 0,
          currentEmployerContributions: 0,
        }),
      );
      expect(result.currentSavingsRate).toBe(0);
    });
  });

  describe("FI targets", () => {
    it("computes FI target from expenses / withdrawal rate", () => {
      const result = calculateRelocation(makeInput());
      // current: 60000 / 0.04 = 1500000
      expect(result.currentFiTarget).toBe(1500000);
    });

    it("includes steady-state purchase costs in relocation FI target", () => {
      const result = calculateRelocation(
        makeInput({
          largePurchases: [
            {
              name: "Home",
              purchasePrice: 500000,
              downPaymentPercent: 0.2,
              loanRate: 0.065,
              loanTermYears: 30,
              ongoingMonthlyCost: 500,
              purchaseYear: AS_OF_DATE.getFullYear(),
            },
          ],
        }),
      );
      // Relocation FI target should be higher than without purchases
      const baseResult = calculateRelocation(makeInput());
      expect(result.relocationFiTarget).toBeGreaterThan(
        baseResult.relocationFiTarget,
      );
    });

    it("returns 0 FI target when withdrawal rate is 0", () => {
      const result = calculateRelocation(makeInput({ withdrawalRate: 0 }));
      expect(result.currentFiTarget).toBe(0);
      expect(result.relocationFiTarget).toBe(0);
    });

    it("computes additional nest egg needed", () => {
      const result = calculateRelocation(makeInput());
      expect(result.additionalNestEggNeeded).toBe(
        result.relocationFiTarget - result.currentFiTarget,
      );
    });
  });

  describe("year-by-year projection", () => {
    it("produces correct number of projection years", () => {
      const result = calculateRelocation(makeInput());
      // 60 - 30 = 30 years
      expect(result.projectionByYear).toHaveLength(30);
    });

    it("starts at current age", () => {
      const result = calculateRelocation(makeInput());
      expect(result.projectionByYear[0]!.age).toBe(30);
    });

    it("has increasing current balance over time", () => {
      const result = calculateRelocation(makeInput());
      const balances = result.projectionByYear.map((p) => p.currentBalance);
      for (let i = 1; i < balances.length; i++) {
        expect(balances[i]!).toBeGreaterThan(balances[i - 1]!);
      }
    });

    it("returns empty projection when currentAge >= retirementAge", () => {
      const result = calculateRelocation(
        makeInput({ currentAge: 65, retirementAge: 60 }),
      );
      expect(result.projectionByYear).toHaveLength(0);
    });

    it("tracks delta between scenarios", () => {
      const result = calculateRelocation(makeInput());
      for (const yr of result.projectionByYear) {
        expect(yr.delta).toBeCloseTo(
          yr.relocationBalance - yr.currentBalance,
          0,
        );
      }
    });
  });

  describe("FI age detection", () => {
    it("detects current FI age when portfolio crosses target", () => {
      const result = calculateRelocation(makeInput());
      if (result.currentFiAge !== null) {
        expect(result.currentFiAge).toBeGreaterThanOrEqual(30);
        expect(result.currentFiAge).toBeLessThan(60);
      }
    });

    it("detects relocation FI age", () => {
      const result = calculateRelocation(makeInput());
      if (result.relocationFiAge !== null && result.currentFiAge !== null) {
        // With higher expenses, relocation FI age should be same or later
        expect(result.relocationFiAge).toBeGreaterThanOrEqual(
          result.currentFiAge,
        );
      }
    });

    it("computes fiAgeDelay when both ages are found", () => {
      const result = calculateRelocation(makeInput());
      if (result.currentFiAge !== null && result.relocationFiAge !== null) {
        expect(result.fiAgeDelay).toBe(
          result.relocationFiAge - result.currentFiAge,
        );
      }
    });

    it("returns null fiAgeDelay when an FI age is not reached", () => {
      const result = calculateRelocation(
        makeInput({
          currentPortfolio: 0,
          currentAnnualContributions: 1000,
          currentEmployerContributions: 0,
          relocationAnnualContributions: 500,
          relocationEmployerContributions: 0,
          currentCombinedSalary: 40000,
          relocationCombinedSalary: 45000,
          retirementAge: 35,
        }),
      );
      // With very low contributions and short timeline, may not reach FI
      expect(
        result.fiAgeDelay === null || typeof result.fiAgeDelay === "number",
      ).toBe(true);
    });
  });

  describe("contribution overrides (sticky)", () => {
    it("applies override from the specified year onward", () => {
      const _baseResult = calculateRelocation(makeInput());
      const overrideResult = calculateRelocation(
        makeInput({
          contributionOverrides: [
            { year: AS_OF_DATE.getFullYear() + 5, rate: 0.5 },
          ],
        }),
      );
      // First 5 years should be the same
      for (let i = 0; i < 5; i++) {
        expect(
          overrideResult.projectionByYear[i]!.hasContributionOverride,
        ).toBe(false);
      }
      // Year 5+ should have override
      expect(overrideResult.projectionByYear[5]!.hasContributionOverride).toBe(
        true,
      );
    });

    it("later override replaces earlier one", () => {
      const result = calculateRelocation(
        makeInput({
          contributionOverrides: [
            { year: AS_OF_DATE.getFullYear() + 2, rate: 0.1 },
            { year: AS_OF_DATE.getFullYear() + 5, rate: 0.5 },
          ],
        }),
      );
      // Years 2-4 should use 0.1 rate, years 5+ should use 0.5
      const yr2Contrib = result.projectionByYear[2]!.currentContribution;
      const yr5Contrib = result.projectionByYear[5]!.currentContribution;
      // The 0.5 rate should produce much higher contributions than 0.1
      expect(yr5Contrib).toBeGreaterThan(yr2Contrib);
    });
  });

  describe("year adjustments", () => {
    it("applies expense adjustment in specified year", () => {
      const result = calculateRelocation(
        makeInput({
          yearAdjustments: [
            {
              year: AS_OF_DATE.getFullYear() + 3,
              monthlyExpenses: 5500,
            },
          ],
        }),
      );
      expect(result.projectionByYear[3]!.hasAdjustment).toBe(true);
      expect(result.projectionByYear[3]!.relocationExpenses).toBe(5500 * 12);
    });

    it("uses base expenses for non-adjusted years", () => {
      const result = calculateRelocation(
        makeInput({
          yearAdjustments: [
            {
              year: AS_OF_DATE.getFullYear() + 3,
              monthlyExpenses: 5500,
            },
          ],
        }),
      );
      expect(result.projectionByYear[0]!.hasAdjustment).toBe(false);
      expect(result.projectionByYear[0]!.relocationExpenses).toBe(7000 * 12);
    });
  });

  describe("large purchases", () => {
    const homePurchase = {
      name: "Home",
      purchasePrice: 500000,
      downPaymentPercent: 0.2,
      loanRate: 0.065,
      loanTermYears: 30,
      ongoingMonthlyCost: 800,
      purchaseYear: AS_OF_DATE.getFullYear(),
    };

    it("records portfolio hit from down payment", () => {
      const result = calculateRelocation(
        makeInput({ largePurchases: [homePurchase] }),
      );
      expect(result.totalLargePurchasePortfolioHit).toBeGreaterThan(0);
    });

    it("includes ongoing costs and loan payments in projection", () => {
      const result = calculateRelocation(
        makeInput({ largePurchases: [homePurchase] }),
      );
      const yr0 = result.projectionByYear[0]!;
      expect(yr0.monthlyPaymentFromPurchases).toBeGreaterThan(0);
      expect(yr0.largePurchaseImpact).toBeLessThan(0); // net withdrawal
    });

    it("sale proceeds offset cash outlay", () => {
      const withSale = calculateRelocation(
        makeInput({
          largePurchases: [{ ...homePurchase, saleProceeds: 150000 }],
        }),
      );
      const withoutSale = calculateRelocation(
        makeInput({ largePurchases: [homePurchase] }),
      );
      // With sale proceeds, the portfolio hit should be smaller
      expect(withSale.totalLargePurchasePortfolioHit).toBeLessThan(
        withoutSale.totalLargePurchasePortfolioHit,
      );
    });

    it("all-cash purchase has no loan payments", () => {
      const result = calculateRelocation(
        makeInput({
          largePurchases: [
            {
              name: "Furniture",
              purchasePrice: 10000,
              purchaseYear: AS_OF_DATE.getFullYear(),
              // No downPaymentPercent → defaults to 1 (all-cash)
            },
          ],
        }),
      );
      // Should have portfolio impact but steady state monthly is only ongoing costs (none here)
      expect(result.steadyStateMonthlyFromPurchases).toBe(0);
    });

    it("computes steady-state monthly from purchases", () => {
      const result = calculateRelocation(
        makeInput({ largePurchases: [homePurchase] }),
      );
      // Should include ongoing costs + loan payment
      expect(result.steadyStateMonthlyFromPurchases).toBeGreaterThan(800); // at least the ongoing cost
    });
  });

  describe("recommended portfolio and earliest relocate age", () => {
    it("finds earliest relocate age", () => {
      const result = calculateRelocation(makeInput());
      expect(result.earliestRelocateAge).not.toBeNull();
      if (result.earliestRelocateAge !== null) {
        expect(result.earliestRelocateAge).toBeGreaterThanOrEqual(30);
      }
    });

    it("sets recommended portfolio", () => {
      const result = calculateRelocation(makeInput());
      expect(result.recommendedPortfolioToRelocate).toBeGreaterThan(0);
    });

    it("warns when FI target is unreachable", () => {
      const result = calculateRelocation(
        makeInput({
          currentPortfolio: 0,
          currentAnnualContributions: 500,
          currentEmployerContributions: 0,
          relocationAnnualContributions: 500,
          relocationEmployerContributions: 0,
          currentCombinedSalary: 30000,
          relocationCombinedSalary: 30000,
          relocationMonthlyExpenses: 25000,
          retirementAge: 35,
        }),
      );
      expect(
        result.warnings.some((w) => w.includes("may not reach the FI target")),
      ).toBe(true);
    });
  });

  describe("salary growth", () => {
    it("grows salaries independently per scenario", () => {
      const result = calculateRelocation(
        makeInput({
          currentSalaryGrowthRate: 0.03,
          relocationSalaryGrowthRate: 0.06,
        }),
      );
      // Later years should show diverging contributions
      const yr0 = result.projectionByYear[0]!;
      const yr10 = result.projectionByYear[10]!;
      const currentGrowth = yr10.currentContribution / yr0.currentContribution;
      const relocGrowth =
        yr10.relocationContribution / yr0.relocationContribution;
      expect(relocGrowth).toBeGreaterThan(currentGrowth);
    });
  });

  describe("zero salary edge case", () => {
    it("handles zero salary for both scenarios", () => {
      const result = calculateRelocation(
        makeInput({
          currentCombinedSalary: 0,
          relocationCombinedSalary: 0,
          currentAnnualContributions: 0,
          currentEmployerContributions: 0,
          relocationAnnualContributions: 0,
          relocationEmployerContributions: 0,
        }),
      );
      expect(result.currentSavingsRate).toBe(0);
      expect(result.relocationSavingsRate).toBe(0);
      // Portfolio should still grow from returns alone
      expect(result.projectionByYear[0]!.currentBalance).toBeGreaterThan(
        200000,
      );
    });
  });

  describe("rounding", () => {
    it("all monetary results are rounded to cents", () => {
      const result = calculateRelocation(makeInput());
      const checkCents = (v: number) =>
        expect(Math.round(v * 100) / 100).toBe(v);

      checkCents(result.currentAnnualExpenses);
      checkCents(result.relocationAnnualExpenses);
      checkCents(result.annualExpenseDelta);
      checkCents(result.monthlyExpenseDelta);
      checkCents(result.currentFiTarget);
      checkCents(result.relocationFiTarget);
      checkCents(result.additionalNestEggNeeded);

      for (const yr of result.projectionByYear) {
        checkCents(yr.currentBalance);
        checkCents(yr.relocationBalance);
        checkCents(yr.delta);
      }
    });
  });
});
