/**
 * Edge case tests for all calculators.
 *
 * Covers: zero income, single income, no contributions, empty portfolio,
 * no savings goals, boundary dates (Jan 1, Dec 31), future tax year with
 * no limits data, negative values, and extreme inputs.
 */
import { describe, it, expect } from "vitest";
import { calculatePaycheck } from "@/lib/calculators/paycheck";
import { calculateTax } from "@/lib/calculators/tax";
import { calculateBudget } from "@/lib/calculators/budget";
import { calculateContributions } from "@/lib/calculators/contribution";
import { calculateMortgage } from "@/lib/calculators/mortgage";
import { calculateNetWorth } from "@/lib/calculators/net-worth";
import { calculateSavings } from "@/lib/calculators/savings";
import {
  MFJ_2C_BRACKETS,
  MFJ_NO_CHECKBOX_BRACKETS,
} from "../calculators/fixtures";
import type {
  PaycheckInput,
  TaxInput,
  NetWorthInput,
} from "@/lib/calculators/types";

const JAN_1 = new Date("2025-01-01");
const DEC_31 = new Date("2025-12-31");

// ── Paycheck edge cases ──

describe("paycheck edge cases", () => {
  const basePaycheck: PaycheckInput = {
    annualSalary: 0,
    payPeriod: "biweekly",
    payWeek: "even",
    anchorPayDate: new Date("2025-01-03"),
    supplementalTaxRate: 0.22,
    contributionAccounts: [],
    deductions: [],
    taxBrackets: MFJ_2C_BRACKETS,
    limits: {},
    ytdGrossEarnings: 0,
    bonusPercent: 0,
    bonusMultiplier: 1.0,
    bonusOverride: null,
    monthsInBonusYear: 12,
    includeContribInBonus: false,
    bonusMonth: null,
    bonusDayOfMonth: null,
    asOfDate: JAN_1,
  };

  it("handles zero salary", () => {
    const result = calculatePaycheck(basePaycheck);
    expect(result.gross).toBe(0);
    expect(result.netPay).toBe(0);
    expect(result.federalWithholding).toBe(0);
    expect(result.ficaSS).toBe(0);
    expect(result.ficaMedicare).toBe(0);
    expect(result.yearSchedule).toHaveLength(26);
    expect(result.yearSchedule[0]!.netPay).toBe(0);
  });

  it("handles very high salary (above SS wage base)", () => {
    const result = calculatePaycheck({ ...basePaycheck, annualSalary: 500000 });
    expect(result.gross).toBeGreaterThan(0);
    // SS should still compute for the first period
    expect(result.ficaSS).toBeGreaterThan(0);
    // Later periods in year schedule should have $0 SS
    const lastPeriod = result.yearSchedule[result.yearSchedule.length - 1]!;
    expect(lastPeriod.ficaSS).toBe(0);
  });

  it("handles weekly pay period", () => {
    const result = calculatePaycheck({
      ...basePaycheck,
      annualSalary: 52000,
      payPeriod: "weekly",
    });
    expect(result.periodsPerYear).toBe(52);
    expect(result.gross).toBe(1000);
    expect(result.yearSchedule).toHaveLength(52);
  });

  it("handles monthly pay period", () => {
    const result = calculatePaycheck({
      ...basePaycheck,
      annualSalary: 120000,
      payPeriod: "monthly",
    });
    expect(result.periodsPerYear).toBe(12);
    expect(result.gross).toBe(10000);
    expect(result.yearSchedule).toHaveLength(12);
  });

  it("handles semimonthly pay period", () => {
    const result = calculatePaycheck({
      ...basePaycheck,
      annualSalary: 120000,
      payPeriod: "semimonthly",
    });
    expect(result.periodsPerYear).toBe(24);
    expect(result.gross).toBe(5000);
  });

  it("returns no extra paycheck months for non-biweekly", () => {
    const result = calculatePaycheck({
      ...basePaycheck,
      annualSalary: 100000,
      payPeriod: "monthly",
    });
    expect(result.extraPaycheckMonths).toEqual([]);
  });

  it("handles YTD earnings past SS wage base", () => {
    const result = calculatePaycheck({
      ...basePaycheck,
      annualSalary: 200000,
      ytdGrossEarnings: 180000, // already past $176,100
    });
    expect(result.ficaSS).toBe(0);
    expect(result.warnings).toContainEqual(
      expect.stringContaining("SS wage base exceeded"),
    );
  });

  it("handles zero bonus percent", () => {
    const result = calculatePaycheck({
      ...basePaycheck,
      annualSalary: 100000,
      bonusPercent: 0,
    });
    expect(result.bonusEstimate.bonusGross).toBe(0);
    expect(result.bonusEstimate.bonusNet).toBe(0);
  });

  it("handles partial bonus year (monthsInBonusYear < 12)", () => {
    const result = calculatePaycheck({
      ...basePaycheck,
      annualSalary: 100000,
      bonusPercent: 0.1,
      monthsInBonusYear: 6,
    });
    // Bonus prorated: $100k × 10% × (6/12) = $5,000
    expect(result.bonusEstimate.bonusGross).toBe(5000);
  });

  it("handles boundary date Jan 1", () => {
    const result = calculatePaycheck({
      ...basePaycheck,
      annualSalary: 100000,
      asOfDate: JAN_1,
    });
    expect(result.periodsElapsedYtd).toBe(0);
  });

  it("handles boundary date Dec 31", () => {
    const result = calculatePaycheck({
      ...basePaycheck,
      annualSalary: 100000,
      asOfDate: DEC_31,
    });
    // Year schedule should still be 26 periods
    expect(result.yearSchedule).toHaveLength(26);
  });

  it("handles deductions exceeding gross (unlikely but safe)", () => {
    const result = calculatePaycheck({
      ...basePaycheck,
      annualSalary: 26000, // $1000/period
      deductions: [
        {
          name: "Huge",
          amount: 1500,
          taxTreatment: "pre_tax",
          ficaExempt: false,
        },
      ],
    });
    // Net pay goes negative — calculator doesn't clamp, just reports
    expect(result.netPay).toBeLessThan(0);
  });
});

