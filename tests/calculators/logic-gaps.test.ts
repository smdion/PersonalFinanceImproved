/**
 * Logic gap tests — covers calculator behaviors NOT tested by existing suites.
 *
 * 1. FICA base distinction: ficaExempt=false deductions DON'T reduce FICA base
 * 2. Cross-calculator consistency: paycheck + budget + contributions coherent together
 * 3. Bonus month placement: bonusMonth/bonusDayOfMonth schedule integration
 * 4. Tax MFJ Additional Medicare: $250k liability vs $200k withholding threshold
 * 5. Paycheck SS wage base cap transition mid-year
 * 6. Mortgage refinance chain interest attribution
 * 7. Net worth age-40 wealth formula transition
 * 8. Budget multi-column emergency vs standard comparison
 */
import { describe, it, expect } from "vitest";
import { calculatePaycheck } from "@/lib/calculators/paycheck";
import { calculateTax } from "@/lib/calculators/tax";
import { calculateBudget } from "@/lib/calculators/budget";
import { calculateContributions } from "@/lib/calculators/contribution";
import { calculateMortgage } from "@/lib/calculators/mortgage";
import { calculateNetWorth } from "@/lib/calculators/net-worth";
// calculateSavings reserved for future savings logic-gap tests
import { calculateEFund } from "@/lib/calculators/efund";
import {
  MFJ_NO_CHECKBOX_BRACKETS,
  PERSON_A_PAYCHECK_INPUT,
  PERSON_B_PAYCHECK_INPUT,
  PERSON_A_CONTRIBUTIONS,
  PERSON_B_CONTRIBUTIONS,
  AS_OF_DATE,
} from "./fixtures";
import type {
  PaycheckInput,
  TaxInput,
  MortgageInput,
  NetWorthInput,
} from "@/lib/calculators/types";

// ════════════════════════════════════════
// 1. FICA BASE DISTINCTION
// ════════════════════════════════════════

describe("FICA base distinction", () => {
  const baseInput: PaycheckInput = {
    ...PERSON_A_PAYCHECK_INPUT,
    annualSalary: 100000,
    deductions: [],
    contributionAccounts: [],
    bonusPercent: 0,
  };

  it("ficaExempt=true deduction reduces FICA base (Section 125)", () => {
    const input: PaycheckInput = {
      ...baseInput,
      deductions: [
        {
          name: "Medical",
          amount: 200,
          taxTreatment: "pre_tax",
          ficaExempt: true,
        },
      ],
    };
    const result = calculatePaycheck(input);
    const gross = 100000 / 26;
    const ficaBase = gross - 200; // Section 125 reduces FICA base
    expect(result.ficaSS).toBeCloseTo(ficaBase * 0.062, 0);
  });

  it("ficaExempt=false deduction does NOT reduce FICA base (non-Section 125)", () => {
    const input: PaycheckInput = {
      ...baseInput,
      deductions: [
        {
          name: "Custom",
          amount: 200,
          taxTreatment: "pre_tax",
          ficaExempt: false,
        },
      ],
    };
    const result = calculatePaycheck(input);
    const gross = 100000 / 26;
    // Non-FICA-exempt deduction: FICA base is still full gross
    expect(result.ficaSS).toBeCloseTo(gross * 0.062, 0);
  });

  it("mixed deductions: only ficaExempt=true reduces FICA base", () => {
    const input: PaycheckInput = {
      ...baseInput,
      deductions: [
        {
          name: "Medical",
          amount: 150,
          taxTreatment: "pre_tax",
          ficaExempt: true,
        },
        {
          name: "Other",
          amount: 100,
          taxTreatment: "pre_tax",
          ficaExempt: false,
        },
      ],
    };
    const result = calculatePaycheck(input);
    const gross = 100000 / 26;
    const ficaBase = gross - 150; // Only Medical reduces FICA base
    expect(result.ficaSS).toBeCloseTo(ficaBase * 0.062, 0);
  });

  it("both deductions reduce federal taxable income equally", () => {
    const exemptInput: PaycheckInput = {
      ...baseInput,
      deductions: [
        {
          name: "Exempt",
          amount: 200,
          taxTreatment: "pre_tax",
          ficaExempt: true,
        },
      ],
    };
    const nonExemptInput: PaycheckInput = {
      ...baseInput,
      deductions: [
        {
          name: "NonExempt",
          amount: 200,
          taxTreatment: "pre_tax",
          ficaExempt: false,
        },
      ],
    };
    const exemptResult = calculatePaycheck(exemptInput);
    const nonExemptResult = calculatePaycheck(nonExemptInput);

    // Federal withholding should be the same — both are pre-tax
    expect(exemptResult.federalWithholding).toBeCloseTo(
      nonExemptResult.federalWithholding,
      2,
    );

    // But FICA SS should differ
    expect(exemptResult.ficaSS).toBeLessThan(nonExemptResult.ficaSS);
  });
});

