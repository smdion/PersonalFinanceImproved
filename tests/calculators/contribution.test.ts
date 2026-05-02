import { describe, it, expect } from "vitest";
import { calculateContributions } from "@/lib/calculators/contribution";
import {
  PERSON_A_CONTRIBUTIONS,
  PERSON_B_CONTRIBUTIONS,
  AS_OF_DATE,
} from "./fixtures";
import type {
  ContributionAccountInput,
  ContributionInput,
} from "@/lib/calculators/types";

describe("calculateContributions", () => {
  describe("Person A contributions", () => {
    const input: ContributionInput = {
      annualSalary: 120000,
      contributionAccounts: PERSON_A_CONTRIBUTIONS,
      limits: {},
      asOfDate: AS_OF_DATE,
    };
    const result = calculateContributions(input);

    it("computes total annual contributions including employer match", () => {
      // Roth 401k: 16800 + 4200 match = 21000
      // Roth IRA: 8125 + 0 = 8125
      // Brokerage: 1950 + 0 = 1950
      // Total = 31075
      expect(result.totalAnnualContributions).toBeCloseTo(31075, 0);
    });

    it("computes per-account percentage of salary", () => {
      const roth401k = result.accounts.find((a) => a.name === "Roth 401k");
      expect(roth401k?.percentOfSalary).toBeCloseTo(0.14, 2);
    });

    it("builds group rates dynamically", () => {
      // retirement group: Roth 401k (16800 + 4200) + Roth IRA (8125)
      // = 29125 / 120000 ≈ 0.2427
      expect(result.groupRates["retirement"]).toBeCloseTo(0.243, 1);
      // portfolio group (brokerage in fixtures): (1950) / 120000
      expect(result.groupRates["portfolio"]).toBeCloseTo(0.016, 2);
      // total = sum of all groups
      expect(result.groupRates["total"]).toBeCloseTo(0.259, 1);
    });
  });

  describe("Person B contributions", () => {
    const input: ContributionInput = {
      annualSalary: 110000,
      contributionAccounts: PERSON_B_CONTRIBUTIONS,
      limits: {},
      asOfDate: AS_OF_DATE,
    };
    const result = calculateContributions(input);

    it("includes employer match in group rates", () => {
      // retirement: Trad 401k (17600 + 5500) + Roth 401k (5500) + Roth IRA (8125)
      // = 36725 / 110000 ≈ 0.3339
      expect(result.groupRates["retirement"]).toBeCloseTo(0.334, 1);
    });

    it("separates non-retirement accounts", () => {
      // In fixtures, HSA + ESPP are grouped under 'portfolio'
      // portfolio group: HSA (8346 + 400) + ESPP (11000)
      // = 19746 / 110000 ≈ 0.1795
      expect(result.groupRates["portfolio"]).toBeCloseTo(0.18, 1);
    });

    it("has total rate across all groups", () => {
      // total = retirement + portfolio = (36725 + 19746) / 110000 ≈ 0.513
      expect(result.groupRates["total"]).toBeCloseTo(0.513, 1);
    });
  });

  // ---------------------------------------------------------------------------
  // Spreadsheet verification — locked to representative test values
  // Uses synthetic salaries: Person A $120,000, Person B $110,000
  // ---------------------------------------------------------------------------
  describe("household totals — spreadsheet verification", () => {
    const PERSON_A_SALARY = 120000;
    const PERSON_B_SALARY = 110000;

    // Person A: Roth 401k 14% (50% match up to 7%), Roth IRA $312.50/period, Brokerage $75/period
    const personAAccounts: ContributionAccountInput[] = [
      {
        name: "Roth 401k",
        annualContribution: PERSON_A_SALARY * 0.14, // 16,800
        perPeriodContribution: (PERSON_A_SALARY * 0.14) / 26,
        rateOfGross: 0.14,
        taxTreatment: "tax_free",
        isPayrollDeducted: true,
        group: "retirement",
        employerMatch: PERSON_A_SALARY * 0.07 * 0.5, // 50% match capped at 7% = 4,200
        employerMatchTaxTreatment: "pre_tax",
      },
      {
        name: "Roth IRA",
        annualContribution: 312.5 * 26, // 8,125
        perPeriodContribution: 312.5,
        rateOfGross: null,
        taxTreatment: "tax_free",
        isPayrollDeducted: false,
        group: "retirement",
        employerMatch: 0,
        employerMatchTaxTreatment: "pre_tax",
      },
      {
        name: "LT Brokerage",
        annualContribution: 75 * 26, // 1,950
        perPeriodContribution: 75,
        rateOfGross: null,
        taxTreatment: "after_tax",
        isPayrollDeducted: false,
        group: "taxable",
        employerMatch: 0,
        employerMatchTaxTreatment: "pre_tax",
      },
    ];

    // Person B: Trad 401k 16% (100% match up to 5%), Roth 401k 5%, Roth IRA $312.50/period,
    //         HSA $321/period ($400/yr employer), ESPP 10% (15% discount as match)
    const personBAccounts: ContributionAccountInput[] = [
      {
        name: "Traditional 401k",
        annualContribution: PERSON_B_SALARY * 0.16, // 17,600
        perPeriodContribution: (PERSON_B_SALARY * 0.16) / 26,
        rateOfGross: 0.16,
        taxTreatment: "pre_tax",
        isPayrollDeducted: true,
        group: "retirement",
        employerMatch: PERSON_B_SALARY * 0.05, // 100% match up to 5% = 5,500
        employerMatchTaxTreatment: "pre_tax",
      },
      {
        name: "Roth 401k",
        annualContribution: PERSON_B_SALARY * 0.05, // 5,500
        perPeriodContribution: (PERSON_B_SALARY * 0.05) / 26,
        rateOfGross: 0.05,
        taxTreatment: "tax_free",
        isPayrollDeducted: true,
        group: "retirement",
        employerMatch: 0,
        employerMatchTaxTreatment: "pre_tax",
      },
      {
        name: "Roth IRA",
        annualContribution: 312.5 * 26, // 8,125
        perPeriodContribution: 312.5,
        rateOfGross: null,
        taxTreatment: "tax_free",
        isPayrollDeducted: false,
        group: "retirement",
        employerMatch: 0,
        employerMatchTaxTreatment: "pre_tax",
      },
      {
        name: "HSA",
        annualContribution: 321 * 26, // 8,346
        perPeriodContribution: 321,
        rateOfGross: null,
        taxTreatment: "hsa",
        isPayrollDeducted: true,
        group: "hsa",
        employerMatch: 400, // $400/yr employer contribution
        employerMatchTaxTreatment: "pre_tax",
      },
      {
        name: "ESPP",
        annualContribution: PERSON_B_SALARY * 0.1, // 11,000
        perPeriodContribution: (PERSON_B_SALARY * 0.1) / 26,
        rateOfGross: 0.1,
        taxTreatment: "after_tax",
        isPayrollDeducted: true,
        group: "taxable",
        employerMatch: PERSON_B_SALARY * 0.1 * 0.15, // 15% discount = 1,650
        employerMatchTaxTreatment: "pre_tax",
      },
    ];

    const personAResult = calculateContributions({
      annualSalary: PERSON_A_SALARY,
      contributionAccounts: personAAccounts,
      limits: {},
      asOfDate: AS_OF_DATE,
    });

    const personBResult = calculateContributions({
      annualSalary: PERSON_B_SALARY,
      contributionAccounts: personBAccounts,
      limits: {},
      asOfDate: AS_OF_DATE,
    });

    const householdEmployeeOnly =
      personAResult.totalEmployeeOnly + personBResult.totalEmployeeOnly;
    const householdWithMatch =
      personAResult.totalAnnualContributions +
      personBResult.totalAnnualContributions;
    const esppDiscount = PERSON_B_SALARY * 0.1 * 0.15; // 1,650

    it("household employee-only contributions", () => {
      // Person A: 16,800 + 8,125 + 1,950 = 26,875
      // Person B: 17,600 + 5,500 + 8,125 + 8,346 + 11,000 = 50,571
      // Total: 77,446
      expect(householdEmployeeOnly).toBeCloseTo(77446, 0);
    });

    it("household total with match", () => {
      // Employee (77,446) + match (11,750) = 89,196
      expect(householdWithMatch).toBeCloseTo(89196, 0);
    });

    it("ESPP discount is modeled as employer match", () => {
      expect(esppDiscount).toBeCloseTo(1650, 0);
      // Total minus ESPP discount gives contribution total comparable to spreadsheet format
      const withoutEsppDiscount = householdWithMatch - esppDiscount;
      expect(withoutEsppDiscount).toBeCloseTo(87546, 0);
    });
  });

  describe("edge cases", () => {
    it("handles zero salary without division error", () => {
      const result = calculateContributions({
        annualSalary: 0,
        contributionAccounts: [],
        limits: {},
        asOfDate: AS_OF_DATE,
      });
      expect(result.totalAnnualContributions).toBe(0);
      // total rate is 0 when no accounts exist
      expect(result.groupRates["total"]).toBe(0);
    });

    it("handles no contributions", () => {
      const result = calculateContributions({
        annualSalary: 100000,
        contributionAccounts: [],
        limits: {},
        asOfDate: AS_OF_DATE,
      });
      expect(result.totalAnnualContributions).toBe(0);
      expect(result.accounts).toHaveLength(0);
    });
  });
});