// ── Tax edge cases ──

describe("tax edge cases", () => {
  const baseTax: TaxInput = {
    annualGross: 0,
    preTaxDeductionsAnnual: 0,
    filingStatus: "MFJ",
    taxBrackets: MFJ_NO_CHECKBOX_BRACKETS,
    w4CheckboxOverride: null,
    asOfDate: JAN_1,
  };

  it("handles zero income", () => {
    const result = calculateTax(baseTax);
    expect(result.taxableIncome).toBe(0);
    expect(result.federalTax).toBe(0);
    expect(result.totalTax).toBe(0);
    expect(result.effectiveRate).toBe(0);
    expect(result.marginalRate).toBe(0);
  });

  it("handles income below standard deduction", () => {
    const result = calculateTax({ ...baseTax, annualGross: 20000 });
    // AGI $20k - standard deduction $30k = $0 taxable
    expect(result.taxableIncome).toBe(0);
    expect(result.federalTax).toBe(0);
    // But FICA still applies
    expect(result.ficaSS).toBeGreaterThan(0);
    expect(result.ficaMedicare).toBeGreaterThan(0);
  });

  it("handles single income (one earner)", () => {
    const result = calculateTax({ ...baseTax, annualGross: 118885.79 });
    // Taxable = $118,885.79 - $30,000 = $88,885.79 → falls in 12% bracket (44100-120100)
    expect(result.taxableIncome).toBeCloseTo(88885.79, 0);
    expect(result.marginalRate).toBe(0.12);
  });

  it("handles very high income (top bracket)", () => {
    const result = calculateTax({ ...baseTax, annualGross: 1000000 });
    expect(result.marginalRate).toBe(0.37);
    // Additional Medicare Tax should apply
    expect(result.ficaMedicare).toBeGreaterThan(1000000 * 0.0145);
  });

  it("handles pre-tax deductions exceeding gross", () => {
    const result = calculateTax({
      ...baseTax,
      annualGross: 50000,
      preTaxDeductionsAnnual: 60000,
    });
    // AGI = -10000, but taxable income is floored at 0
    expect(result.taxableIncome).toBe(0);
    expect(result.federalTax).toBe(0);
  });

  it("handles income exactly at SS wage base", () => {
    const result = calculateTax({ ...baseTax, annualGross: 176100 });
    expect(result.ficaSS).toBeCloseTo(176100 * 0.062, 0);
  });

  it("handles income exactly at Medicare additional threshold", () => {
    const result = calculateTax({ ...baseTax, annualGross: 200000 });
    // No additional Medicare tax (threshold is $200k, not exceeded)
    expect(result.ficaMedicare).toBeCloseTo(200000 * 0.0145, 0);
  });
});

// ── Budget edge cases ──