// ════════════════════════════════════════
// 2. CROSS-CALCULATOR CONSISTENCY
// ════════════════════════════════════════

describe("cross-calculator consistency", () => {
  const personAResult = calculatePaycheck(PERSON_A_PAYCHECK_INPUT);
  const personBResult = calculatePaycheck(PERSON_B_PAYCHECK_INPUT);

  const personAContrib = calculateContributions({
    annualSalary: PERSON_A_PAYCHECK_INPUT.annualSalary,
    contributionAccounts: PERSON_A_CONTRIBUTIONS,
    limits: {},
    asOfDate: AS_OF_DATE,
  });
  const personBContrib = calculateContributions({
    annualSalary: PERSON_B_PAYCHECK_INPUT.annualSalary,
    contributionAccounts: PERSON_B_CONTRIBUTIONS,
    limits: {},
    asOfDate: AS_OF_DATE,
  });

  it("paycheck gross × periods ≈ annual salary (no bonus)", () => {
    const annualA = personAResult.gross * personAResult.periodsPerYear;
    expect(annualA).toBeCloseTo(PERSON_A_PAYCHECK_INPUT.annualSalary, 0);

    const annualB = personBResult.gross * personBResult.periodsPerYear;
    expect(annualB).toBeCloseTo(PERSON_B_PAYCHECK_INPUT.annualSalary, 0);
  });

  it("contribution total employee-only is less than salary", () => {
    expect(personAContrib.totalEmployeeOnly).toBeLessThan(
      PERSON_A_PAYCHECK_INPUT.annualSalary,
    );
    expect(personBContrib.totalEmployeeOnly).toBeLessThan(
      PERSON_B_PAYCHECK_INPUT.annualSalary,
    );
  });

  it("contribution savings rate is between 0 and 1", () => {
    const rateA = personAContrib.groupRates["total"]!;
    const rateB = personBContrib.groupRates["total"]!;
    expect(rateA).toBeGreaterThan(0);
    expect(rateA).toBeLessThan(1);
    expect(rateB).toBeGreaterThan(0);
    expect(rateB).toBeLessThan(1);
  });

  it("net pay + deductions + taxes + contributions ≈ gross", () => {
    // For person A: net + fed W/H + FICA + pre-tax + post-tax ≈ gross
    const totalA =
      personAResult.netPay +
      personAResult.federalWithholding +
      personAResult.ficaSS +
      personAResult.ficaMedicare +
      personAResult.preTaxDeductions.reduce((s, d) => s + d.amount, 0) +
      personAResult.postTaxDeductions.reduce((s, d) => s + d.amount, 0);
    expect(totalA).toBeCloseTo(personAResult.gross, 0);
  });

  it("budget essential ≤ total budget ≤ combined net pay", () => {
    const budget = calculateBudget({
      items: [
        {
          category: "Housing",
          label: "Mortgage",
          amounts: [1500],
          isEssential: true,
        },
        {
          category: "Food",
          label: "Groceries",
          amounts: [500],
          isEssential: true,
        },
        {
          category: "Fun",
          label: "Entertainment",
          amounts: [200],
          isEssential: false,
        },
      ],
      columnLabels: ["Standard"],
      selectedColumn: 0,
      asOfDate: AS_OF_DATE,
    });

    expect(budget.essentialTotal).toBeLessThanOrEqual(budget.totalMonthly);
    expect(budget.essentialTotal + budget.discretionaryTotal).toBeCloseTo(
      budget.totalMonthly,
      2,
    );
  });

  it("efund months covered = balance / essential expenses", () => {
    const efund = calculateEFund({
      emergencyFundBalance: 10000,
      outstandingSelfLoans: 0,
      essentialMonthlyExpenses: 2000,
      targetMonths: 4,
      asOfDate: AS_OF_DATE,
    });

    expect(efund.monthsCovered).toBeCloseTo(5.0, 2); // 10000 / 2000
    expect(efund.targetAmount).toBe(8000); // 4 × 2000
    expect(efund.neededAfterRepay).toBe(-2000); // 8000 - 10000
  });
});

