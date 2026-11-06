/**
 * The seven engine-ledger households (`tests/fixtures/engine-ledgers/
 * H#.input.json`, from the November review's `specs/engine-ledgers/`),
 * converted once into what a household can enter, and frozen here so a
 * correction to a ledger input never moves this baseline.
 *
 * Converted: people and birthdays, jobs and pay (salary growth is the
 * retirement settings' raise), balances (a Traditional and a Roth part of
 * one plan are one account in two parts), payroll contributions and
 * matches, Social Security, spending (one monthly budget line), return
 * rates, inflation, Fixed strategy, waterfall routing in the ledger's
 * order, no Roth bracket target and no conversions. A job's last year is
 * the retirement age (the year after it ends).
 *
 * Not enterable, so not converted: H5's 2031 lump sum and its 401(k)
 * overflow to brokerage (the app refuses a contribution over the limit, so
 * H5's $36,000 is entered at the $24,500 limit), H6's penalized withdrawals before 59 1/2 (the
 * default avoids them), the ledgers' 2% limit growth, and the 2026-01-01
 * as-of date (the baseline's clock is fixed instead; see the test file).
 */
import type { Household } from "./seed";
import { job, ledgerSettings } from "./household-parts";

export const LEDGER_HOUSEHOLDS: Household[] = [
  {
    key: "el-h1",
    source:
      "engine-ledgers H1: One earner, married, Portfolio savings alongside",
    people: [
      {
        key: "A",
        name: "Dana",
        dateOfBirth: "1971-01-15",
        isPrimaryUser: true,
      },
      {
        key: "B",
        name: "Lee",
        dateOfBirth: "1973-01-15",
        isPrimaryUser: false,
      },
    ],
    jobs: [
      job("JA", "A", "Employer J1", "2010-01-01", {
        salary: 120000,
        w4FilingStatus: "MFJ",
      }),
    ],
    deductions: [],
    accounts: [
      {
        key: "A-401k",
        perf: {
          institution: "Plan Co 401(k)",
          accountType: "401k",
          owner: "A",
          ownershipType: "individual",
          parentCategory: "Retirement",
        },
        snapshot: [{ owner: "A", taxType: "preTax", amount: "900000" }],
        contrib: [
          {
            job: "JA",
            person: "A",
            accountType: "401k",
            taxTreatment: "pre_tax",
            parentCategory: "Retirement",
            employerMatchType: "percent_of_contribution",
            employerMatchRate: "0.5",
            employerMaxMatchPct: "0.06",
            value: "15",
            method: "percent_of_salary",
          },
        ],
      },
      {
        key: "A-ira",
        perf: {
          institution: "Index Funds IRA",
          accountType: "ira",
          owner: "A",
          ownershipType: "individual",
          parentCategory: "Retirement",
        },
        snapshot: [{ owner: "A", taxType: "taxFree", amount: "80000" }],
        contrib: [],
      },
      {
        key: "A-hsa",
        perf: {
          institution: "Health Savings Co",
          accountType: "hsa",
          owner: "A",
          ownershipType: "individual",
          parentCategory: "Retirement",
        },
        snapshot: [{ owner: "A", taxType: "hsa", amount: "30000" }],
        contrib: [
          {
            job: "JA",
            person: "A",
            accountType: "hsa",
            taxTreatment: "hsa",
            parentCategory: "Retirement",
            employerMatchType: "none",
            hsaCoverageType: "family",
            isPayrollDeducted: true,
            value: "5000",
            method: "fixed_annual",
          },
        ],
      },
      {
        key: "A-brokerage-P",
        perf: {
          institution: "Index Funds Brokerage",
          accountType: "brokerage",
          owner: "A",
          ownershipType: "individual",
          parentCategory: "Portfolio",
          costBasis: "70000",
        },
        snapshot: [{ owner: "A", taxType: "afterTax", amount: "100000" }],
        contrib: [
          {
            job: "JA",
            person: "A",
            accountType: "brokerage",
            taxTreatment: "after_tax",
            parentCategory: "Portfolio",
            employerMatchType: "none",
            value: "6000",
            method: "fixed_annual",
          },
        ],
      },
    ],
    cash: 0,
    budget: [
      {
        category: "Living",
        subcategory: "Household spending",
        monthly: 5833.33,
        essential: true,
      },
    ],
    retirement: {
      A: {
        retirementAge: 65,
        endAge: 76,
        ssMonthly: "3000.00",
        ssStartAge: 67,
      },
      B: {
        retirementAge: 63,
        endAge: 74,
        ssMonthly: "1500.00",
        ssStartAge: 67,
      },
    },
    settings: ledgerSettings("MFJ", "0.06", "0.03", "0.03", [
      "401k",
      "ira",
      "hsa",
    ]),
    returnRates: [[0, "0.06"]],
  },
  {
    key: "el-h2",
    source: "engine-ledgers H2: Two earners, one stops four-plus years early",
    people: [
      {
        key: "A",
        name: "Robin",
        dateOfBirth: "1964-01-15",
        isPrimaryUser: true,
      },
      {
        key: "B",
        name: "Quinn",
        dateOfBirth: "1968-01-15",
        isPrimaryUser: false,
      },
    ],
    jobs: [
      job("JA", "A", "Employer J1", "2005-01-01", {
        salary: 110000,
        w4FilingStatus: "MFJ",
      }),
      job("JB", "B", "Employer J2", "2008-01-01", {
        salary: 85000,
        w4FilingStatus: "MFJ",
      }),
    ],
    deductions: [],
    accounts: [
      {
        key: "A-403b",
        perf: {
          institution: "Plan Co 403(b)",
          accountType: "403b",
          owner: "A",
          ownershipType: "individual",
          parentCategory: "Retirement",
        },
        snapshot: [{ owner: "A", taxType: "preTax", amount: "1500000" }],
        contrib: [
          {
            job: "JA",
            person: "A",
            accountType: "403b",
            taxTreatment: "pre_tax",
            parentCategory: "Retirement",
            employerMatchType: "none",
            value: "5",
            method: "percent_of_salary",
          },
        ],
      },
      {
        key: "B-401k",
        perf: {
          institution: "Plan Co 401(k)",
          accountType: "401k",
          owner: "B",
          ownershipType: "individual",
          parentCategory: "Retirement",
        },
        snapshot: [
          { owner: "B", taxType: "preTax", amount: "350000" },
          { owner: "B", taxType: "taxFree", amount: "60000" },
        ],
        contrib: [
          {
            job: "JB",
            person: "B",
            accountType: "401k",
            taxTreatment: "pre_tax",
            parentCategory: "Retirement",
            employerMatchType: "percent_of_contribution",
            employerMatchRate: "1",
            employerMaxMatchPct: "0.04",
            value: "10",
            method: "percent_of_salary",
          },
          {
            job: "JB",
            person: "B",
            accountType: "401k",
            taxTreatment: "tax_free",
            parentCategory: "Retirement",
            employerMatchType: "none",
            value: "2",
            method: "percent_of_salary",
          },
        ],
      },
    ],
    cash: 0,
    budget: [
      {
        category: "Living",
        subcategory: "Household spending",
        monthly: 8750.0,
        essential: true,
      },
    ],
    retirement: {
      A: {
        retirementAge: 64,
        endAge: 80,
        ssMonthly: "2666.67",
        ssStartAge: 67,
      },
      B: {
        retirementAge: 65,
        endAge: 76,
        ssMonthly: "2333.33",
        ssStartAge: 67,
      },
    },
    settings: ledgerSettings("MFJ", "0.05", "0.03", "0.03", ["403b", "401k"]),
    returnRates: [[0, "0.05"]],
  },
  {
    key: "el-h3",
    source:
      "engine-ledgers H3: Retired couple, Social Security and RMDs, no job ever",
    people: [
      {
        key: "A",
        name: "Harper",
        dateOfBirth: "1954-01-15",
        isPrimaryUser: true,
      },
      {
        key: "B",
        name: "Sage",
        dateOfBirth: "1960-01-15",
        isPrimaryUser: false,
      },
    ],
    jobs: [],
    deductions: [],
    accounts: [
      {
        key: "A-401k",
        perf: {
          institution: "Plan Co 401(k)",
          accountType: "401k",
          owner: "A",
          ownershipType: "individual",
          parentCategory: "Retirement",
        },
        snapshot: [{ owner: "A", taxType: "preTax", amount: "2400000" }],
        contrib: [],
      },
      {
        key: "B-ira",
        perf: {
          institution: "Index Funds IRA",
          accountType: "ira",
          owner: "B",
          ownershipType: "individual",
          parentCategory: "Retirement",
        },
        snapshot: [{ owner: "B", taxType: "preTax", amount: "450000" }],
        contrib: [],
      },
      {
        key: "A-ira",
        perf: {
          institution: "Index Funds IRA",
          accountType: "ira",
          owner: "A",
          ownershipType: "individual",
          parentCategory: "Retirement",
        },
        snapshot: [{ owner: "A", taxType: "taxFree", amount: "200000" }],
        contrib: [],
      },
    ],
    cash: 0,
    budget: [
      {
        category: "Living",
        subcategory: "Household spending",
        monthly: 9166.67,
        essential: true,
      },
    ],
    retirement: {
      A: {
        retirementAge: 72,
        endAge: 83,
        ssMonthly: "2833.33",
        ssStartAge: 67,
      },
      B: {
        retirementAge: 66,
        endAge: 77,
        ssMonthly: "1833.33",
        ssStartAge: 62,
      },
    },
    settings: ledgerSettings("MFJ", "0.05", "0.03", "0", ["401k", "ira"]),
    returnRates: [[0, "0.05"]],
  },
  {
    key: "el-h4",
    source:
      "engine-ledgers H4: Early retiree living on a Retirement-parented brokerage",
    people: [
      {
        key: "A",
        name: "Rowan",
        dateOfBirth: "1978-01-15",
        isPrimaryUser: true,
      },
    ],
    jobs: [],
    deductions: [],
    accounts: [
      {
        key: "A-brokerage",
        perf: {
          institution: "Index Funds Brokerage",
          accountType: "brokerage",
          owner: "A",
          ownershipType: "individual",
          parentCategory: "Retirement",
          costBasis: "600000",
        },
        snapshot: [{ owner: "A", taxType: "afterTax", amount: "1000000" }],
        contrib: [],
      },
      {
        key: "A-ira",
        perf: {
          institution: "Index Funds IRA",
          accountType: "ira",
          owner: "A",
          ownershipType: "individual",
          parentCategory: "Retirement",
        },
        snapshot: [
          { owner: "A", taxType: "preTax", amount: "500000" },
          { owner: "A", taxType: "taxFree", amount: "100000" },
        ],
        contrib: [],
      },
    ],
    cash: 0,
    budget: [
      {
        category: "Living",
        subcategory: "Household spending",
        monthly: 5000.0,
        essential: true,
      },
    ],
    retirement: {
      A: {
        retirementAge: 48,
        endAge: 76,
        ssMonthly: "1666.67",
        ssStartAge: 67,
      },
    },
    settings: ledgerSettings("Single", "0.05", "0.03", "0", [
      "brokerage",
      "ira",
    ]),
    returnRates: [[0, "0.05"]],
  },
  {
    key: "el-h5",
    source: "engine-ledgers H5: Single, retires mid-plan at 60",
    people: [
      {
        key: "A",
        name: "Emery",
        dateOfBirth: "1979-01-15",
        isPrimaryUser: true,
      },
    ],
    jobs: [
      job("JA", "A", "Employer J1", "2012-01-01", {
        salary: 130000,
        w4FilingStatus: "Single",
      }),
    ],
    deductions: [],
    accounts: [
      {
        key: "A-401k",
        perf: {
          institution: "Plan Co 401(k)",
          accountType: "401k",
          owner: "A",
          ownershipType: "individual",
          parentCategory: "Retirement",
        },
        snapshot: [
          { owner: "A", taxType: "preTax", amount: "700000" },
          { owner: "A", taxType: "taxFree", amount: "50000" },
        ],
        contrib: [
          {
            job: "JA",
            person: "A",
            accountType: "401k",
            taxTreatment: "tax_free",
            parentCategory: "Retirement",
            employerMatchType: "percent_of_contribution",
            employerMatchRate: "1",
            employerMaxMatchPct: "0.03",
            value: "24500",
            method: "fixed_annual",
          },
        ],
      },
      {
        key: "A-brokerage",
        perf: {
          institution: "Index Funds Brokerage",
          accountType: "brokerage",
          owner: "A",
          ownershipType: "individual",
          parentCategory: "Retirement",
          costBasis: "30000",
        },
        snapshot: [{ owner: "A", taxType: "afterTax", amount: "40000" }],
        contrib: [],
      },
      {
        key: "A-brokerage-P",
        perf: {
          institution: "Index Funds Brokerage",
          accountType: "brokerage",
          owner: "A",
          ownershipType: "individual",
          parentCategory: "Portfolio",
          costBasis: "50000",
        },
        snapshot: [{ owner: "A", taxType: "afterTax", amount: "60000" }],
        contrib: [
          {
            job: "JA",
            person: "A",
            accountType: "brokerage",
            taxTreatment: "after_tax",
            parentCategory: "Portfolio",
            employerMatchType: "none",
            value: "6000",
            method: "fixed_annual",
          },
        ],
      },
    ],
    cash: 0,
    budget: [
      {
        category: "Living",
        subcategory: "Household spending",
        monthly: 5166.67,
        essential: true,
      },
    ],
    retirement: {
      A: {
        retirementAge: 60,
        endAge: 77,
        ssMonthly: "2500.00",
        ssStartAge: 67,
      },
    },
    settings: ledgerSettings("Single", "0.05", "0.03", "0.03", [
      "401k",
      "brokerage",
    ]),
    returnRates: [
      [0, "0.07"],
      [60, "0.05"],
    ],
  },
  {
    key: "el-h6",
    source: "engine-ledgers H6: Early retiree with only a Traditional IRA",
    people: [
      {
        key: "A",
        name: "Blake",
        dateOfBirth: "1977-07-01",
        isPrimaryUser: true,
      },
    ],
    jobs: [],
    deductions: [],
    accounts: [
      {
        key: "A-ira",
        perf: {
          institution: "Index Funds IRA",
          accountType: "ira",
          owner: "A",
          ownershipType: "individual",
          parentCategory: "Retirement",
        },
        snapshot: [{ owner: "A", taxType: "preTax", amount: "2000000" }],
        contrib: [],
      },
    ],
    cash: 0,
    budget: [
      {
        category: "Living",
        subcategory: "Household spending",
        monthly: 3333.33,
        essential: true,
      },
    ],
    retirement: {
      A: { retirementAge: 49, endAge: 77, ssMonthly: "0.00", ssStartAge: 67 },
    },
    settings: ledgerSettings("Single", "0.06", "0.03", "0", ["ira"]),
    returnRates: [[0, "0.06"]],
  },
  {
    key: "el-h7",
    source: "engine-ledgers H7: Plan that fails: Traditional runs out",
    people: [
      {
        key: "A",
        name: "Marlow",
        dateOfBirth: "1956-01-15",
        isPrimaryUser: true,
      },
    ],
    jobs: [],
    deductions: [],
    accounts: [
      {
        key: "A-ira",
        perf: {
          institution: "Index Funds IRA",
          accountType: "ira",
          owner: "A",
          ownershipType: "individual",
          parentCategory: "Retirement",
        },
        snapshot: [{ owner: "A", taxType: "preTax", amount: "250000" }],
        contrib: [],
      },
    ],
    cash: 0,
    budget: [
      {
        category: "Living",
        subcategory: "Household spending",
        monthly: 4166.67,
        essential: true,
      },
    ],
    retirement: {
      A: {
        retirementAge: 70,
        endAge: 80,
        ssMonthly: "1666.67",
        ssStartAge: 67,
      },
    },
    settings: ledgerSettings("Single", "0.05", "0.03", "0", ["ira"]),
    returnRates: [[0, "0.05"]],
  },
];