describe("budget edge cases", () => {
  it("handles no items", () => {
    const result = calculateBudget({
      items: [],
      columnLabels: ["Standard"],
      selectedColumn: 0,
      asOfDate: JAN_1,
    });
    expect(result.totalMonthly).toBe(0);
    expect(result.categories).toHaveLength(0);
  });

  it("handles all-zero amounts", () => {
    const result = calculateBudget({
      items: [
        {
          category: "Test",
          label: "Item",
          amounts: [0, 0, 0],
          isEssential: true,
        },
      ],
      columnLabels: ["A", "B", "C"],
      selectedColumn: 0,
      asOfDate: JAN_1,
    });
    expect(result.totalMonthly).toBe(0);
    expect(result.essentialTotal).toBe(0);
    expect(result.discretionaryTotal).toBe(0);
  });

  it("handles selectedColumn out of range (uses 0 fallback)", () => {
    const result = calculateBudget({
      items: [
        { category: "Test", label: "Item", amounts: [100], isEssential: true },
      ],
      columnLabels: ["Standard"],
      selectedColumn: 5, // out of range
      asOfDate: JAN_1,
    });
    // amounts[5] is undefined → falls back to 0
    expect(result.totalMonthly).toBe(0);
  });

  it("handles all essential items (zero discretionary)", () => {
    const result = calculateBudget({
      items: [
        { category: "A", label: "X", amounts: [100], isEssential: true },
        { category: "B", label: "Y", amounts: [200], isEssential: true },
      ],
      columnLabels: ["Standard"],
      selectedColumn: 0,
      asOfDate: JAN_1,
    });
    expect(result.essentialTotal).toBe(300);
    expect(result.discretionaryTotal).toBe(0);
  });

  it("handles all discretionary items (zero essential)", () => {
    const result = calculateBudget({
      items: [
        { category: "Fun", label: "Games", amounts: [50], isEssential: false },
      ],
      columnLabels: ["Standard"],
      selectedColumn: 0,
      asOfDate: JAN_1,
    });
    expect(result.essentialTotal).toBe(0);
    expect(result.discretionaryTotal).toBe(50);
  });
});

// ── Contribution edge cases ──

describe("contribution edge cases", () => {
  it("handles no contribution accounts", () => {
    const result = calculateContributions({
      annualSalary: 100000,
      contributionAccounts: [],
      limits: {},
      asOfDate: JAN_1,
    });
    expect(result.totalAnnualContributions).toBe(0);
    expect(result.accounts).toHaveLength(0);
    expect(result.groupRates).toEqual({ total: 0 });
  });

  it("handles zero salary with contributions", () => {
    const result = calculateContributions({
      annualSalary: 0,
      contributionAccounts: [
        {
          name: "IRA",
          annualContribution: 7000,
          perPeriodContribution: 269.23,
          taxTreatment: "tax_free",
          isPayrollDeducted: false,
          group: "retirement",
          employerMatch: 0,
          employerMatchTaxTreatment: "pre_tax",
        },
      ],
      limits: {},
      asOfDate: JAN_1,
    });
    expect(result.totalAnnualContributions).toBe(7000);
    // Rate is infinity-safe via safeDivide
    expect(result.groupRates["retirement"]).toBe(0);
    expect(result.accounts[0]!.percentOfSalary).toBe(0);
  });

  it("handles single account with employer match", () => {
    const result = calculateContributions({
      annualSalary: 100000,
      contributionAccounts: [
        {
          name: "401k",
          annualContribution: 10000,
          perPeriodContribution: 384.62,
          taxTreatment: "pre_tax",
          isPayrollDeducted: true,
          group: "retirement",
          employerMatch: 5000,
          employerMatchTaxTreatment: "pre_tax",
        },
      ],
      limits: {},
      asOfDate: JAN_1,
    });
    expect(result.totalAnnualContributions).toBe(15000);
    expect(result.groupRates["retirement"]).toBeCloseTo(0.15, 2);
  });
});

// ── Mortgage edge cases ──

