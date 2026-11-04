/**
 * Ten invented households from the November review: the CPA hand
 * worksheet's eight (`hand-worksheet.md` H1–H6, H3v, H6s) and the two
 * screens-e2e households the worksheet doesn't have (`screens-e2e.md` B and
 * D; its A is worksheet H1 and its C is worksheet H6, seeded here as the
 * screens harness seeded them).
 *
 * The worksheet sets pay, withholding, accounts and spending; what it
 * leaves out (balances of the paycheck households, budgets, retirement
 * ages, Social Security) is invented here and marked "invented". Where the
 * review named no withdrawal strategy, each household gets a different one
 * so the baseline runs all nine. Not enterable, so not converted: H2's
 * W-4 Step 3 credit ($2,200) and child, and H3v's bonus as a dollar figure
 * (entered as the equal share of salary). H4's 401(k)s are entered at the
 * worksheet's shared-limit split ($13,611.11 and $10,888.89): the app
 * refuses the $27,000 asked, over the shared $24,500.
 */
import type { Household } from "./seed";
import {
  budgetLines,
  heldAccount,
  job,
  ledgerSettings,
  plainSettings,
} from "./household-parts";

const flat = {
  returnAfterRetirement: "0",
  annualInflation: "0",
  salaryAnnualIncrease: "0",
};