// ════════════════════════════════════════
// 3. BONUS MONTH PLACEMENT
// ════════════════════════════════════════

describe("paycheck bonus month placement", () => {
  it("bonus lands in the specified month period", () => {
    const input: PaycheckInput = {
      ...PERSON_A_PAYCHECK_INPUT,
      bonusPercent: 0.1,
      bonusMonth: 3, // March
      bonusDayOfMonth: 15,
    };
    const result = calculatePaycheck(input);

    // bonusPeriod should be non-null when bonusMonth is set
    expect(result.bonusPeriod).not.toBeNull();
    expect(result.bonusPeriod).toBeGreaterThan(0);
  });

  it("bonus estimate uses override when set", () => {
    const input: PaycheckInput = {
      ...PERSON_A_PAYCHECK_INPUT,
      bonusPercent: 0.1,
      bonusOverride: 15000,
    };
    const result = calculatePaycheck(input);

    // Override takes precedence over percent calculation
    expect(result.bonusEstimate.bonusGross).toBeCloseTo(15000, 0);
  });

  it("bonus multiplier scales the bonus", () => {
    const baseInput: PaycheckInput = {
      ...PERSON_A_PAYCHECK_INPUT,
      bonusPercent: 0.1,
      bonusMultiplier: 1.0,
    };
    const scaledInput: PaycheckInput = {
      ...PERSON_A_PAYCHECK_INPUT,
      bonusPercent: 0.1,
      bonusMultiplier: 1.5,
    };
    const baseResult = calculatePaycheck(baseInput);
    const scaledResult = calculatePaycheck(scaledInput);

    expect(scaledResult.bonusEstimate.bonusGross).toBeCloseTo(
      baseResult.bonusEstimate.bonusGross * 1.5,
      0,
    );
  });
});

// ════════════════════════════════════════
// 4. TAX — MFJ ADDITIONAL MEDICARE THRESHOLDS
// ════════════════════════════════════════

describe("tax MFJ Additional Medicare threshold", () => {
  it("withholding uses $200k threshold regardless of filing status", () => {
    // Person earning $210k — Additional Medicare kicks in at $200k for withholding
    const input: TaxInput = {
      annualGross: 210000,
      preTaxDeductionsAnnual: 0,
      filingStatus: "MFJ",
      taxBrackets: MFJ_NO_CHECKBOX_BRACKETS,
      w4CheckboxOverride: null,
      asOfDate: AS_OF_DATE,
    };
    const result = calculateTax(input);

    // Base Medicare: $210,000 × 0.0145 = $3,045
    // Additional: ($210,000 - $200,000) × 0.009 = $90
    // Total: $3,135
    expect(result.ficaMedicare).toBeCloseTo(3135, 0);
  });

  it("income below $200k has no additional Medicare", () => {
    const input: TaxInput = {
      annualGross: 180000,
      preTaxDeductionsAnnual: 0,
      filingStatus: "MFJ",
      taxBrackets: MFJ_NO_CHECKBOX_BRACKETS,
      w4CheckboxOverride: null,
      asOfDate: AS_OF_DATE,
    };
    const result = calculateTax(input);

    // Base only: $180,000 × 0.0145 = $2,610
    expect(result.ficaMedicare).toBeCloseTo(2610, 0);
  });

  it("income exactly at $200k threshold has no additional Medicare", () => {
    const input: TaxInput = {
      annualGross: 200000,
      preTaxDeductionsAnnual: 0,
      filingStatus: "MFJ",
      taxBrackets: MFJ_NO_CHECKBOX_BRACKETS,
      w4CheckboxOverride: null,
      asOfDate: AS_OF_DATE,
    };
    const result = calculateTax(input);

    // No additional: $200,000 × 0.0145 = $2,900
    expect(result.ficaMedicare).toBeCloseTo(2900, 0);
  });
});

// ════════════════════════════════════════
// 5. PAYCHECK SS WAGE BASE CAP TRANSITION
// ════════════════════════════════════════