describe("mortgage edge cases", () => {
  it("handles no loans", () => {
    const result = calculateMortgage({
      loans: [],
      extraPayments: [],
      whatIfScenarios: [],
      asOfDate: JAN_1,
    });
    expect(result.loans).toHaveLength(0);
    expect(result.loanHistory).toHaveLength(0);
    expect(result.whatIfResults).toHaveLength(0);
  });

  it("handles already paid off loan (very short term)", () => {
    const result = calculateMortgage({
      loans: [
        {
          id: 1,
          name: "Short Loan",
          originalBalance: 10000,
          interestRate: 0.05,
          termMonths: 12,
          startDate: new Date("2024-01-01"),
          monthlyPI: 856.07,
          isActive: true,
        },
      ],
      extraPayments: [],
      whatIfScenarios: [],
      asOfDate: DEC_31,
    });
    const loan = result.loans[0]!;
    expect(loan.amortizationSchedule.length).toBe(12);
    // May have tiny rounding remainder — check near-zero
    expect(loan.amortizationSchedule[11]!.balance).toBeLessThan(0.1);
  });

  it("handles zero interest rate loan", () => {
    const result = calculateMortgage({
      loans: [
        {
          id: 1,
          name: "0% Loan",
          originalBalance: 12000,
          interestRate: 0,
          termMonths: 12,
          startDate: new Date("2025-01-01"),
          monthlyPI: 1000,
          isActive: true,
        },
      ],
      extraPayments: [],
      whatIfScenarios: [],
      asOfDate: JAN_1,
    });
    const loan = result.loans[0]!;
    // Every payment should be 100% principal, 0 interest
    for (const entry of loan.amortizationSchedule) {
      expect(entry.interest).toBe(0);
    }
    expect(loan.totalInterestLife).toBe(0);
  });

  it("handles all inactive loans (nothing to amortize)", () => {
    const result = calculateMortgage({
      loans: [
        {
          id: 1,
          name: "Old Loan",
          originalBalance: 100000,
          interestRate: 0.05,
          termMonths: 360,
          startDate: new Date("2010-01-01"),
          monthlyPI: 536.82,
          isActive: false,
        },
      ],
      extraPayments: [],
      whatIfScenarios: [],
      asOfDate: JAN_1,
    });
    expect(result.loans).toHaveLength(0);
    expect(result.loanHistory).toHaveLength(1);
    expect(result.loanHistory[0]!.isActive).toBe(false);
  });
});

// ── Net Worth edge cases ──

describe("net worth edge cases", () => {
  const baseNW: NetWorthInput = {
    portfolioTotal: 0,
    cash: 0,
    homeValueEstimated: 0,
    homeValueConservative: 0,
    otherAssets: 0,
    mortgageBalance: 0,
    otherLiabilities: 0,
    annualSalary: 0,
    annualExpenses: 0,
    withdrawalRate: 0.04,
    age: 25,
    yearsWorking: 0,
    asOfDate: JAN_1,
  };

  it("handles zero everything", () => {
    const result = calculateNetWorth(baseNW);
    expect(result.netWorth).toBe(0);
    expect(result.wealthScore).toBe(0);
    expect(result.fiProgress).toBe(0);
  });

  it("handles negative net worth (liabilities exceed assets)", () => {
    const result = calculateNetWorth({
      ...baseNW,
      mortgageBalance: 50000,
      annualSalary: 50000,
      age: 25,
    });
    expect(result.netWorth).toBe(-50000);
    expect(result.wealthScore).toBeLessThan(0);
  });

  it("handles very young age (under 25)", () => {
    const result = calculateNetWorth({
      ...baseNW,
      age: 22,
      annualSalary: 40000,
      portfolioTotal: 5000,
    });
    // (22 × 40000) / (10 + 18) × 2 = 62857.14
    expect(result.wealthTarget).toBeCloseTo(62857, 0);
    expect(result.netWorth).toBe(5000);
  });

  it("handles zero withdrawal rate", () => {
    const result = calculateNetWorth({
      ...baseNW,
      annualExpenses: 50000,
      withdrawalRate: 0,
    });
    // FI target = 50000 / 0 → safeDivide returns 0
    expect(result.fiTarget).toBe(0);
    expect(result.fiProgress).toBe(0);
  });

  it("handles empty portfolio (only home equity)", () => {
    const result = calculateNetWorth({
      ...baseNW,
      homeValueEstimated: 300000,
      homeValueConservative: 300000,
      mortgageBalance: 200000,
      annualSalary: 100000,
      age: 35,
    });
    expect(result.netWorth).toBe(100000);
  });
});

// ── Savings edge cases ──