export const REVIEWED_HOUSEHOLDS: Household[] = [
  {
    key: "ws-h1",
    source: "hand-worksheet H1 = screens-e2e A: single renter, 26",
    people: [
      {
        key: "A",
        name: "Avery",
        dateOfBirth: "2000-04-12",
        isPrimaryUser: true,
      },
    ],
    jobs: [
      job("JA", "A", "Northwind Labs", "2022-06-01", {
        salary: 58000,
        payWeek: "even",
        anchorPayDate: "2026-01-09",
        w4FilingStatus: "Single",
      }),
    ],
    deductions: [
      {
        job: "JA",
        deductionName: "Health insurance",
        isPretax: true,
        ficaExempt: true,
        perPeriod: "60",
      },
    ],
    accounts: [
      {
        key: "P401",
        perf: {
          institution: "Fidelity",
          accountType: "401k",
          owner: "A",
          ownershipType: "individual",
          parentCategory: "Retirement",
        },
        snapshot: [{ owner: "A", taxType: "taxFree", amount: "42000" }],
        contrib: [
          {
            job: "JA",
            person: "A",
            accountType: "401k",
            taxTreatment: "tax_free",
            parentCategory: "Retirement",
            employerMatchType: "percent_of_contribution",
            employerMatchValue: "50",
            employerMaxMatchPct: "0.06",
            value: "6",
            method: "percent_of_salary",
          },
        ],
      },
      {
        key: "PIRA",
        perf: {
          institution: "Vanguard",
          accountType: "ira",
          owner: "A",
          ownershipType: "individual",
          parentCategory: "Retirement",
        },
        snapshot: [{ owner: "A", taxType: "taxFree", amount: "18500" }],
        contrib: [
          {
            job: null,
            person: "A",
            accountType: "ira",
            taxTreatment: "tax_free",
            parentCategory: "Retirement",
            employerMatchType: "none",
            value: "1500",
            method: "fixed_annual",
          },
        ],
      },
    ],
    cash: 9000,
    savingsGoals: [
      {
        name: "Emergency fund",
        targetAmount: "12000",
        isEmergencyFund: true,
        priority: 1,
      },
    ],
    budget: budgetLines([
      ["Housing", "Rent", 1450],
      ["Housing", "Utilities", 160],
      ["Food", "Grocery store", 420],
      ["Transportation", "Car and gas", 280],
      ["Utilities", "Phone and internet", 110],
      ["Lifestyle", "Dining out", 200, false],
      ["Insurance", "Renters and life", 45],
      ["Lifestyle", "Misc", 150, false],
    ]),
    retirement: {
      A: { retirementAge: 60, endAge: 92, ssMonthly: "2100", ssStartAge: 67 },
    },
    settings: plainSettings("Single", "forgo_inflation_after_loss", {
      returnAfterRetirement: "0.05",
      annualInflation: "0.03",
      salaryAnnualIncrease: "0.03",
    }),
    returnRates: [[0, "0.07"]],
  },
  {
    key: "ws-h2",
    source: "hand-worksheet H2: head of household, 38, one job, semimonthly",
    people: [
      {
        key: "A",
        name: "Taylor",
        dateOfBirth: "1988-05-10",
        isPrimaryUser: true,
      },
    ],
    jobs: [
      job("JA", "A", "Lakeside Clinic", "2019-02-01", {
        salary: 72000,
        payPeriod: "semimonthly",
        anchorPayDate: "2026-01-15",
        w4FilingStatus: "HOH",
      }),
    ],
    deductions: [
      {
        job: "JA",
        deductionName: "Health insurance",
        isPretax: true,
        ficaExempt: true,
        perPeriod: "120",
      },
    ],
    accounts: [
      {
        key: "A401",
        // Balance invented.
        perf: {
          institution: "Lakeside 401(k) plan",
          accountType: "401k",
          owner: "A",
          ownershipType: "individual",
          parentCategory: "Retirement",
        },
        snapshot: [{ owner: "A", taxType: "preTax", amount: "85000" }],
        contrib: [
          {
            job: "JA",
            person: "A",
            accountType: "401k",
            taxTreatment: "pre_tax",
            parentCategory: "Retirement",
            employerMatchType: "none",
            value: "5",
            method: "percent_of_salary",
          },
        ],
      },
    ],
    cash: 6000,
    debts: [
      {
        name: "Car loan",
        kind: "auto_loan",
        ownerPersonId: null,
        balance: "14000",
        balanceAsOf: "2026-03-01",
        originalAmount: "22000",
        interestRate: "0.069",
        monthlyPayment: "435",
      },
    ],
    // Invented.
    budget: budgetLines([
      ["Housing", "Rent", 1700],
      ["Food", "Groceries", 650],
      ["Family", "After-school care", 450],
      ["Transportation", "Car payment and gas", 600],
      ["Lifestyle", "Misc", 250, false],
    ]),
    retirement: {
      A: { retirementAge: 65, endAge: 92, ssMonthly: "2000", ssStartAge: 67 },
    },
    settings: plainSettings("HOH", "spending_decline"),
    returnRates: [[0, "0.07"]],
  },
  {
    key: "ws-h3",
    source: "hand-worksheet H3: married, one earner, bonus in March, HSA",
    people: [
      {
        key: "A",
        name: "Cameron",
        dateOfBirth: "1981-04-02",
        isPrimaryUser: true,
      },
      {
        key: "B",
        name: "Jesse",
        dateOfBirth: "1982-07-19",
        isPrimaryUser: false,
      },
    ],
    jobs: [
      job("JA", "A", "Granite Works", "2011-09-01", {
        salary: 140000,
        bonusPercent: 0.15,
        bonusMonth: 3,
        w4FilingStatus: "MFJ",
      }),
    ],
    deductions: [
      {
        job: "JA",
        deductionName: "Health insurance",
        isPretax: true,
        ficaExempt: true,
        perPeriod: "200",
      },
    ],
    accounts: [
      {
        key: "A401",
        // Balances invented.
        perf: {
          institution: "Granite 401(k) plan",
          accountType: "401k",
          owner: "A",
          ownershipType: "individual",
          parentCategory: "Retirement",
        },
        snapshot: [{ owner: "A", taxType: "preTax", amount: "260000" }],
        contrib: [
          {
            job: "JA",
            person: "A",
            accountType: "401k",
            taxTreatment: "pre_tax",
            parentCategory: "Retirement",
            employerMatchType: "none",
            value: "10",
            method: "percent_of_salary",
          },
        ],
      },
      {
        key: "AHSA",
        perf: {
          institution: "HealthEquity",
          accountType: "hsa",
          owner: "A",
          ownershipType: "individual",
          parentCategory: "Retirement",
        },
        snapshot: [{ owner: "A", taxType: "hsa", amount: "22000" }],
        contrib: [
          {
            job: "JA",
            person: "A",
            accountType: "hsa",
            taxTreatment: "hsa",
            parentCategory: "Retirement",
            hsaCoverageType: "family",
            isPayrollDeducted: true,
            employerMatchType: "fixed_annual",
            employerMatchValue: "950",
            value: "300",
            method: "fixed_per_period",
          },
        ],
      },
      heldAccount(
        "JBRK",
        {
          institution: "Schwab",
          accountType: "brokerage",
          owner: null,
          ownershipType: "joint",
          parentCategory: "Portfolio",
          costBasis: "30000",
        },
        [{ owner: null, taxType: "afterTax", amount: "45000" }],
      ),
    ],
    cash: 25000,
    budget: budgetLines([
      ["Housing", "Rent", 2600],
      ["Food", "Groceries", 900],
      ["Transportation", "Cars", 500],
      ["Lifestyle", "Travel", 400, false],
    ]),
    retirement: {
      A: { retirementAge: 62, endAge: 95, ssMonthly: "3100", ssStartAge: 67 },
      B: { retirementAge: 60, endAge: 95, ssMonthly: "1200", ssStartAge: 67 },
    },
    settings: plainSettings("MFJ", "guyton_klinger"),
    returnRates: [
      [0, "0.07"],
      [60, "0.05"],
    ],
  },
  {
    key: "ws-h3v",
    source:
      "hand-worksheet H3v: married, one earner, $190,000 and a $30,000 March bonus, nothing else",
    people: [
      {
        key: "A",
        name: "Jamie",
        dateOfBirth: "1979-10-01",
        isPrimaryUser: true,
      },
      {
        key: "B",
        name: "Pat",
        dateOfBirth: "1980-02-14",
        isPrimaryUser: false,
      },
    ],
    jobs: [
      job("JA", "A", "Summit Aero", "2008-05-01", {
        salary: 190000,
        bonusPercent: 0.15789474,
        bonusMonth: 3,
        w4FilingStatus: "MFJ",
      }),
    ],
    deductions: [],
    accounts: [],
    cash: 0,
    budget: budgetLines([["Living", "Household spending", 7500]]),
    retirement: {
      A: { retirementAge: 65, endAge: 90, ssMonthly: "3400", ssStartAge: 67 },
      B: { retirementAge: 65, endAge: 90, ssMonthly: "1700", ssStartAge: 67 },
    },
    settings: plainSettings("MFJ", "vanguard_dynamic"),
    returnRates: [[0, "0.06"]],
  },
  {
    key: "ws-h4",
    source: "hand-worksheet H4: single, two jobs all year, Step 2(c) on both",
    people: [
      { key: "A", name: "Kai", dateOfBirth: "1993-08-08", isPrimaryUser: true },
    ],
    jobs: [
      job("JA", "A", "Alpine Software", "2020-01-06", {
        salary: 120000,
        w4FilingStatus: "Single",
        w4Box2cChecked: true,
      }),
      job("JB", "A", "Beacon Analytics", "2023-03-01", {
        salary: 90000,
        payPeriod: "monthly",
        w4FilingStatus: "Single",
        w4Box2cChecked: true,
      }),
    ],
    deductions: [],
    accounts: [
      {
        key: "A401",
        // Balances invented.
        perf: {
          institution: "Alpine 401(k) plan",
          accountType: "401k",
          owner: "A",
          ownershipType: "individual",
          parentCategory: "Retirement",
        },
        snapshot: [{ owner: "A", taxType: "preTax", amount: "95000" }],
        contrib: [
          {
            job: "JA",
            person: "A",
            accountType: "401k",
            taxTreatment: "pre_tax",
            parentCategory: "Retirement",
            employerMatchType: "none",
            value: "13611.11",
            method: "fixed_annual",
          },
        ],
      },
      {
        key: "B401",
        perf: {
          institution: "Beacon 401(k) plan",
          accountType: "401k",
          owner: "A",
          ownershipType: "individual",
          parentCategory: "Retirement",
        },
        snapshot: [{ owner: "A", taxType: "preTax", amount: "40000" }],
        contrib: [
          {
            job: "JB",
            person: "A",
            accountType: "401k",
            taxTreatment: "pre_tax",
            parentCategory: "Retirement",
            employerMatchType: "none",
            value: "10888.89",
            method: "fixed_annual",
          },
        ],
      },
    ],
    cash: 15000,
    budget: budgetLines([
      ["Housing", "Rent", 2400],
      ["Food", "Groceries", 600],
      ["Lifestyle", "Misc", 800, false],
    ]),
    retirement: {
      A: { retirementAge: 55, endAge: 95, ssMonthly: "3300", ssStartAge: 70 },
    },
    settings: plainSettings("Single", "constant_percentage"),
    returnRates: [[0, "0.07"]],
  },
  {
    key: "ws-h5",
    source:
      "hand-worksheet H5: single early retiree, 52, brokerage only (case A spending)",
    people: [
      {
        key: "A",
        name: "Drew",
        dateOfBirth: "1974-05-20",
        isPrimaryUser: true,
      },
    ],
    jobs: [],
    deductions: [],
    accounts: [
      heldAccount(
        "ABRK",
        {
          institution: "Vanguard",
          accountType: "brokerage",
          owner: "A",
          ownershipType: "individual",
          parentCategory: "Retirement",
          costBasis: "1200000",
        },
        [{ owner: "A", taxType: "afterTax", amount: "2000000" }],
      ),
    ],
    cash: 0,
    budget: budgetLines([["Living", "Household spending", 6666.67]]),
    retirement: {
      A: { retirementAge: 52, endAge: 95, ssMonthly: "0", ssStartAge: 67 },
    },
    settings: ledgerSettings("Single", "0", "0", "0", ["brokerage"]),
    returnRates: [[0, "0"]],
  },
  {
    key: "ws-h6",
    source:
      "hand-worksheet H6 = screens-e2e C: retired couple, 75 and 72, Social Security and RMDs",
    people: [
      {
        key: "A",
        name: "Morgan",
        dateOfBirth: "1951-03-10",
        isPrimaryUser: true,
      },
      {
        key: "B",
        name: "Casey",
        dateOfBirth: "1954-08-22",
        isPrimaryUser: false,
      },
    ],
    jobs: [],
    deductions: [],
    accounts: [
      heldAccount(
        "AIRA",
        {
          institution: "Fidelity",
          accountType: "ira",
          owner: "A",
          ownershipType: "individual",
          parentCategory: "Retirement",
        },
        [
          { owner: "A", taxType: "preTax", amount: "900000" },
          { owner: "A", taxType: "taxFree", amount: "100000" },
        ],
      ),
      heldAccount(
        "BIRA",
        {
          institution: "Schwab",
          accountType: "ira",
          owner: "B",
          ownershipType: "individual",
          parentCategory: "Retirement",
        },
        [{ owner: "B", taxType: "preTax", amount: "300000" }],
      ),
      heldAccount(
        "JBRK",
        {
          institution: "Vanguard",
          accountType: "brokerage",
          owner: null,
          ownershipType: "joint",
          parentCategory: "Retirement",
          costBasis: "200000",
        },
        [{ owner: null, taxType: "afterTax", amount: "200000" }],
      ),
    ],
    cash: 30000,
    budget: budgetLines([
      ["Housing", "Housing", 2000],
      ["Food", "Food", 1000],
      ["Health", "Health and Medicare", 1200],
      ["Lifestyle", "Travel", 1000, false],
      ["Utilities", "Utilities", 400],
      ["Transportation", "Transport", 500],
      ["Lifestyle", "Misc", 566.67, false],
    ]),
    retirement: {
      A: {
        retirementAge: 65,
        endAge: 95,
        ssMonthly: "3166.67",
        ssStartAge: 67,
      },
      B: {
        retirementAge: 65,
        endAge: 95,
        ssMonthly: "1666.67",
        ssStartAge: 66,
      },
    },
    settings: plainSettings("MFJ", "fixed", flat),
    returnRates: [[0, "0"]],
  },
  {
    key: "ws-h6s",
    source:
      "hand-worksheet H6s: single widow, 75, Traditional IRA and Social Security",
    people: [
      {
        key: "A",
        name: "Frankie",
        dateOfBirth: "1951-05-05",
        isPrimaryUser: true,
      },
    ],
    jobs: [],
    deductions: [],
    accounts: [
      heldAccount(
        "AIRA",
        {
          institution: "Fidelity",
          accountType: "ira",
          owner: "A",
          ownershipType: "individual",
          parentCategory: "Retirement",
        },
        [{ owner: "A", taxType: "preTax", amount: "500000" }],
      ),
    ],
    cash: 10000,
    budget: budgetLines([["Living", "Household spending", 4166.67]]),
    retirement: {
      A: { retirementAge: 65, endAge: 95, ssMonthly: "2500", ssStartAge: 67 },
    },
    settings: plainSettings("Single", "rmd_spending", flat),
    returnRates: [[0, "0"]],
  },
  {
    key: "e2e-b",
    source:
      "screens-e2e B: two earners, bonus past the wage base, mortgage, joint brokerage",
    people: [
      {
        key: "A",
        name: "Jordan",
        dateOfBirth: "1984-02-20",
        isPrimaryUser: true,
      },
      {
        key: "B",
        name: "Riley",
        dateOfBirth: "1986-09-05",
        isPrimaryUser: false,
      },
    ],
    jobs: [
      job("JA", "A", "Contoso Energy", "2015-03-01", {
        salary: 200000,
        bonusPercent: 0.15,
        bonusMonth: 3,
        bonusDayOfMonth: 13,
        payWeek: "even",
        anchorPayDate: "2026-01-09",
        w4FilingStatus: "MFJ",
      }),
      job("JB", "B", "Fabrikam Health", "2018-08-01", {
        salary: 70000,
        payPeriod: "semimonthly",
        anchorPayDate: "2026-01-15",
        w4FilingStatus: "MFJ",
      }),
    ],
    deductions: [
      {
        job: "JA",
        deductionName: "Medical",
        isPretax: true,
        ficaExempt: true,
        perPeriod: "250",
      },
      {
        job: "JB",
        deductionName: "Dental",
        isPretax: true,
        ficaExempt: true,
        perPeriod: "20",
      },
    ],
    accounts: [
      {
        key: "A401",
        perf: {
          institution: "Contoso 401(k) plan",
          accountType: "401k",
          owner: "A",
          ownershipType: "individual",
          parentCategory: "Retirement",
        },
        snapshot: [{ owner: "A", taxType: "preTax", amount: "310000" }],
        contrib: [
          {
            job: "JA",
            person: "A",
            accountType: "401k",
            taxTreatment: "pre_tax",
            parentCategory: "Retirement",
            employerMatchType: "percent_of_contribution",
            employerMatchValue: "100",
            employerMaxMatchPct: "0.04",
            value: "8",
            method: "percent_of_salary",
          },
        ],
      },
      {
        key: "B401",
        perf: {
          institution: "Fabrikam 401(k) plan",
          accountType: "401k",
          owner: "B",
          ownershipType: "individual",
          parentCategory: "Retirement",
        },
        snapshot: [{ owner: "B", taxType: "preTax", amount: "95000" }],
        contrib: [
          {
            job: "JB",
            person: "B",
            accountType: "401k",
            taxTreatment: "pre_tax",
            parentCategory: "Retirement",
            employerMatchType: "percent_of_contribution",
            employerMatchValue: "50",
            employerMaxMatchPct: "0.06",
            value: "6",
            method: "percent_of_salary",
          },
        ],
      },
      {
        key: "AHSA",
        perf: {
          institution: "HealthEquity",
          accountType: "hsa",
          owner: "A",
          ownershipType: "individual",
          parentCategory: "Retirement",
        },
        snapshot: [{ owner: "A", taxType: "hsa", amount: "28000" }],
        contrib: [
          {
            job: "JA",
            person: "A",
            accountType: "hsa",
            taxTreatment: "hsa",
            parentCategory: "Retirement",
            hsaCoverageType: "family",
            isPayrollDeducted: true,
            employerMatchType: "none",
            value: "300",
            method: "fixed_per_period",
          },
        ],
      },
      heldAccount(
        "BROTH",
        {
          institution: "Vanguard",
          accountType: "ira",
          owner: "B",
          ownershipType: "individual",
          parentCategory: "Retirement",
        },
        [{ owner: "B", taxType: "taxFree", amount: "45000" }],
      ),
      {
        key: "JBRK",
        perf: {
          institution: "Schwab",
          accountType: "brokerage",
          owner: null,
          ownershipType: "joint",
          parentCategory: "Portfolio",
          costBasis: "100000",
        },
        snapshot: [{ owner: null, taxType: "afterTax", amount: "140000" }],
        contrib: [
          {
            job: null,
            person: null,
            ownership: "joint",
            accountType: "brokerage",
            taxTreatment: "after_tax",
            parentCategory: "Portfolio",
            employerMatchType: "none",
            value: "1000",
            method: "fixed_monthly",
          },
        ],
      },
    ],
    cash: 40000,
    mortgage: {
      name: "Home loan",
      isActive: true,
      principalAndInterest: "2955.44",
      interestRate: "0.0625",
      termYears: 30,
      originalLoanAmount: "480000",
      firstPaymentDate: "2022-06-01",
      propertyValuePurchase: "600000",
      propertyValueEstimated: "680000",
      usePurchaseOrEstimated: "estimated",
    },
    savingsGoals: [
      {
        name: "Emergency fund",
        targetAmount: "40000",
        isEmergencyFund: true,
        priority: 1,
      },
      {
        name: "New roof",
        targetAmount: "18000",
        targetDate: "2028-06-01",
        priority: 2,
      },
    ],
    budget: budgetLines([
      ["Food", "Grocery store", 1100],
      ["Housing", "Utilities", 350],
      ["Family", "Childcare", 1600],
      ["Transportation", "Cars and gas", 600],
      ["Insurance", "Auto and umbrella", 250],
      ["Lifestyle", "Dining out", 400, false],
      ["Lifestyle", "Travel", 500, false],
      ["Lifestyle", "Misc", 400, false],
    ]),
    retirement: {
      A: { retirementAge: 60, endAge: 95, ssMonthly: "3200", ssStartAge: 67 },
      B: { retirementAge: 60, endAge: 95, ssMonthly: "2200", ssStartAge: 67 },
    },
    settings: plainSettings("MFJ", "vpw"),
    returnRates: [[0, "0.07"]],
  },
  {
    key: "e2e-d",
    source: "screens-e2e D: early-retired couple, one IRA held in four parts",
    people: [
      { key: "A", name: "Sam", dateOfBirth: "1976-03-10", isPrimaryUser: true },
      {
        key: "B",
        name: "Alex",
        dateOfBirth: "1978-06-20",
        isPrimaryUser: false,
      },
    ],
    jobs: [],
    deductions: [],
    accounts: [
      heldAccount(
        "JIRA",
        {
          institution: "Schwab",
          accountType: "ira",
          owner: null,
          ownershipType: "joint",
          parentCategory: "Retirement",
        },
        [
          { owner: "A", taxType: "preTax", amount: "400000" },
          { owner: "A", taxType: "taxFree", amount: "120000" },
          { owner: "B", taxType: "preTax", amount: "250000" },
          { owner: "B", taxType: "taxFree", amount: "80000" },
        ],
      ),
      heldAccount(
        "JBRK",
        {
          institution: "Vanguard",
          accountType: "brokerage",
          owner: null,
          ownershipType: "joint",
          parentCategory: "Retirement",
          costBasis: "900000",
        },
        [{ owner: null, taxType: "afterTax", amount: "1500000" }],
      ),
      heldAccount(
        "AHSA",
        {
          institution: "Fidelity",
          accountType: "hsa",
          owner: "A",
          ownershipType: "individual",
          parentCategory: "Retirement",
        },
        [{ owner: "A", taxType: "hsa", amount: "40000" }],
      ),
    ],
    cash: 50000,
    budget: budgetLines([
      ["Housing", "Rent", 2600],
      ["Food", "Food", 1100],
      ["Health", "Marketplace premiums", 1300],
      ["Lifestyle", "Travel", 1200, false],
      ["Utilities", "Utilities", 300],
      ["Transportation", "Transport", 500],
      ["Lifestyle", "Misc", 500, false],
    ]),
    retirement: {
      A: { retirementAge: 48, endAge: 95, ssMonthly: "2400", ssStartAge: 67 },
      B: { retirementAge: 46, endAge: 95, ssMonthly: "1900", ssStartAge: 67 },
    },
    settings: plainSettings("MFJ", "endowment", flat),
    returnRates: [[0, "0"]],
  },
];