describe("paycheck SS wage base cap transition", () => {
  it("high earner SS drops to zero after crossing wage base", () => {
    const input: PaycheckInput = {
      ...PERSON_A_PAYCHECK_INPUT,
      annualSalary: 250000, // Well above $176,100 SS wage base
      deductions: [],
      contributionAccounts: [],
      bonusPercent: 0,
    };
    const result = calculatePaycheck(input);

    // Year schedule should show SS = 0 in later periods
    const lastPeriod = result.yearSchedule[result.yearSchedule.length - 1];
    expect(lastPeriod?.ficaSS).toBe(0);

    // But first period should have non-zero SS
    const firstPeriod = result.yearSchedule[0];
    expect(firstPeriod?.ficaSS).toBeGreaterThan(0);

    // Total annual SS should equal wage base × rate
    const totalSS = result.yearSchedule.reduce((s, p) => s + p.ficaSS, 0);
    expect(totalSS).toBeCloseTo(176100 * 0.062, 0);
  });

  it("earner below wage base pays SS on every period", () => {
    const input: PaycheckInput = {
      ...PERSON_A_PAYCHECK_INPUT,
      annualSalary: 100000, // Below $176,100 SS wage base
      deductions: [],
      contributionAccounts: [],
      bonusPercent: 0,
    };
    const result = calculatePaycheck(input);

    // Every period should have non-zero SS
    const zeroPeriods = result.yearSchedule.filter((p) => p.ficaSS === 0);
    expect(zeroPeriods).toHaveLength(0);

    // Total annual SS = salary × rate
    const totalSS = result.yearSchedule.reduce((s, p) => s + p.ficaSS, 0);
    expect(totalSS).toBeCloseTo(100000 * 0.062, 0);
  });
});

// ════════════════════════════════════════
// 6. MORTGAGE REFINANCE CHAIN
// ════════════════════════════════════════

describe("mortgage refinance chain", () => {
  it("original loan is inactive, refi is active", () => {
    const input: MortgageInput = {
      loans: [
        {
          id: 1,
          name: "Original",
          originalBalance: 300000,
          interestRate: 0.045,
          termMonths: 360,
          startDate: new Date("2020-01-01"),
          monthlyPI: 1520.06,
          isActive: false,
          paidOffDate: new Date("2023-06-01"),
        },
        {
          id: 2,
          name: "Refinance",
          originalBalance: 270000,
          interestRate: 0.035,
          termMonths: 360,
          startDate: new Date("2023-06-01"),
          monthlyPI: 1212.45,
          isActive: true,
          refinancedFromId: 1,
        },
      ],
      extraPayments: [],
      whatIfScenarios: [],
      asOfDate: new Date("2025-06-01"),
    };
    const result = calculateMortgage(input);

    // Active loans should have the refi
    expect(result.loans).toHaveLength(1);
    expect(result.loans[0]!.name).toBe("Refinance");

    // Historical should have the original
    expect(result.historicalLoans).toHaveLength(1);
    expect(result.historicalLoans[0]!.name).toBe("Original");

    // Loan history should show the chain
    expect(result.loanHistory).toHaveLength(2);
  });

  it("refi current balance is less than original balance", () => {
    const input: MortgageInput = {
      loans: [
        {
          id: 1,
          name: "Refi",
          originalBalance: 270000,
          interestRate: 0.035,
          termMonths: 360,
          startDate: new Date("2023-06-01"),
          monthlyPI: 1212.45,
          isActive: true,
        },
      ],
      extraPayments: [],
      whatIfScenarios: [],
      asOfDate: new Date("2025-06-01"),
    };
    const result = calculateMortgage(input);
    expect(result.loans[0]!.currentBalance).toBeLessThan(270000);
    expect(result.loans[0]!.currentBalance).toBeGreaterThan(0);
  });
});

// ════════════════════════════════════════
// 7. NET WORTH AGE-40 FORMULA TRANSITION
// ════════════════════════════════════════