describe("savings edge cases", () => {
  it("handles no goals", () => {
    const result = calculateSavings({
      goals: [],
      monthlySavingsPool: 1000,
      essentialMonthlyExpenses: 5000,
      asOfDate: JAN_1,
    });
    expect(result.totalSaved).toBe(0);
    expect(result.efundMonthsCovered).toBeNull();
    expect(result.goals).toHaveLength(0);
  });

  it("handles zero savings pool", () => {
    const result = calculateSavings({
      goals: [
        {
          id: 1,
          name: "Goal",
          currentBalance: 1000,
          targetBalance: 5000,
          allocationPercent: 1.0,
          isEmergencyFund: false,
          isActive: true,
        },
      ],
      monthlySavingsPool: 0,
      essentialMonthlyExpenses: 5000,
      asOfDate: JAN_1,
    });
    expect(result.goals[0]!.monthlyAllocation).toBe(0);
    expect(result.goals[0]!.monthsToTarget).toBeNull();
  });

  it("handles zero essential expenses (efund coverage)", () => {
    const result = calculateSavings({
      goals: [
        {
          id: 1,
          name: "E-Fund",
          currentBalance: 10000,
          targetBalance: 20000,
          allocationPercent: 1.0,
          isEmergencyFund: true,
          isActive: true,
        },
      ],
      monthlySavingsPool: 500,
      essentialMonthlyExpenses: 0,
      asOfDate: JAN_1,
    });
    // safeDivide(10000, 0) = 0
    expect(result.efundMonthsCovered).toBe(0);
  });

  it("handles goal already exceeded target", () => {
    const result = calculateSavings({
      goals: [
        {
          id: 1,
          name: "Done",
          currentBalance: 30000,
          targetBalance: 25000,
          allocationPercent: 1.0,
          isEmergencyFund: false,
          isActive: true,
        },
      ],
      monthlySavingsPool: 500,
      essentialMonthlyExpenses: 5000,
      asOfDate: JAN_1,
    });
    expect(result.goals[0]!.monthsToTarget).toBe(0);
    expect(result.goals[0]!.progress).toBeGreaterThan(1.0);
  });

  it("handles all inactive goals", () => {
    const result = calculateSavings({
      goals: [
        {
          id: 1,
          name: "Paused",
          currentBalance: 5000,
          targetBalance: 10000,
          allocationPercent: 1.0,
          isEmergencyFund: false,
          isActive: false,
        },
      ],
      monthlySavingsPool: 500,
      essentialMonthlyExpenses: 5000,
      asOfDate: JAN_1,
    });
    expect(result.goals).toHaveLength(0);
    expect(result.totalSaved).toBe(0);
  });
});

// ── Retirement / projection edge cases ──

import { calculateProjection } from "@/lib/calculators/engine/projection";
import type { ProjectionInput } from "@/lib/calculators/types";

const EMPTY_ACCOUNT_BALANCES = {
  "401k": { structure: "roth_traditional" as const, traditional: 0, roth: 0 },
  "403b": { structure: "roth_traditional" as const, traditional: 0, roth: 0 },
  hsa: { structure: "single_bucket" as const, balance: 0 },
  ira: { structure: "roth_traditional" as const, traditional: 0, roth: 0 },
  brokerage: { structure: "basis_tracking" as const, balance: 0, basis: 0 },
};

const ZERO_LIMITS = { "401k": 0, "403b": 0, hsa: 0, ira: 0, brokerage: 0 };
const ZERO_MATCH = { "401k": 0, "403b": 0, hsa: 0, ira: 0, brokerage: 0 };

const DEFAULT_DECUMULATION = {
  withdrawalRate: 0.04,
  withdrawalRoutingMode: "waterfall" as const,
  withdrawalOrder: [
    "401k" as const,
    "403b" as const,
    "ira" as const,
    "brokerage" as const,
    "hsa" as const,
  ],
  withdrawalSplits: {
    "401k": 0.35,
    "403b": 0,
    ira: 0.25,
    brokerage: 0.3,
    hsa: 0.1,
  },
  withdrawalTaxPreference: {
    "401k": "traditional" as const,
    ira: "traditional" as const,
  },
  distributionTaxRates: {
    traditionalFallbackRate: 0.22,
    roth: 0,
    hsa: 0,
    brokerage: 0.15,
  },
};

