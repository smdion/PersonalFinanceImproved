/** A fictional single retiree whose 2058 gross-up once withdrew the whole
 *  balance. Captured from the production payload path (the projection
 *  router's fetchRetirementData -> buildEnginePayload ->
 *  buildDecumulationDefaults) so it carries every field a real household's
 *  input does. Single, born 1969-06-15, retired at 56, plan to 100;
 *  Traditional 401(k) $63,000 and Traditional IRA $468,000; Social Security
 *  $1,250 a month from 63; spending $38,000; inflation 3%, return 8%;
 *  bracket filling at the 12% ceiling.
 *
 *  In 2058 the after-tax need is $59,226.90 and the RMD ($105,999.55)
 *  exceeds the grossed-up need, so the year withdraws the RMD, pays
 *  $10,412.67 tax and reinvests $36,359.98. The solver's secant once took
 *  a slope from two trials a cent apart (rounding noise of 0.99999999),
 *  stepped to billions, capped at the balance and accepted that trial:
 *  it withdrew all $1,643,726.52 and the plan failed in 2059. */
import type { ProjectionInput } from "@/lib/pure/engine/types";
import { makeAccumulationDefaults } from "./engine-fixtures";

const CAPTURED: Omit<ProjectionInput, "asOfDate" | "employerMatchByParentCat"> =
  {
    accumulationDefaults: makeAccumulationDefaults({
      accountOrder: ["401k", "403b", "ira", "hsa", "brokerage"],
      accountSplits: {
        "401k": 0,
        "403b": 0,
        ira: 0,
        hsa: 0,
        brokerage: 0,
      },
      taxSplits: {
        "401k": 1,
        "403b": 1,
        ira: 1,
      },
    }),
    currentAge: 57,
    retirementYear: 2025,
    projectionEndYear: 2069,
    payrollTax: {
      socialSecurityRate: 0.062,
      medicareRate: 0.0145,
      socialSecurityWageBase: 184500,
    },
    budgetContributionLines: 0,
    currentSalary: 0,
    salaryGrowthRate: 0,
    salaryCap: null,
    salaryOverrides: [],
    budgetOverrides: [],
    irsLimitCaps: {
      limits: {
        "401k_employee_limit": 24500,
        "401k_catchup_limit": 8000,
        "401k_super_catchup_limit": 11250,
        "401k_total_additions_limit": 72000,
        ira_limit: 7500,
        ira_catchup_limit: 1100,
        hsa_family_limit: 8750,
        hsa_individual_limit: 4400,
        hsa_catchup_limit: 1000,
        ss_wage_base: 184500,
        fica_ss_rate: 0.062,
        fica_medicare_rate: 0.0145,
        fica_medicare_surtax_rate: 0.009,
        fica_medicare_surtax_threshold: 200000,
        supplemental_tax_rate: 0.22,
        standard_deduction_mfj: 32200,
        standard_deduction_single: 16100,
        standard_deduction_hoh: 24150,
        fica_medicare_surtax_liability_mfj: 250000,
        fica_medicare_surtax_liability_single: 200000,
        fica_medicare_surtax_liability_hoh: 200000,
        roth_ira_phaseout_start_mfj: 242000,
        roth_ira_phaseout_end_mfj: 252000,
        roth_ira_phaseout_start_single: 153000,
        roth_ira_phaseout_end_single: 168000,
        roth_ira_phaseout_start_hoh: 153000,
        roth_ira_phaseout_end_hoh: 168000,
        hdhp_min_deductible_self: 1700,
        hdhp_min_deductible_family: 3400,
        additional_std_deduction_65_married: 1650,
        additional_std_deduction_65_unmarried: 2050,
        obbba_senior_deduction_per_person: 6000,
        obbba_senior_deduction_phaseout_start_mfj: 150000,
        obbba_senior_deduction_phaseout_start_unmarried: 75000,
        obbba_senior_deduction_phaseout_rate: 0.06,
        obbba_senior_deduction_sunset_year: 2028,
        qcd_annual_limit: 111000,
      },
      people: [
        {
          id: 1,
          birthYear: 1969,
        },
      ],
      filingStatus: "Single",
      accounts: [],
    },
    limitGrowthRate: 0.02,
    employerMatchRateByCategory: {
      "401k": 0,
      "403b": 0,
      ira: 0,
      hsa: 0,
      brokerage: 0,
    },
    contributionSpecs: [],
    baseYearContributions: {
      "401k": 0,
      "403b": 0,
      ira: 0,
      hsa: 0,
      brokerage: 0,
    },
    baseYearEmployerMatch: {
      "401k": 0,
      "403b": 0,
      ira: 0,
      hsa: 0,
      brokerage: 0,
    },
    brokerageContributionRamp: 0,
    brokerageGoals: [],
    startingBalances: {
      preTax: 531000,
      taxFree: 0,
      hsa: 0,
      afterTax: 0,
      afterTaxBasis: 0,
    },
    startingAccountBalances: {
      "401k": {
        structure: "roth_traditional",
        traditional: 63000,
        roth: 0,
      },
      "403b": {
        structure: "roth_traditional",
        traditional: 0,
        roth: 0,
      },
      ira: {
        structure: "roth_traditional",
        traditional: 468000,
        roth: 0,
      },
      hsa: {
        structure: "single_bucket",
        balance: 0,
      },
      brokerage: {
        structure: "basis_tracking",
        balance: 0,
        basis: 0,
      },
    },
    individualAccounts: [
      {
        name: "A A-401k-trad",
        category: "401k",
        taxType: "preTax",
        accountType: "401k",
        startingBalance: 63000,
        ownerName: "A",
        ownerPersonId: 1,
        parentCategory: "Retirement",
        ruleOf55: {
          eligible: null,
          separationYear: null,
          source: "no_data",
          knownFutureSeparationYear: null,
        },
        rothBasisMeta: null,
        ownerBirthYear: 1969,
        ownerRetirementYear: 2025,
      },
      {
        name: "A A-ira-trad",
        category: "ira",
        taxType: "preTax",
        accountType: "ira",
        startingBalance: 468000,
        ownerName: "A",
        ownerPersonId: 1,
        parentCategory: "Retirement",
        ruleOf55: null,
        rothBasisMeta: null,
        ownerBirthYear: 1969,
        ownerRetirementYear: 2025,
      },
      {
        name: "Retirement brokerage (projected)",
        category: "brokerage",
        taxType: "afterTax",
        startingBalance: 0,
        startingBasis: 0,
        parentCategory: "Retirement",
        projectedOnly: true,
      },
    ],
    inputWarnings: [
      "No active retirement profile is set, so this uses Skeptic Plan. Choose one in the Retirement profiles.",
    ],
    annualExpenses: 38000,
    expenseEndings: [],
    decumulationAnnualExpenses: 38000,
    inflationRate: 0.03,
    returnRates: [
      {
        label: "Age 0",
        rate: 0.08,
      },
    ],
    socialSecurityAnnual: 15000,
    ssStartAge: 63,
    birthYear: 1969,
    filingStatus: "Single",
    enableIrmaaAwareness: false,
    irmaaOnTopOfBudget: false,
    gapYearStopSaving: false,
    gapYearDraws: true,
    primaryPersonId: 1,
    enableAcaAwareness: false,
    householdSize: 2,
    perPersonBirthYears: [1969],
    decumulationDefaults: {
      withdrawalRate: 0.04,
      withdrawalRoutingMode: "bracket_filling",
      withdrawalOrder: ["ira", "401k", "403b", "brokerage", "hsa"],
      withdrawalSplits: {
        "401k": 0.35,
        "403b": 0,
        ira: 0.25,
        hsa: 0.1,
        brokerage: 0.3,
      },
      withdrawalTaxPreference: {
        "401k": "traditional",
        "403b": "traditional",
        ira: "roth",
      },
      distributionTaxRates: {
        rothBracketOverlay: true,
        traditionalFallbackRate: 0.06263157894736843,
        roth: 0,
        hsa: 0,
        brokerage: 0,
        taxBrackets: [
          {
            rate: 0,
            threshold: 0,
            baseWithholding: 0,
          },
          {
            rate: 0.1,
            threshold: 7500,
            baseWithholding: 0,
          },
          {
            rate: 0.12,
            threshold: 19900,
            baseWithholding: 1240,
          },
          {
            rate: 0.22,
            threshold: 57900,
            baseWithholding: 5800,
          },
          {
            rate: 0.24,
            threshold: 113200,
            baseWithholding: 17966,
          },
          {
            rate: 0.32,
            threshold: 209275,
            baseWithholding: 41024,
          },
          {
            rate: 0.35,
            threshold: 263725,
            baseWithholding: 58448,
          },
          {
            rate: 0.37,
            threshold: 648100,
            baseWithholding: 192979.25,
          },
        ],
        ltcgBrackets: {
          MFJ: [
            {
              threshold: 98900,
              rate: 0,
            },
            {
              threshold: 613700,
              rate: 0.15,
            },
            {
              threshold: null,
              rate: 0.2,
            },
          ],
          Single: [
            {
              threshold: 49450,
              rate: 0,
            },
            {
              threshold: 545500,
              rate: 0.15,
            },
            {
              threshold: null,
              rate: 0.2,
            },
          ],
          HOH: [
            {
              threshold: 66200,
              rate: 0,
            },
            {
              threshold: 579600,
              rate: 0.15,
            },
            {
              threshold: null,
              rate: 0.2,
            },
          ],
        },
        irmaaBrackets: {
          MFJ: [
            {
              magiThreshold: 218000,
              annualSurcharge: 1148.4,
            },
            {
              magiThreshold: 274000,
              annualSurcharge: 2884.8,
            },
            {
              magiThreshold: 342000,
              annualSurcharge: 4620,
            },
            {
              magiThreshold: 410000,
              annualSurcharge: 6355.2,
            },
            {
              magiThreshold: 750000,
              annualSurcharge: 6936,
            },
          ],
          Single: [
            {
              magiThreshold: 109000,
              annualSurcharge: 1148.4,
            },
            {
              magiThreshold: 137000,
              annualSurcharge: 2884.8,
            },
            {
              magiThreshold: 171000,
              annualSurcharge: 4620,
            },
            {
              magiThreshold: 205000,
              annualSurcharge: 6355.2,
            },
            {
              magiThreshold: 500000,
              annualSurcharge: 6936,
            },
          ],
          HOH: [
            {
              magiThreshold: 109000,
              annualSurcharge: 1148.4,
            },
            {
              magiThreshold: 137000,
              annualSurcharge: 2884.8,
            },
            {
              magiThreshold: 171000,
              annualSurcharge: 4620,
            },
            {
              magiThreshold: 205000,
              annualSurcharge: 6355.2,
            },
            {
              magiThreshold: 500000,
              annualSurcharge: 6936,
            },
          ],
        },
        fplByHousehold: {
          "1": 15650,
          "2": 21150,
          "3": 26650,
          "4": 32150,
          "5": 37650,
          "6": 43150,
          "7": 48650,
          "8": 54150,
        },
        taxBracketsYear: 2026,
        ltcgBracketsYear: 2026,
        irmaaBracketsYear: 2026,
        fplYear: 2026,
        taxMultiplier: 1,
        grossUpForTaxes: true,
        rothBracketTarget: 0.12,
        enableRothConversions: false,
        standardDeduction: 16100,
        additionalStdDeduction65PerSenior: 2050,
        obbbaSeniorDeductionPerPerson: 6000,
        obbbaSeniorPhaseoutStart: 75000,
        obbbaSeniorPhaseoutRate: 0.06,
        obbbaSeniorSunsetYear: 2028,
        qcdAnnualLimit: 111000,
        taxDataYear: 2026,
        taxParamsVersion: 2,
      },
      withdrawalStrategy: "fixed",
      strategyParams: {
        rmd_spending: {
          rmdMultiplier: 1,
          ssInAmount: false,
        },
        guyton_klinger: {
          upperGuardrail: 0.8,
          lowerGuardrail: 1.2,
          increasePercent: 0.1,
          decreasePercent: 0.1,
          skipInflationAfterLoss: true,
        },
        spending_decline: {
          annualDeclineRate: 0.02,
        },
        constant_percentage: {
          withdrawalPercent: 0.05,
          floorPercent: 0.9,
          ssInAmount: false,
        },
        endowment: {
          withdrawalPercent: 0.05,
          rollingYears: 10,
          floorPercent: 0.9,
          ssInAmount: false,
        },
        vanguard_dynamic: {
          basePercent: 0.05,
          ceilingPercent: 0.05,
          floorPercent: 0.025,
          ssInAmount: false,
        },
        vpw: {
          cap: 0.1,
          endAge: 100,
          stockReturn: 0.05,
          bondReturn: 0.019,
          stockShare: 0.6,
          ssInAmount: false,
        },
      },
      rmdExcessHandling: "reinvest",
      qcdMaximize: false,
      rmdSmoothingEnabled: false,
      discretionaryWithdrawalOrder: "roth_first",
    },
    accumulationOverrides: [],
    decumulationOverrides: [],
  };

export function grossUpWholeBalanceHousehold(): ProjectionInput {
  return {
    ...structuredClone(CAPTURED),
    employerMatchByParentCat: new Map(),
    asOfDate: new Date("2026-01-01T00:00:00.000Z"),
  };
}