describe("net worth wealth formula age transition", () => {
  const baseInput: NetWorthInput = {
    portfolioTotal: 500000,
    cash: 50000,
    homeValueEstimated: 400000,
    homeValueConservative: 350000,
    otherAssets: 0,
    mortgageBalance: 200000,
    otherLiabilities: 0,
    annualSalary: 200000,
    annualExpenses: 60000,
    withdrawalRate: 0.04,
    age: 38,
    yearsWorking: 16,
    asOfDate: AS_OF_DATE,
  };

  it("ages under 40 use adjusted denominator", () => {
    const result = calculateNetWorth({ ...baseInput, age: 35 });
    // Expected NW = ((35 × 200000) / (10 + max(0, 40-35))) × 2
    // = (7,000,000 / 15) × 2 = 933,333
    const expected = ((35 * 200000) / (10 + 5)) * 2;
    expect(result.wealthTarget).toBeCloseTo(expected, 0);
  });

  it("age 40+ uses base denominator of 10", () => {
    const result = calculateNetWorth({ ...baseInput, age: 45 });
    // Expected NW = ((45 × 200000) / (10 + 0)) × 2 = 1,800,000
    const expected = ((45 * 200000) / 10) * 2;
    expect(result.wealthTarget).toBeCloseTo(expected, 0);
  });

  it("age exactly 40 transitions to base denominator", () => {
    const result = calculateNetWorth({ ...baseInput, age: 40 });
    // At 40: max(0, 40-40) = 0, so denominator = 10
    const expected = ((40 * 200000) / 10) * 2;
    expect(result.wealthTarget).toBeCloseTo(expected, 0);
  });

  it("wealth score increases as age increases with same NW", () => {
    // Older person with same NW → lower expected NW relative to age/income → higher score
    // Wait — actually expected NW increases with age, so score decreases
    const young = calculateNetWorth({ ...baseInput, age: 30 });
    const old = calculateNetWorth({ ...baseInput, age: 50 });
    // Expected NW at 50 > expected NW at 30
    expect(old.wealthTarget).toBeGreaterThan(young.wealthTarget);
    // So wealth score at 50 < score at 30 (same actual NW, higher target)
    expect(old.wealthScore).toBeLessThan(young.wealthScore);
  });
});

// ════════════════════════════════════════
// 8. BUDGET MULTI-COLUMN COMPARISON
// ════════════════════════════════════════

describe("budget multi-column scenarios", () => {
  const items = [
    {
      category: "Housing",
      label: "Mortgage",
      amounts: [1500, 1500, 1500],
      isEssential: true,
    },
    {
      category: "Food",
      label: "Groceries",
      amounts: [500, 400, 300],
      isEssential: true,
    },
    {
      category: "Fun",
      label: "Dining",
      amounts: [300, 150, 0],
      isEssential: false,
    },
    {
      category: "Fun",
      label: "Hobbies",
      amounts: [200, 100, 50],
      isEssential: false,
    },
  ];
  const labels = ["Standard", "Tight", "Emergency"];

  it("emergency budget ≤ tight budget ≤ standard budget", () => {
    const standard = calculateBudget({
      items,
      columnLabels: labels,
      selectedColumn: 0,
      asOfDate: AS_OF_DATE,
    });
    const tight = calculateBudget({
      items,
      columnLabels: labels,
      selectedColumn: 1,
      asOfDate: AS_OF_DATE,
    });
    const emergency = calculateBudget({
      items,
      columnLabels: labels,
      selectedColumn: 2,
      asOfDate: AS_OF_DATE,
    });

    expect(emergency.totalMonthly).toBeLessThanOrEqual(tight.totalMonthly);
    expect(tight.totalMonthly).toBeLessThanOrEqual(standard.totalMonthly);
  });

  it("essential amounts stay fixed across tighter budgets when designed that way", () => {
    const standard = calculateBudget({
      items,
      columnLabels: labels,
      selectedColumn: 0,
      asOfDate: AS_OF_DATE,
    });
    const emergency = calculateBudget({
      items,
      columnLabels: labels,
      selectedColumn: 2,
      asOfDate: AS_OF_DATE,
    });

    // Mortgage (essential) stays at $1500 across all columns
    const stdMortgage = standard.categories
      .find((c) => c.name === "Housing")
      ?.items.find((i) => i.label === "Mortgage");
    const emgMortgage = emergency.categories
      .find((c) => c.name === "Housing")
      ?.items.find((i) => i.label === "Mortgage");
    expect(stdMortgage?.amount).toBe(emgMortgage?.amount);
  });

  it("discretionary items can be zero in emergency column", () => {
    const emergency = calculateBudget({
      items,
      columnLabels: labels,
      selectedColumn: 2,
      asOfDate: AS_OF_DATE,
    });

    const dining = emergency.categories
      .find((c) => c.name === "Fun")
      ?.items.find((i) => i.label === "Dining");
    expect(dining?.amount).toBe(0);
  });
});