function makeBaseProjection(
  overrides: Partial<ProjectionInput> = {},
): ProjectionInput {
  return {
    accumulationDefaults: {
      contributionRate: 0,
      routingMode: "waterfall",
      accountOrder: ["401k", "403b", "hsa", "ira", "brokerage"],
      accountSplits: { "401k": 0, "403b": 0, hsa: 0, ira: 0, brokerage: 1 },
      taxSplits: {},
    },
    decumulationDefaults: {
      ...DEFAULT_DECUMULATION,
      distributionTaxRates: {
        traditionalFallbackRate: 0,
        roth: 0,
        hsa: 0,
        brokerage: 0,
      },
    },
    accumulationOverrides: [],
    decumulationOverrides: [],
    currentAge: 35,
    retirementAge: 65,
    projectionEndAge: 90,
    currentSalary: 0,
    salaryGrowthRate: 0,
    salaryCap: null,
    salaryOverrides: [],
    budgetOverrides: [],
    baseLimits: ZERO_LIMITS,
    limitGrowthRate: 0,
    employerMatchRateByCategory: ZERO_MATCH,
    startingBalances: {
      preTax: 0,
      taxFree: 0,
      hsa: 0,
      afterTax: 0,
      afterTaxBasis: 0,
    },
    startingAccountBalances: { ...EMPTY_ACCOUNT_BALANCES },
    annualExpenses: 0,
    inflationRate: 0,
    returnRates: [{ label: "7%", rate: 0.07 }],
    socialSecurityAnnual: 0,
    ssStartAge: 67,
    asOfDate: JAN_1,
    ...overrides,
  };
}

