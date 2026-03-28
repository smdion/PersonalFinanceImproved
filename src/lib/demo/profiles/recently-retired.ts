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
    // James — Traditional IRA (rolled over from 401k)
    {
      institution: "Fidelity",
      accountType: "ira",
      taxType: "preTax",
      amount: "2800000",
      label: "Rollover",
      ownerPersonName: "James",
      perfAccountLabel: "James Rollover IRA",
    },
    // James — Roth IRA
    {
      institution: "Fidelity",
      accountType: "ira",
      taxType: "taxFree",
      amount: "520000",
      label: null,
      ownerPersonName: "James",
      perfAccountLabel: "James Roth IRA",
    },
    // Patricia — Traditional IRA (403b rollover)
    {
      institution: "Vanguard",
      accountType: "ira",
      taxType: "preTax",
      amount: "700000",
      label: "Rollover",
      ownerPersonName: "Patricia",
      perfAccountLabel: "Patricia Rollover IRA",
    },
    // Patricia — Roth IRA
    {
      institution: "Vanguard",
      accountType: "ira",
      taxType: "taxFree",
      amount: "230000",
      label: null,
      ownerPersonName: "Patricia",
      perfAccountLabel: "Patricia Roth IRA",
    },
    // Joint — Taxable brokerage
    {
      institution: "Schwab",
      accountType: "brokerage",
      taxType: "afterTax",
      amount: "750000",
      label: "Joint Taxable",
      ownerPersonName: "James",
      parentCategory: "Retirement",
      perfAccountLabel: "Joint Brokerage",
    },
  ],

  performanceAccounts: [
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

  // 10 years of per-account performance history
  accountPerformance: [
    // --- James Rollover IRA (traditional, the big account) ---
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
            begin: "1400000",
            contrib: "55000",
            gain: "168000",
            end: "1623000",
            ret: "11.5",
            match: "18000",
          },
          2017: {
            begin: "1623000",
            contrib: "57000",
            gain: "340000",
            end: "2020000",
            ret: "20.2",
            match: "19000",
          },
          2018: {
            begin: "2020000",
            contrib: "58000",
            gain: "-92000",
            end: "1986000",
            ret: "-4.4",
            match: "19500",
          },
          2019: {
            begin: "1986000",
            contrib: "60000",
            gain: "577000",
            end: "2623000",
            ret: "28.2",
            match: "20000",
          },
          2020: {
            begin: "2623000",
            contrib: "61000",
            gain: "459000",
            end: "3143000",
            ret: "17.1",
            match: "20500",
          },
          2021: {
            begin: "3143000",
            contrib: "62000",
            gain: "813000",
            end: "4018000",
            ret: "25.4",
            match: "21000",
          },
          2022: {
            begin: "4018000",
            contrib: "63000",
            gain: "-758000",
            end: "3323000",
            ret: "-18.6",
            match: "21500",
          },
          2023: {
            begin: "3323000",
            contrib: "64000",
            gain: "850000",
            end: "4237000",
            ret: "25.1",
            match: "22000",
          },
          2024: {
            begin: "4237000",
            contrib: "30000",
            gain: "343000",
            end: "4610000",
            ret: "7.9",
            match: "12000",
          },
          2025: {
            begin: "4610000",
            contrib: "0",
            gain: "-180000",
            end: "4430000",
            ret: "-3.8",
            match: "0",
          },
        };
        const d = data[year]!;
        return {
          year,
          institution: "Fidelity",
          accountLabel: "James Rollover IRA",
          ownerPersonName: "James",
          beginningBalance: d.begin,
          totalContributions: d.contrib,
          yearlyGainLoss: d.gain,
          endingBalance: d.end,
          annualReturnPct: d.ret,
          employerContributions: d.match,
          fees: year <= 2023 ? "2800" : year === 2024 ? "2100" : "1600",
          parentCategory: "Retirement",
          perfAccountLabel: "James Rollover IRA",
        };
      },
    ),

    // --- James Roth IRA ---
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
            begin: "180000",
            contrib: "11000",
            gain: "22000",
            end: "213000",
            ret: "11.5",
          },
          2017: {
            begin: "213000",
            contrib: "11000",
            gain: "45000",
            end: "269000",
            ret: "20.1",
          },
          2018: {
            begin: "269000",
            contrib: "12000",
            gain: "-12000",
            end: "269000",
            ret: "-4.3",
          },
          2019: {
            begin: "269000",
            contrib: "12000",
            gain: "79000",
            end: "360000",
            ret: "28.1",
          },
          2020: {
            begin: "360000",
            contrib: "13000",
            gain: "64000",
            end: "437000",
            ret: "17.2",
          },
          2021: {
            begin: "437000",
            contrib: "13000",
            gain: "114000",
            end: "564000",
            ret: "25.3",
          },
          2022: {
            begin: "564000",
            contrib: "13500",
            gain: "-107000",
            end: "470500",
            ret: "-18.5",
          },
          2023: {
            begin: "470500",
            contrib: "13500",
            gain: "121000",
            end: "605000",
            ret: "25.0",
          },
          2024: {
            begin: "605000",
            contrib: "8000",
            gain: "49000",
            end: "662000",
            ret: "7.9",
          },
          2025: {
            begin: "662000",
            contrib: "0",
            gain: "-25000",
            end: "637000",
            ret: "-3.8",
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

    // --- Patricia Rollover IRA (traditional, from 403b) ---
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
            begin: "320000",
            contrib: "12000",
            gain: "38000",
            end: "370000",
            ret: "11.5",
          },
          2017: {
            begin: "370000",
            contrib: "13000",
            gain: "77000",
            end: "460000",
            ret: "20.1",
          },
          2018: {
            begin: "460000",
            contrib: "13000",
            gain: "-21000",
            end: "452000",
            ret: "-4.4",
          },
          2019: {
            begin: "452000",
            contrib: "13000",
            gain: "131000",
            end: "596000",
            ret: "28.2",
          },
          2020: {
            begin: "596000",
            contrib: "13000",
            gain: "104000",
            end: "713000",
            ret: "17.1",
          },
          2021: {
            begin: "713000",
            contrib: "13500",
            gain: "184000",
            end: "910500",
            ret: "25.3",
          },
          2022: {
            begin: "910500",
            contrib: "14000",
            gain: "-172000",
            end: "752500",
            ret: "-18.6",
          },
          2023: {
            begin: "752500",
            contrib: "14500",
            gain: "192000",
            end: "959000",
            ret: "25.0",
          },
          2024: {
            begin: "959000",
            contrib: "20000",
            gain: "77000",
            end: "1056000",
            ret: "7.9",
          },
          2025: {
            begin: "1056000",
            contrib: "0",
            gain: "-40000",
            end: "1016000",
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
          totalContributions: d.contrib,
          yearlyGainLoss: d.gain,
          endingBalance: d.end,
          annualReturnPct: d.ret,
          employerContributions: "0",
          fees: year <= 2023 ? "900" : year === 2024 ? "700" : "500",
          parentCategory: "Retirement",
          perfAccountLabel: "Patricia Rollover IRA",
        };
      },
    ),

    // --- Patricia Roth IRA ---
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
            begin: "80000",
            contrib: "5500",
            gain: "10000",
            end: "95500",
            ret: "11.7",
          },
          2017: {
            begin: "95500",
            contrib: "5500",
            gain: "20000",
            end: "121000",
            ret: "19.8",
          },
          2018: {
            begin: "121000",
            contrib: "5500",
            gain: "-5400",
            end: "121100",
            ret: "-4.3",
          },
          2019: {
            begin: "121100",
            contrib: "6000",
            gain: "36000",
            end: "163100",
            ret: "28.3",
          },
          2020: {
            begin: "163100",
            contrib: "6000",
            gain: "29000",
            end: "198100",
            ret: "17.2",
          },
          2021: {
            begin: "198100",
            contrib: "7000",
            gain: "52000",
            end: "257100",
            ret: "25.4",
          },
          2022: {
            begin: "257100",
            contrib: "7000",
            gain: "-49000",
            end: "215100",
            ret: "-18.6",
          },
          2023: {
            begin: "215100",
            contrib: "7500",
            gain: "56000",
            end: "278600",
            ret: "25.2",
          },
          2024: {
            begin: "278600",
            contrib: "7000",
            gain: "22500",
            end: "308100",
            ret: "7.9",
          },
          2025: {
            begin: "308100",
            contrib: "0",
            gain: "-12000",
            end: "296100",
            ret: "-3.8",
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

    // --- Joint Brokerage ---
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
            contrib: "24000",
            gain: "14000",
            end: "158000",
            ret: "9.7",
          },
          2017: {
            begin: "158000",
            contrib: "24000",
            gain: "28000",
            end: "210000",
            ret: "15.4",
          },
          2018: {
            begin: "210000",
            contrib: "24000",
            gain: "-7000",
            end: "227000",
            ret: "-3.0",
          },
          2019: {
            begin: "227000",
            contrib: "24000",
            gain: "45000",
            end: "296000",
            ret: "17.9",
          },
          2020: {
            begin: "296000",
            contrib: "30000",
            gain: "34000",
            end: "360000",
            ret: "10.4",
          },
          2021: {
            begin: "360000",
            contrib: "36000",
            gain: "62000",
            end: "458000",
            ret: "15.7",
          },
          2022: {
            begin: "458000",
            contrib: "40000",
            gain: "-59000",
            end: "439000",
            ret: "-11.8",
          },
          2023: {
            begin: "439000",
            contrib: "45000",
            gain: "61000",
            end: "545000",
            ret: "12.6",
          },
          2024: {
            begin: "545000",
            contrib: "50000",
            gain: "19000",
            end: "614000",
            ret: "3.2",
          },
          2025: {
            begin: "614000",
            contrib: "0",
            gain: "-4000",
            end: "610000",
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
          fees: year <= 2021 ? "200" : "300",
          parentCategory: "Retirement",
          perfAccountLabel: "Joint Brokerage",
        };
      },
    ),

    // 2026 YTD (Q1) — all accounts
    {
      year: 2026,
      institution: "Fidelity",
      accountLabel: "James Rollover IRA",
      ownerPersonName: "James",
      beginningBalance: "4430000",
      totalContributions: "0",
      yearlyGainLoss: "-130000",
      endingBalance: "2800000",
      annualReturnPct: "-2.9",
      employerContributions: "0",
      fees: "400",
      parentCategory: "Retirement",
      perfAccountLabel: "James Rollover IRA",
    },
    {
      year: 2026,
      institution: "Fidelity",
      accountLabel: "James Roth IRA",
      ownerPersonName: "James",
      beginningBalance: "637000",
      totalContributions: "0",
      yearlyGainLoss: "-17000",
      endingBalance: "520000",
      annualReturnPct: "-2.7",
      employerContributions: "0",
      fees: "0",
      parentCategory: "Retirement",
      perfAccountLabel: "James Roth IRA",
    },
    {
      year: 2026,
      institution: "Vanguard",
      accountLabel: "Patricia Rollover IRA",
      ownerPersonName: "Patricia",
      beginningBalance: "1016000",
      totalContributions: "0",
      yearlyGainLoss: "-16000",
      endingBalance: "700000",
      annualReturnPct: "-1.6",
      employerContributions: "0",
      fees: "125",
      parentCategory: "Retirement",
      perfAccountLabel: "Patricia Rollover IRA",
    },
    {
      year: 2026,
      institution: "Vanguard",
      accountLabel: "Patricia Roth IRA",
      ownerPersonName: "Patricia",
      beginningBalance: "296100",
      totalContributions: "0",
      yearlyGainLoss: "-6100",
      endingBalance: "230000",
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
      beginningBalance: "610000",
      totalContributions: "0",
      yearlyGainLoss: "-10000",
      endingBalance: "750000",
      annualReturnPct: "-1.6",
      employerContributions: "0",
      fees: "75",
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
