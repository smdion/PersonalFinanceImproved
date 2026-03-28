import type { DemoProfile } from "../types";

export const recentlyRetiredProfile: DemoProfile = {
  slug: "recently-retired",
  name: "Recently Retired",
  description:
    "Retired couple, $5M portfolio, delaying Social Security to 70, navigating RMDs and the Roth conversion window.",
  keyStats: {
    income: "$0 (retired)",
    portfolioSize: "$5,000,000",
    savingsRate: "N/A",
  },

  people: [
    { name: "James", dateOfBirth: "1959-03-22", isPrimaryUser: true },
    { name: "Patricia", dateOfBirth: "1961-08-10", isPrimaryUser: false },
  ],

  // Both retired — jobs have end dates
  jobs: [
    {
      personName: "James",
      employerName: "Acme Corp",
      title: "VP of Operations",
      annualSalary: "210000",
      payPeriod: "semimonthly",
      payWeek: "na",
      startDate: "1995-06-01",
      anchorPayDate: null,
      endDate: "2024-12-31",
      bonusPercent: "0.12",
      bonusMonth: 3,
      w4FilingStatus: "MFJ",
    },
    {
      personName: "Patricia",
      employerName: "Lincoln High School",
      title: "History Teacher",
      annualSalary: "65000",
      payPeriod: "semimonthly",
      payWeek: "na",
      startDate: "1992-08-15",
      anchorPayDate: null,
      endDate: "2025-06-30",
      bonusPercent: "0",
      bonusMonth: null,
      w4FilingStatus: "MFJ",
    },
  ],

  budgetProfiles: [
    {
      name: "Retirement Budget",
      isActive: true,
      columnLabels: ["Lean", "Normal", "Travel Year"],
      columnMonths: null,
    },
  ],

  budgetItems: [
    // Housing — paid-off home
    {
      profileName: "Retirement Budget",
      category: "Housing",
      subcategory: "Property Tax",
      isEssential: true,
      amounts: [500, 500, 500],
    },
    {
      profileName: "Retirement Budget",
      category: "Housing",
      subcategory: "Homeowners Insurance",
      isEssential: true,
      amounts: [200, 200, 200],
    },
    {
      profileName: "Retirement Budget",
      category: "Housing",
      subcategory: "Utilities",
      isEssential: true,
      amounts: [200, 250, 250],
    },
    {
      profileName: "Retirement Budget",
      category: "Housing",
      subcategory: "Maintenance",
      isEssential: true,
      amounts: [200, 350, 350],
    },
    // Food
    {
      profileName: "Retirement Budget",
      category: "Food",
      subcategory: "Groceries",
      isEssential: true,
      amounts: [500, 650, 700],
    },
    {
      profileName: "Retirement Budget",
      category: "Food",
      subcategory: "Dining Out",
      isEssential: false,
      amounts: [100, 250, 400],
    },
    // Transportation — two paid-off cars
    {
      profileName: "Retirement Budget",
      category: "Transportation",
      subcategory: "Gas & Maintenance",
      isEssential: true,
      amounts: [200, 300, 350],
    },
    {
      profileName: "Retirement Budget",
      category: "Transportation",
      subcategory: "Insurance",
      isEssential: true,
      amounts: [180, 180, 180],
    },
    // Health — Medicare + supplement
    {
      profileName: "Retirement Budget",
      category: "Health",
      subcategory: "Medicare Premiums",
      isEssential: true,
      amounts: [400, 400, 400],
    },
    {
      profileName: "Retirement Budget",
      category: "Health",
      subcategory: "Prescriptions & Copays",
      isEssential: true,
      amounts: [100, 200, 200],
    },
    // Personal
    {
      profileName: "Retirement Budget",
      category: "Personal",
      subcategory: "Travel",
      isEssential: false,
      amounts: [300, 800, 2000],
    },
    {
      profileName: "Retirement Budget",
      category: "Personal",
      subcategory: "Hobbies & Golf",
      isEssential: false,
      amounts: [100, 250, 350],
    },
    {
      profileName: "Retirement Budget",
      category: "Personal",
      subcategory: "Subscriptions",
      isEssential: false,
      amounts: [30, 60, 60],
    },
    // Giving
    {
      profileName: "Retirement Budget",
      category: "Giving",
      subcategory: "Charitable",
      isEssential: false,
      amounts: [200, 400, 600],
    },
    {
      profileName: "Retirement Budget",
      category: "Giving",
      subcategory: "Family Gifts",
      isEssential: false,
      amounts: [100, 250, 500],
    },
  ],

  savingsGoals: [
    {
      name: "Emergency Fund",
      targetAmount: null,
      targetMonths: 12,
      priority: 1,
      isEmergencyFund: true,
      monthlyContribution: "0",
      allocationPercent: null,
    },
    {
      name: "Home Repair Reserve",
      targetAmount: "25000",
      targetMonths: null,
      priority: 2,
      isEmergencyFund: false,
      monthlyContribution: "0",
      allocationPercent: null,
    },
  ],

  savingsMonthly: [
    { goalName: "Emergency Fund", monthDate: "2025-04-01", balance: "85000" },
    { goalName: "Emergency Fund", monthDate: "2025-05-01", balance: "85000" },
    { goalName: "Emergency Fund", monthDate: "2025-06-01", balance: "85000" },
    { goalName: "Emergency Fund", monthDate: "2025-07-01", balance: "85000" },
    { goalName: "Emergency Fund", monthDate: "2025-08-01", balance: "85000" },
    { goalName: "Emergency Fund", monthDate: "2025-09-01", balance: "85000" },
    { goalName: "Emergency Fund", monthDate: "2025-10-01", balance: "85000" },
    { goalName: "Emergency Fund", monthDate: "2025-11-01", balance: "85000" },
    { goalName: "Emergency Fund", monthDate: "2025-12-01", balance: "85000" },
    { goalName: "Emergency Fund", monthDate: "2026-01-01", balance: "85000" },
    { goalName: "Emergency Fund", monthDate: "2026-02-01", balance: "85000" },
    { goalName: "Emergency Fund", monthDate: "2026-03-01", balance: "85000" },
    {
      goalName: "Home Repair Reserve",
      monthDate: "2025-04-01",
      balance: "18000",
    },
    {
      goalName: "Home Repair Reserve",
      monthDate: "2025-05-01",
      balance: "18000",
    },
    {
      goalName: "Home Repair Reserve",
      monthDate: "2025-06-01",
      balance: "18000",
    },
    {
      goalName: "Home Repair Reserve",
      monthDate: "2025-07-01",
      balance: "18000",
    },
    {
      goalName: "Home Repair Reserve",
      monthDate: "2025-08-01",
      balance: "18000",
    },
    {
      goalName: "Home Repair Reserve",
      monthDate: "2025-09-01",
      balance: "18000",
    },
    {
      goalName: "Home Repair Reserve",
      monthDate: "2025-10-01",
      balance: "15000",
    },
    {
      goalName: "Home Repair Reserve",
      monthDate: "2025-11-01",
      balance: "15000",
    },
    {
      goalName: "Home Repair Reserve",
      monthDate: "2025-12-01",
      balance: "15000",
    },
    {
      goalName: "Home Repair Reserve",
      monthDate: "2026-01-01",
      balance: "15000",
    },
    {
      goalName: "Home Repair Reserve",
      monthDate: "2026-02-01",
      balance: "15000",
    },
    {
      goalName: "Home Repair Reserve",
      monthDate: "2026-03-01",
      balance: "15000",
    },
  ],

  // No active contributions — both retired. Empty array.
  contributionAccounts: [],

  portfolioSnapshots: [{ snapshotDate: "2026-03-01" }],

  portfolioAccounts: [
    // James — 401k (not yet rolled over from last employer)
    {
      institution: "Fidelity",
      accountType: "401k",
      taxType: "preTax",
      amount: "1800000",
      label: null,
      ownerPersonName: "James",
      perfAccountLabel: "James 401k",
    },
    // James — Rollover IRA (from prior employer)
    {
      institution: "Fidelity",
      accountType: "ira",
      taxType: "preTax",
      amount: "1000000",
      label: "Rollover",
      ownerPersonName: "James",
      perfAccountLabel: "James Rollover IRA",
    },
    // James — Roth IRA
    {
      institution: "Fidelity",
      accountType: "ira",
      taxType: "taxFree",
      amount: "350000",
      label: null,
      ownerPersonName: "James",
      perfAccountLabel: "James Roth IRA",
    },
    // Patricia — 403b (teacher retirement plan)
    {
      institution: "Vanguard",
      accountType: "403b",
      taxType: "preTax",
      amount: "500000",
      label: null,
      ownerPersonName: "Patricia",
      perfAccountLabel: "Patricia 403b",
    },
    // Patricia — Rollover IRA
    {
      institution: "Vanguard",
      accountType: "ira",
      taxType: "preTax",
      amount: "200000",
      label: "Rollover",
      ownerPersonName: "Patricia",
      perfAccountLabel: "Patricia Rollover IRA",
    },
    // Patricia — Roth IRA
    {
      institution: "Vanguard",
      accountType: "ira",
      taxType: "taxFree",
      amount: "150000",
      label: null,
      ownerPersonName: "Patricia",
      perfAccountLabel: "Patricia Roth IRA",
    },
    // Joint — Taxable brokerage
    {
      institution: "Schwab",
      accountType: "brokerage",
      taxType: "afterTax",
      amount: "1000000",
      label: "Joint Taxable",
      ownerPersonName: "James",
      parentCategory: "Retirement",
      perfAccountLabel: "Joint Brokerage",
    },
  ],

  performanceAccounts: [
    {
      institution: "Fidelity",
      accountType: "401k",
      accountLabel: "James 401k",
      ownershipType: "individual",
      parentCategory: "Retirement",
      label: null,
      isActive: true,
      ownerPersonName: "James",
    },
    {
      institution: "Fidelity",
      accountType: "ira",
      accountLabel: "James Rollover IRA",
      ownershipType: "individual",
      parentCategory: "Retirement",
      label: "Rollover",
      isActive: true,
      ownerPersonName: "James",
    },
    {
      institution: "Fidelity",
      accountType: "ira",
      accountLabel: "James Roth IRA",
      ownershipType: "individual",
      parentCategory: "Retirement",
      label: null,
      isActive: true,
      ownerPersonName: "James",
    },
    {
      institution: "Vanguard",
      accountType: "403b",
      accountLabel: "Patricia 403b",
      ownershipType: "individual",
      parentCategory: "Retirement",
      label: null,
      isActive: true,
      ownerPersonName: "Patricia",
    },
    {
      institution: "Vanguard",
      accountType: "ira",
      accountLabel: "Patricia Rollover IRA",
      ownershipType: "individual",
      parentCategory: "Retirement",
      label: "Rollover",
      isActive: true,
      ownerPersonName: "Patricia",
    },
    {
      institution: "Vanguard",
      accountType: "ira",
      accountLabel: "Patricia Roth IRA",
      ownershipType: "individual",
      parentCategory: "Retirement",
      label: null,
      isActive: true,
      ownerPersonName: "Patricia",
    },
    {
      institution: "Schwab",
      accountType: "brokerage",
      accountLabel: "Joint Brokerage",
      ownershipType: "joint",
      parentCategory: "Retirement",
      label: "Joint Taxable",
      isActive: true,
      ownerPersonName: "James",
    },
  ],

  // 10 years of aggregated annual performance (2016–2025)
  annualPerformance: [
    {
      category: "401k/IRA",
      year: 2016,
      beginningBalance: "2100000",
      totalContributions: "85000",
      yearlyGainLoss: "252000",
      endingBalance: "2437000",
      annualReturnPct: "11.5",
      employerContributions: "18000",
      fees: "4200",
      lifetimeGains: "800000",
      lifetimeContributions: "1200000",
      lifetimeMatch: "280000",
    },
    {
      category: "401k/IRA",
      year: 2017,
      beginningBalance: "2437000",
      totalContributions: "88000",
      yearlyGainLoss: "510000",
      endingBalance: "3035000",
      annualReturnPct: "20.2",
      employerContributions: "19000",
      fees: "4800",
      lifetimeGains: "1310000",
      lifetimeContributions: "1288000",
      lifetimeMatch: "299000",
    },
    {
      category: "401k/IRA",
      year: 2018,
      beginningBalance: "3035000",
      totalContributions: "90000",
      yearlyGainLoss: "-137000",
      endingBalance: "2988000",
      annualReturnPct: "-4.4",
      employerContributions: "19500",
      fees: "5100",
      lifetimeGains: "1173000",
      lifetimeContributions: "1378000",
      lifetimeMatch: "318500",
    },
    {
      category: "401k/IRA",
      year: 2019,
      beginningBalance: "2988000",
      totalContributions: "92000",
      yearlyGainLoss: "868000",
      endingBalance: "3948000",
      annualReturnPct: "28.2",
      employerContributions: "20000",
      fees: "5400",
      lifetimeGains: "2041000",
      lifetimeContributions: "1470000",
      lifetimeMatch: "338500",
    },
    {
      category: "401k/IRA",
      year: 2020,
      beginningBalance: "3948000",
      totalContributions: "94000",
      yearlyGainLoss: "690000",
      endingBalance: "4732000",
      annualReturnPct: "17.1",
      employerContributions: "20500",
      fees: "5700",
      lifetimeGains: "2731000",
      lifetimeContributions: "1564000",
      lifetimeMatch: "359000",
    },
    {
      category: "401k/IRA",
      year: 2021,
      beginningBalance: "4732000",
      totalContributions: "96000",
      yearlyGainLoss: "1225000",
      endingBalance: "6053000",
      annualReturnPct: "25.4",
      employerContributions: "21000",
      fees: "6100",
      lifetimeGains: "3956000",
      lifetimeContributions: "1660000",
      lifetimeMatch: "380000",
    },
    {
      category: "401k/IRA",
      year: 2022,
      beginningBalance: "6053000",
      totalContributions: "98000",
      yearlyGainLoss: "-1145000",
      endingBalance: "5006000",
      annualReturnPct: "-18.6",
      employerContributions: "21500",
      fees: "6400",
      lifetimeGains: "2811000",
      lifetimeContributions: "1758000",
      lifetimeMatch: "401500",
    },
    {
      category: "401k/IRA",
      year: 2023,
      beginningBalance: "5006000",
      totalContributions: "100000",
      yearlyGainLoss: "1280000",
      endingBalance: "6386000",
      annualReturnPct: "25.1",
      employerContributions: "22000",
      fees: "6700",
      lifetimeGains: "4091000",
      lifetimeContributions: "1858000",
      lifetimeMatch: "423500",
    },
    {
      category: "401k/IRA",
      year: 2024,
      beginningBalance: "6386000",
      totalContributions: "65000",
      yearlyGainLoss: "510000",
      endingBalance: "6961000",
      annualReturnPct: "7.9",
      employerContributions: "12000",
      fees: "5200",
      lifetimeGains: "4601000",
      lifetimeContributions: "1923000",
      lifetimeMatch: "435500",
    },
    {
      category: "401k/IRA",
      year: 2025,
      beginningBalance: "6961000",
      totalContributions: "0",
      yearlyGainLoss: "-261000",
      endingBalance: "6700000",
      annualReturnPct: "-3.8",
      employerContributions: "0",
      fees: "4800",
      lifetimeGains: "4340000",
      lifetimeContributions: "1923000",
      lifetimeMatch: "435500",
    },
  ],

  retirementSettings: {
    personName: "James",
    retirementAge: 65,
    endAge: 95,
    returnAfterRetirement: "0.05",
    annualInflation: "0.025",
    salaryAnnualIncrease: "0",
    withdrawalRate: "0.035",
    withdrawalStrategy: "rmd_spending",
    socialSecurityMonthly: "3500",
    ssStartAge: 70,
  },

  perPersonRetirementSettings: [
    {
      personName: "Patricia",
      retirementAge: 63,
      socialSecurityMonthly: "1800",
      ssStartAge: 70,
    },
  ],

  returnRates: [
    { age: 65, rateOfReturn: "0.06" },
    { age: 70, rateOfReturn: "0.055" },
    { age: 75, rateOfReturn: "0.05" },
    { age: 80, rateOfReturn: "0.045" },
    { age: 85, rateOfReturn: "0.04" },
  ],

  // Paid-off home — no active mortgage
  mortgageLoans: [
    {
      name: "Primary Residence",
      isActive: false,
      principalAndInterest: "1450",
      interestRate: "0.0425",
      termYears: 30,
      originalLoanAmount: "240000",
      firstPaymentDate: "2000-04-01",
      propertyValuePurchase: "320000",
      propertyValueEstimated: "585000",
    },
  ],

  // 10 years of per-account performance history (7 accounts)
  accountPerformance: [
    // --- James 401k (employer plan, contributions stopped at retirement 2024) ---
    ...[2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025].map(
      (year) => {
        const data: Record<
          number,
          {
            begin: string;
            contrib: string;
            gain: string;
            end: string;
            ret: string;
            match: string;
          }
        > = {
          2016: {
            begin: "900000",
            contrib: "37000",
            gain: "108000",
            end: "1045000",
            ret: "11.5",
            match: "18000",
          },
          2017: {
            begin: "1045000",
            contrib: "38000",
            gain: "219000",
            end: "1302000",
            ret: "20.2",
            match: "19000",
          },
          2018: {
            begin: "1302000",
            contrib: "39000",
            gain: "-59000",
            end: "1282000",
            ret: "-4.4",
            match: "19500",
          },
          2019: {
            begin: "1282000",
            contrib: "40000",
            gain: "373000",
            end: "1695000",
            ret: "28.2",
            match: "20000",
          },
          2020: {
            begin: "1695000",
            contrib: "41000",
            gain: "297000",
            end: "2033000",
            ret: "17.1",
            match: "20500",
          },
          2021: {
            begin: "2033000",
            contrib: "42000",
            gain: "527000",
            end: "2602000",
            ret: "25.4",
            match: "21000",
          },
          2022: {
            begin: "2602000",
            contrib: "43000",
            gain: "-491000",
            end: "2154000",
            ret: "-18.6",
            match: "21500",
          },
          2023: {
            begin: "2154000",
            contrib: "44000",
            gain: "551000",
            end: "2749000",
            ret: "25.1",
            match: "22000",
          },
          2024: {
            begin: "2749000",
            contrib: "20000",
            gain: "222000",
            end: "2991000",
            ret: "7.9",
            match: "12000",
          },
          2025: {
            begin: "2991000",
            contrib: "0",
            gain: "-117000",
            end: "2874000",
            ret: "-3.8",
            match: "0",
          },
        };
        const d = data[year]!;
        return {
          year,
          institution: "Fidelity",
          accountLabel: "James 401k",
          ownerPersonName: "James",
          beginningBalance: d.begin,
          totalContributions: d.contrib,
          yearlyGainLoss: d.gain,
          endingBalance: d.end,
          annualReturnPct: d.ret,
          employerContributions: d.match,
          fees: year <= 2023 ? "1800" : year === 2024 ? "1400" : "1000",
          parentCategory: "Retirement",
          perfAccountLabel: "James 401k",
        };
      },
    ),

    // --- James Rollover IRA (from prior employer, no contributions) ---
    ...[2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025].map(
      (year) => {
        const data: Record<
          number,
          {
            begin: string;
            gain: string;
            end: string;
            ret: string;
          }
        > = {
          2016: {
            begin: "500000",
            gain: "58000",
            end: "558000",
            ret: "11.6",
          },
          2017: {
            begin: "558000",
            gain: "113000",
            end: "671000",
            ret: "20.3",
          },
          2018: {
            begin: "671000",
            gain: "-30000",
            end: "641000",
            ret: "-4.5",
          },
          2019: {
            begin: "641000",
            gain: "181000",
            end: "822000",
            ret: "28.2",
          },
          2020: {
            begin: "822000",
            gain: "141000",
            end: "963000",
            ret: "17.2",
          },
          2021: {
            begin: "963000",
            gain: "244000",
            end: "1207000",
            ret: "25.3",
          },
          2022: {
            begin: "1207000",
            gain: "-224000",
            end: "983000",
            ret: "-18.6",
          },
          2023: {
            begin: "983000",
            gain: "247000",
            end: "1230000",
            ret: "25.1",
          },
          2024: {
            begin: "1230000",
            gain: "97000",
            end: "1327000",
            ret: "7.9",
          },
          2025: {
            begin: "1327000",
            gain: "-50000",
            end: "1277000",
            ret: "-3.8",
          },
        };
        const d = data[year]!;
        return {
          year,
          institution: "Fidelity",
          accountLabel: "James Rollover IRA",
          ownerPersonName: "James",
          beginningBalance: d.begin,
          totalContributions: "0",
          yearlyGainLoss: d.gain,
          endingBalance: d.end,
          annualReturnPct: d.ret,
          employerContributions: "0",
          fees: year <= 2023 ? "1000" : year === 2024 ? "700" : "600",
          parentCategory: "Retirement",
          perfAccountLabel: "James Rollover IRA",
        };
      },
    ),

    // --- James Roth IRA (smaller allocation) ---
    ...[2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025].map(
      (year) => {
        const data: Record<
          number,
          {
            begin: string;
            contrib: string;
            gain: string;
            end: string;
            ret: string;
          }
        > = {
          2016: {
            begin: "120000",
            contrib: "7000",
            gain: "15000",
            end: "142000",
            ret: "11.8",
          },
          2017: {
            begin: "142000",
            contrib: "7000",
            gain: "30000",
            end: "179000",
            ret: "20.1",
          },
          2018: {
            begin: "179000",
            contrib: "8000",
            gain: "-8000",
            end: "179000",
            ret: "-4.3",
          },
          2019: {
            begin: "179000",
            contrib: "8000",
            gain: "53000",
            end: "240000",
            ret: "28.3",
          },
          2020: {
            begin: "240000",
            contrib: "8500",
            gain: "43000",
            end: "291500",
            ret: "17.3",
          },
          2021: {
            begin: "291500",
            contrib: "8500",
            gain: "76000",
            end: "376000",
            ret: "25.3",
          },
          2022: {
            begin: "376000",
            contrib: "9000",
            gain: "-72000",
            end: "313000",
            ret: "-18.7",
          },
          2023: {
            begin: "313000",
            contrib: "9000",
            gain: "81000",
            end: "403000",
            ret: "25.2",
          },
          2024: {
            begin: "403000",
            contrib: "5000",
            gain: "32000",
            end: "440000",
            ret: "7.8",
          },
          2025: {
            begin: "440000",
            contrib: "0",
            gain: "-17000",
            end: "423000",
            ret: "-3.9",
          },
        };
        const d = data[year]!;
        return {
          year,
          institution: "Fidelity",
          accountLabel: "James Roth IRA",
          ownerPersonName: "James",
          beginningBalance: d.begin,
          totalContributions: d.contrib,
          yearlyGainLoss: d.gain,
          endingBalance: d.end,
          annualReturnPct: d.ret,
          employerContributions: "0",
          fees: "0",
          parentCategory: "Retirement",
          perfAccountLabel: "James Roth IRA",
        };
      },
    ),

    // --- Patricia 403b (teacher retirement, contributions stopped at retirement) ---
    ...[2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025].map(
      (year) => {
        const data: Record<
          number,
          {
            begin: string;
            contrib: string;
            gain: string;
            end: string;
            ret: string;
          }
        > = {
          2016: {
            begin: "230000",
            contrib: "9000",
            gain: "28000",
            end: "267000",
            ret: "11.7",
          },
          2017: {
            begin: "267000",
            contrib: "9500",
            gain: "56000",
            end: "332500",
            ret: "20.3",
          },
          2018: {
            begin: "332500",
            contrib: "9500",
            gain: "-15000",
            end: "327000",
            ret: "-4.4",
          },
          2019: {
            begin: "327000",
            contrib: "10000",
            gain: "95000",
            end: "432000",
            ret: "28.2",
          },
          2020: {
            begin: "432000",
            contrib: "10000",
            gain: "76000",
            end: "518000",
            ret: "17.2",
          },
          2021: {
            begin: "518000",
            contrib: "10000",
            gain: "134000",
            end: "662000",
            ret: "25.4",
          },
          2022: {
            begin: "662000",
            contrib: "10500",
            gain: "-125000",
            end: "547500",
            ret: "-18.6",
          },
          2023: {
            begin: "547500",
            contrib: "11000",
            gain: "140000",
            end: "698500",
            ret: "25.1",
          },
          2024: {
            begin: "698500",
            contrib: "15000",
            gain: "56000",
            end: "769500",
            ret: "7.9",
          },
          2025: {
            begin: "769500",
            contrib: "0",
            gain: "-29000",
            end: "740500",
            ret: "-3.8",
          },
        };
        const d = data[year]!;
        return {
          year,
          institution: "Vanguard",
          accountLabel: "Patricia 403b",
          ownerPersonName: "Patricia",
          beginningBalance: d.begin,
          totalContributions: d.contrib,
          yearlyGainLoss: d.gain,
          endingBalance: d.end,
          annualReturnPct: d.ret,
          employerContributions: "0",
          fees: year <= 2023 ? "650" : year === 2024 ? "500" : "400",
          parentCategory: "Retirement",
          perfAccountLabel: "Patricia 403b",
        };
      },
    ),

    // --- Patricia Rollover IRA (smaller, from prior position) ---
    ...[2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025].map(
      (year) => {
        const data: Record<
          number,
          {
            begin: string;
            gain: string;
            end: string;
            ret: string;
          }
        > = {
          2016: {
            begin: "90000",
            gain: "10000",
            end: "100000",
            ret: "11.1",
          },
          2017: {
            begin: "100000",
            gain: "20000",
            end: "120000",
            ret: "20.0",
          },
          2018: {
            begin: "120000",
            gain: "-5000",
            end: "115000",
            ret: "-4.2",
          },
          2019: {
            begin: "115000",
            gain: "33000",
            end: "148000",
            ret: "28.7",
          },
          2020: {
            begin: "148000",
            gain: "25000",
            end: "173000",
            ret: "16.9",
          },
          2021: {
            begin: "173000",
            gain: "44000",
            end: "217000",
            ret: "25.4",
          },
          2022: {
            begin: "217000",
            gain: "-40000",
            end: "177000",
            ret: "-18.4",
          },
          2023: {
            begin: "177000",
            gain: "44000",
            end: "221000",
            ret: "24.9",
          },
          2024: {
            begin: "221000",
            gain: "18000",
            end: "239000",
            ret: "8.1",
          },
          2025: {
            begin: "239000",
            gain: "-9000",
            end: "230000",
            ret: "-3.8",
          },
        };
        const d = data[year]!;
        return {
          year,
          institution: "Vanguard",
          accountLabel: "Patricia Rollover IRA",
          ownerPersonName: "Patricia",
          beginningBalance: d.begin,
          totalContributions: "0",
          yearlyGainLoss: d.gain,
          endingBalance: d.end,
          annualReturnPct: d.ret,
          employerContributions: "0",
          fees: year <= 2023 ? "250" : year === 2024 ? "200" : "100",
          parentCategory: "Retirement",
          perfAccountLabel: "Patricia Rollover IRA",
        };
      },
    ),

    // --- Patricia Roth IRA (smaller allocation) ---
    ...[2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025].map(
      (year) => {
        const data: Record<
          number,
          {
            begin: string;
            contrib: string;
            gain: string;
            end: string;
            ret: string;
          }
        > = {
          2016: {
            begin: "52000",
            contrib: "3500",
            gain: "6500",
            end: "62000",
            ret: "11.7",
          },
          2017: {
            begin: "62000",
            contrib: "3500",
            gain: "13000",
            end: "78500",
            ret: "19.8",
          },
          2018: {
            begin: "78500",
            contrib: "3500",
            gain: "-3500",
            end: "78500",
            ret: "-4.3",
          },
          2019: {
            begin: "78500",
            contrib: "4000",
            gain: "23000",
            end: "105500",
            ret: "27.9",
          },
          2020: {
            begin: "105500",
            contrib: "4000",
            gain: "19000",
            end: "128500",
            ret: "17.4",
          },
          2021: {
            begin: "128500",
            contrib: "4500",
            gain: "34000",
            end: "167000",
            ret: "25.6",
          },
          2022: {
            begin: "167000",
            contrib: "4500",
            gain: "-32000",
            end: "139500",
            ret: "-18.6",
          },
          2023: {
            begin: "139500",
            contrib: "5000",
            gain: "36000",
            end: "180500",
            ret: "24.9",
          },
          2024: {
            begin: "180500",
            contrib: "4500",
            gain: "15000",
            end: "200000",
            ret: "8.1",
          },
          2025: {
            begin: "200000",
            contrib: "0",
            gain: "-8000",
            end: "192000",
            ret: "-4.0",
          },
        };
        const d = data[year]!;
        return {
          year,
          institution: "Vanguard",
          accountLabel: "Patricia Roth IRA",
          ownerPersonName: "Patricia",
          beginningBalance: d.begin,
          totalContributions: d.contrib,
          yearlyGainLoss: d.gain,
          endingBalance: d.end,
          annualReturnPct: d.ret,
          employerContributions: "0",
          fees: "0",
          parentCategory: "Retirement",
          perfAccountLabel: "Patricia Roth IRA",
        };
      },
    ),

    // --- Joint Brokerage (larger allocation) ---
    ...[2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025].map(
      (year) => {
        const data: Record<
          number,
          {
            begin: string;
            contrib: string;
            gain: string;
            end: string;
            ret: string;
          }
        > = {
          2016: {
            begin: "160000",
            contrib: "32000",
            gain: "19000",
            end: "211000",
            ret: "9.9",
          },
          2017: {
            begin: "211000",
            contrib: "32000",
            gain: "37000",
            end: "280000",
            ret: "15.2",
          },
          2018: {
            begin: "280000",
            contrib: "32000",
            gain: "-9000",
            end: "303000",
            ret: "-2.9",
          },
          2019: {
            begin: "303000",
            contrib: "32000",
            gain: "60000",
            end: "395000",
            ret: "17.9",
          },
          2020: {
            begin: "395000",
            contrib: "40000",
            gain: "45000",
            end: "480000",
            ret: "10.3",
          },
          2021: {
            begin: "480000",
            contrib: "48000",
            gain: "83000",
            end: "611000",
            ret: "15.7",
          },
          2022: {
            begin: "611000",
            contrib: "53000",
            gain: "-78000",
            end: "586000",
            ret: "-11.7",
          },
          2023: {
            begin: "586000",
            contrib: "60000",
            gain: "82000",
            end: "728000",
            ret: "12.7",
          },
          2024: {
            begin: "728000",
            contrib: "67000",
            gain: "25000",
            end: "820000",
            ret: "3.1",
          },
          2025: {
            begin: "820000",
            contrib: "0",
            gain: "-6000",
            end: "814000",
            ret: "-0.7",
          },
        };
        const d = data[year]!;
        return {
          year,
          institution: "Schwab",
          accountLabel: "Joint Brokerage",
          ownerPersonName: "James",
          beginningBalance: d.begin,
          totalContributions: d.contrib,
          yearlyGainLoss: d.gain,
          endingBalance: d.end,
          annualReturnPct: d.ret,
          employerContributions: "0",
          fees: year <= 2021 ? "250" : "400",
          parentCategory: "Retirement",
          perfAccountLabel: "Joint Brokerage",
        };
      },
    ),

    // 2026 YTD (Q1) — all 7 accounts
    {
      year: 2026,
      institution: "Fidelity",
      accountLabel: "James 401k",
      ownerPersonName: "James",
      beginningBalance: "2874000",
      totalContributions: "0",
      yearlyGainLoss: "-74000",
      endingBalance: "1800000",
      annualReturnPct: "-2.6",
      employerContributions: "0",
      fees: "250",
      parentCategory: "Retirement",
      perfAccountLabel: "James 401k",
    },
    {
      year: 2026,
      institution: "Fidelity",
      accountLabel: "James Rollover IRA",
      ownerPersonName: "James",
      beginningBalance: "1277000",
      totalContributions: "0",
      yearlyGainLoss: "-37000",
      endingBalance: "1000000",
      annualReturnPct: "-2.9",
      employerContributions: "0",
      fees: "150",
      parentCategory: "Retirement",
      perfAccountLabel: "James Rollover IRA",
    },
    {
      year: 2026,
      institution: "Fidelity",
      accountLabel: "James Roth IRA",
      ownerPersonName: "James",
      beginningBalance: "423000",
      totalContributions: "0",
      yearlyGainLoss: "-13000",
      endingBalance: "350000",
      annualReturnPct: "-3.1",
      employerContributions: "0",
      fees: "0",
      parentCategory: "Retirement",
      perfAccountLabel: "James Roth IRA",
    },
    {
      year: 2026,
      institution: "Vanguard",
      accountLabel: "Patricia 403b",
      ownerPersonName: "Patricia",
      beginningBalance: "740500",
      totalContributions: "0",
      yearlyGainLoss: "-15500",
      endingBalance: "500000",
      annualReturnPct: "-2.1",
      employerContributions: "0",
      fees: "100",
      parentCategory: "Retirement",
      perfAccountLabel: "Patricia 403b",
    },
    {
      year: 2026,
      institution: "Vanguard",
      accountLabel: "Patricia Rollover IRA",
      ownerPersonName: "Patricia",
      beginningBalance: "230000",
      totalContributions: "0",
      yearlyGainLoss: "-5000",
      endingBalance: "200000",
      annualReturnPct: "-2.2",
      employerContributions: "0",
      fees: "25",
      parentCategory: "Retirement",
      perfAccountLabel: "Patricia Rollover IRA",
    },
    {
      year: 2026,
      institution: "Vanguard",
      accountLabel: "Patricia Roth IRA",
      ownerPersonName: "Patricia",
      beginningBalance: "192000",
      totalContributions: "0",
      yearlyGainLoss: "-4000",
      endingBalance: "150000",
      annualReturnPct: "-2.1",
      employerContributions: "0",
      fees: "0",
      parentCategory: "Retirement",
      perfAccountLabel: "Patricia Roth IRA",
    },
    {
      year: 2026,
      institution: "Schwab",
      accountLabel: "Joint Brokerage",
      ownerPersonName: "James",
      beginningBalance: "814000",
      totalContributions: "0",
      yearlyGainLoss: "-14000",
      endingBalance: "1000000",
      annualReturnPct: "-1.7",
      employerContributions: "0",
      fees: "100",
      parentCategory: "Retirement",
      perfAccountLabel: "Joint Brokerage",
    },
  ],

  otherAssetItems: [
    { name: "Toyota Camry", year: 2024, value: "18000", note: "2021 model" },
    { name: "Toyota Camry", year: 2025, value: "15000", note: "Depreciation" },
    {
      name: "Honda CR-V",
      year: 2024,
      value: "25000",
      note: "2022 model",
    },
    { name: "Honda CR-V", year: 2025, value: "22000", note: "Depreciation" },
  ],

  propertyTaxes: [
    {
      loanName: "Primary Residence",
      year: 2022,
      assessedValue: "520000",
      taxAmount: "5800",
      note: null,
    },
    {
      loanName: "Primary Residence",
      year: 2023,
      assessedValue: "545000",
      taxAmount: "6100",
      note: null,
    },
    {
      loanName: "Primary Residence",
      year: 2024,
      assessedValue: "565000",
      taxAmount: "6350",
      note: null,
    },
    {
      loanName: "Primary Residence",
      year: 2025,
      assessedValue: "585000",
      taxAmount: "6550",
      note: null,
    },
  ],

  homeImprovements: [
    { year: 2020, description: "Kitchen remodel", cost: "35000" },
    { year: 2022, description: "New roof", cost: "18000" },
    { year: 2024, description: "Bathroom renovation", cost: "12000" },
  ],

  netWorthAnnual: [
    {
      yearEndDate: "2016-12-31",
      grossIncome: "275000",
      combinedAgi: "230000",
      cash: "45000",
      houseValue: "380000",
      retirementTotal: "2301500",
      portfolioTotal: "2459500",
      mortgageBalance: "155000",
    },
    {
      yearEndDate: "2017-12-31",
      grossIncome: "280000",
      combinedAgi: "235000",
      cash: "50000",
      houseValue: "400000",
      retirementTotal: "2870000",
      portfolioTotal: "3080000",
      mortgageBalance: "142000",
    },
    {
      yearEndDate: "2018-12-31",
      grossIncome: "285000",
      combinedAgi: "240000",
      cash: "55000",
      houseValue: "410000",
      retirementTotal: "2828100",
      portfolioTotal: "3055100",
      mortgageBalance: "128000",
    },
    {
      yearEndDate: "2019-12-31",
      grossIncome: "290000",
      combinedAgi: "245000",
      cash: "60000",
      houseValue: "430000",
      retirementTotal: "3742100",
      portfolioTotal: "4038100",
      mortgageBalance: "113000",
    },
    {
      yearEndDate: "2020-12-31",
      grossIncome: "275000",
      combinedAgi: "240000",
      cash: "65000",
      houseValue: "445000",
      retirementTotal: "4491200",
      portfolioTotal: "4851200",
      mortgageBalance: "97000",
    },
    {
      yearEndDate: "2021-12-31",
      grossIncome: "290000",
      combinedAgi: "250000",
      cash: "70000",
      houseValue: "480000",
      retirementTotal: "5749700",
      portfolioTotal: "6207700",
      mortgageBalance: "80000",
    },
    {
      yearEndDate: "2022-12-31",
      grossIncome: "285000",
      combinedAgi: "245000",
      cash: "80000",
      houseValue: "520000",
      retirementTotal: "4761200",
      portfolioTotal: "5200200",
      mortgageBalance: "62000",
    },
    {
      yearEndDate: "2023-12-31",
      grossIncome: "290000",
      combinedAgi: "248000",
      cash: "85000",
      houseValue: "545000",
      retirementTotal: "6079600",
      portfolioTotal: "6624600",
      mortgageBalance: "42000",
    },
    {
      yearEndDate: "2024-12-31",
      grossIncome: "210000",
      combinedAgi: "195000",
      cash: "90000",
      houseValue: "565000",
      retirementTotal: "6636100",
      portfolioTotal: "7250100",
      mortgageBalance: "0",
    },
    {
      yearEndDate: "2025-12-31",
      grossIncome: "32500",
      combinedAgi: "30000",
      cash: "100000",
      houseValue: "585000",
      retirementTotal: "6379200",
      portfolioTotal: "6989200",
      mortgageBalance: "0",
    },
  ],

  appSettings: [
    { key: "budget_active_column", value: 1 },
    { key: "efund_budget_column", value: 0 },
  ],
};