describe("retirement projection edge cases", () => {
  it("handles zero balances, zero salary, zero expenses", () => {
    const result = calculateProjection(makeBaseProjection());
    expect(result.projectionByYear).toHaveLength(55); // 90 - 35
    // No money in, no money out — all end balances should be zero
    for (const year of result.projectionByYear) {
      expect(year.endBalance).toBeCloseTo(0, 2);
    }
    // With zero balance and zero expenses, depletion may or may not trigger
    // (engine may flag $0 as depleted) — just verify it doesn't crash
  });

  it("handles currentAge === retirementAge (already retired)", () => {
    const result = calculateProjection(
      makeBaseProjection({
        currentAge: 65,
        retirementAge: 65,
        projectionEndAge: 90,
        startingBalances: {
          preTax: 0,
          taxFree: 0,
          hsa: 0,
          afterTax: 1_000_000,
          afterTaxBasis: 1_000_000,
        },
        startingAccountBalances: {
          ...EMPTY_ACCOUNT_BALANCES,
          brokerage: {
            structure: "basis_tracking",
            balance: 1_000_000,
            basis: 1_000_000,
          },
        },
        annualExpenses: 40_000,
        inflationRate: 0,
      }),
    );
    // Should have no accumulation years — all decumulation
    expect(result.projectionByYear).toHaveLength(25);
    expect(result.projectionByYear[0]!.phase).toBe("decumulation");
    // With 7% return, 4% withdrawal on $1M, portfolio should survive
    expect(result.portfolioDepletionYear).toBeNull();
  });

  it("handles currentAge > retirementAge (past retirement)", () => {
    const result = calculateProjection(
      makeBaseProjection({
        currentAge: 70,
        retirementAge: 65,
        projectionEndAge: 90,
        startingBalances: {
          preTax: 0,
          taxFree: 0,
          hsa: 0,
          afterTax: 500_000,
          afterTaxBasis: 500_000,
        },
        startingAccountBalances: {
          ...EMPTY_ACCOUNT_BALANCES,
          brokerage: {
            structure: "basis_tracking",
            balance: 500_000,
            basis: 500_000,
          },
        },
        annualExpenses: 40_000,
        inflationRate: 0,
      }),
    );
    expect(result.projectionByYear).toHaveLength(20);
    // All years should be decumulation
    for (const year of result.projectionByYear) {
      expect(year.phase).toBe("decumulation");
    }
  });

  it("handles projectionEndAge === currentAge (zero-year projection)", () => {
    const result = calculateProjection(
      makeBaseProjection({
        currentAge: 65,
        retirementAge: 65,
        projectionEndAge: 65,
      }),
    );
    expect(result.projectionByYear).toHaveLength(0);
    expect(result.portfolioDepletionYear).toBeNull();
  });

  it("detects portfolio depletion with high withdrawal rate", () => {
    const result = calculateProjection(
      makeBaseProjection({
        currentAge: 65,
        retirementAge: 65,
        projectionEndAge: 95,
        startingBalances: {
          preTax: 0,
          taxFree: 0,
          hsa: 0,
          afterTax: 500_000,
          afterTaxBasis: 500_000,
        },
        startingAccountBalances: {
          ...EMPTY_ACCOUNT_BALANCES,
          brokerage: {
            structure: "basis_tracking",
            balance: 500_000,
            basis: 500_000,
          },
        },
        annualExpenses: 100_000, // 20% withdrawal — unsustainable
        inflationRate: 0.03,
      }),
    );
    expect(result.portfolioDepletionYear).not.toBeNull();
    expect(result.portfolioDepletionAge).not.toBeNull();
    expect(result.portfolioDepletionAge!).toBeLessThan(95);
  });

  it("throws with empty returnRates array", () => {
    expect(() =>
      calculateProjection(
        makeBaseProjection({
          currentAge: 65,
          retirementAge: 65,
          projectionEndAge: 75,
          startingBalances: {
            preTax: 0,
            taxFree: 0,
            hsa: 0,
            afterTax: 100_000,
            afterTaxBasis: 100_000,
          },
          startingAccountBalances: {
            ...EMPTY_ACCOUNT_BALANCES,
            brokerage: {
              structure: "basis_tracking",
              balance: 100_000,
              basis: 100_000,
            },
          },
          annualExpenses: 0,
          returnRates: [],
        }),
      ),
    ).toThrow("No return rate configured");
  });

  it("clamps extreme inflation rate and warns", () => {
    const result = calculateProjection(
      makeBaseProjection({ inflationRate: 5.0 }),
    );
    expect(
      result.warnings.some((w) => w.includes("Inflation rate clamped")),
    ).toBe(true);
  });

  it("clamps extreme negative salary growth and warns", () => {
    const result = calculateProjection(
      makeBaseProjection({
        currentSalary: 100_000,
        salaryGrowthRate: -2.0,
      }),
    );
    expect(
      result.warnings.some((w) => w.includes("Salary growth rate clamped")),
    ).toBe(true);
  });

  it("handles social security kicking in at ssStartAge", () => {
    const result = calculateProjection(
      makeBaseProjection({
        currentAge: 65,
        retirementAge: 65,
        projectionEndAge: 75,
        startingBalances: {
          preTax: 0,
          taxFree: 0,
          hsa: 0,
          afterTax: 500_000,
          afterTaxBasis: 500_000,
        },
        startingAccountBalances: {
          ...EMPTY_ACCOUNT_BALANCES,
          brokerage: {
            structure: "basis_tracking",
            balance: 500_000,
            basis: 500_000,
          },
        },
        annualExpenses: 40_000,
        socialSecurityAnnual: 24_000,
        ssStartAge: 67,
        inflationRate: 0,
      }),
    );
    // Before SS age (65-66): full withdrawal from portfolio
    // After SS age (67+): SS offsets expenses → smaller portfolio draw
    const beforeSS = result.projectionByYear[0]!; // age 65
    const afterSS = result.projectionByYear[2]!; // age 67
    expect(afterSS.phase).toBe("decumulation");
    // After SS kicks in, the portfolio should be drawn down less
    if (afterSS.phase === "decumulation" && beforeSS.phase === "decumulation") {
      expect(afterSS.totalWithdrawal).toBeLessThan(beforeSS.totalWithdrawal);
    }
  });

  it("handles salary cap binding during accumulation", () => {
    const result = calculateProjection(
      makeBaseProjection({
        currentAge: 35,
        retirementAge: 65,
        projectionEndAge: 70,
        currentSalary: 200_000,
        salaryGrowthRate: 0.05,
        salaryCap: 250_000,
      }),
    );
    // Salary should never exceed cap in any accumulation year
    for (const year of result.projectionByYear) {
      if (year.phase === "accumulation") {
        expect(year.projectedSalary).toBeLessThanOrEqual(250_000 + 0.01);
      }
    }
  });

  it("handles first-year pro-rating for mid-year accumulation start", () => {
    const midYear = new Date(2025, 6, 1); // July 1 (month is 0-indexed)
    const janStart = new Date(2025, 0, 1); // Jan 1
    const accInput = {
      currentAge: 35,
      retirementAge: 65,
      projectionEndAge: 70,
      currentSalary: 100_000,
      accumulationDefaults: {
        contributionRate: 0.1,
        routingMode: "waterfall" as const,
        accountOrder: [
          "401k" as const,
          "403b" as const,
          "hsa" as const,
          "ira" as const,
          "brokerage" as const,
        ],
        accountSplits: {
          "401k": 0,
          "403b": 0,
          hsa: 0,
          ira: 0,
          brokerage: 1,
        },
        taxSplits: {},
      },
    };
    const resultMid = calculateProjection(
      makeBaseProjection({ ...accInput, asOfDate: midYear }),
    );
    const resultJan = calculateProjection(
      makeBaseProjection({ ...accInput, asOfDate: janStart }),
    );
    // First year of mid-year start should have pro-rated contributions
    const midFirst = resultMid.projectionByYear[0]!;
    const janFirst = resultJan.projectionByYear[0]!;
    if (
      midFirst.phase === "accumulation" &&
      janFirst.phase === "accumulation"
    ) {
      // Jul 1 → getMonth()=6, monthsRemaining=6, fraction=6/12=0.5
      expect(midFirst.proRateFraction).toBeCloseTo(6 / 12, 2);
      // Jan start has full year (fraction=1, proRateFraction=null)
      expect(janFirst.proRateFraction).toBeNull();
      // Mid-year contributes less than full year
      expect(midFirst.totalEmployee).toBeLessThanOrEqual(
        janFirst.totalEmployee,
      );
    }
  });

  it("handles percentage withdrawal mode without splits (warns)", () => {
    const result = calculateProjection(
      makeBaseProjection({
        currentAge: 65,
        retirementAge: 65,
        projectionEndAge: 70,
        decumulationDefaults: {
          ...DEFAULT_DECUMULATION,
          withdrawalRoutingMode: "percentage",
          withdrawalSplits: undefined as never,
          distributionTaxRates: {
            traditionalFallbackRate: 0,
            roth: 0,
            hsa: 0,
            brokerage: 0,
          },
        },
      }),
    );
    expect(
      result.warnings.some((w) => w.includes("Percentage withdrawal mode")),
    ).toBe(true);
  });

  it("handles budget override crossing retirement boundary", () => {
    const retYear = JAN_1.getFullYear() + 30; // retirement year
    const result = calculateProjection(
      makeBaseProjection({
        currentAge: 35,
        retirementAge: 65,
        projectionEndAge: 70,
        currentSalary: 100_000,
        annualExpenses: 50_000,
        inflationRate: 0,
        budgetOverrides: [{ year: retYear, value: 3000 }], // $3000/month = $36000/year
        startingBalances: {
          preTax: 0,
          taxFree: 0,
          hsa: 0,
          afterTax: 1_000_000,
          afterTaxBasis: 1_000_000,
        },
        startingAccountBalances: {
          ...EMPTY_ACCOUNT_BALANCES,
          brokerage: {
            structure: "basis_tracking",
            balance: 1_000_000,
            basis: 1_000_000,
          },
        },
      }),
    );
    // The retirement year should use the override expenses
    const retYearProjection = result.projectionByYear[30]!;
    expect(retYearProjection.phase).toBe("decumulation");
    if (retYearProjection.phase === "decumulation") {
      // Budget override sets monthly to $3000, engine converts to annual ($36000)
      // Withdrawal should reflect this override, not the default $50k
      expect(retYearProjection.projectedExpenses).toBeCloseTo(36_000, 0);
    }
  });

  it("handles pure compound growth with no contributions or withdrawals", () => {
    const result = calculateProjection(
      makeBaseProjection({
        currentAge: 35,
        retirementAge: 90, // never retire during projection
        projectionEndAge: 45,
        startingBalances: {
          preTax: 0,
          taxFree: 0,
          hsa: 0,
          afterTax: 100_000,
          afterTaxBasis: 100_000,
        },
        startingAccountBalances: {
          ...EMPTY_ACCOUNT_BALANCES,
          brokerage: {
            structure: "basis_tracking",
            balance: 100_000,
            basis: 100_000,
          },
        },
        annualExpenses: 0,
        inflationRate: 0,
        returnRates: [{ label: "7%", rate: 0.07 }],
      }),
    );
    // With no contributions/withdrawals, balance should grow each year
    const firstYear = result.projectionByYear[0]!;
    const lastYear = result.projectionByYear[9]!;
    expect(lastYear.endBalance).toBeGreaterThan(firstYear.endBalance);
    // Should be roughly in the right ballpark (compound growth)
    expect(lastYear.endBalance).toBeGreaterThan(150_000);
    expect(lastYear.endBalance).toBeLessThan(250_000);
  });

  it("handles salary override (sticky-forward)", () => {
    const overrideYear = JAN_1.getFullYear() + 5;
    const result = calculateProjection(
      makeBaseProjection({
        currentAge: 35,
        retirementAge: 65,
        projectionEndAge: 70,
        currentSalary: 100_000,
        salaryGrowthRate: 0.03,
        salaryOverrides: [{ year: overrideYear, value: 200_000 }],
      }),
    );
    // Year 5 salary should be the override value
    const year5 = result.projectionByYear[5]!;
    if (year5.phase === "accumulation") {
      expect(year5.projectedSalary).toBeCloseTo(200_000, 0);
    }
  });
});
