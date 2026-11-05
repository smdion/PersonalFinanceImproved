// ============================================================================
// Recently Retired demo profile
//
// Seed data for the "Recently Retired" onboarding tour. This file is a big
// declarative object literal — no logic. Sections are grouped by domain with
// banner comments to make navigation easier. Same shape as the other demo
// profiles (dual-income-family, single-income, early-retirement, debt-payoff).
//
// If you're looking for a specific section, use the section banners below as
// jump targets: People → Jobs → Budget → Savings → Contributions → Portfolio
// snapshot → Annual performance → Retirement settings → Return rates →
// Mortgages → Per-account history → Other assets → Net worth → App settings.
// ============================================================================
import type { DemoProfile } from "../types";
import {
  PERF_CATEGORY_RETIREMENT,
  PERF_CATEGORY_DEFAULT,
} from "@/lib/config/display-labels";
import {
  SK_BUDGET_ACTIVE_COLUMN,
  SK_EFUND_BUDGET_COLUMN,
} from "@/lib/constants/settings-keys";

// ── Per-account performance history, in seeding order ──
// Hand-written, one row per account-year in seeding order (columns: PerfRow).
const PERF_ACCOUNTS = {
  j401k: { institution: "Fidelity", label: "James 401k", owner: "James" },
  jRollover: {
    institution: "Fidelity",
    label: "James Rollover IRA",
    owner: "James",
  },
  jRoth: { institution: "Fidelity", label: "James Roth IRA", owner: "James" },
  p403b: { institution: "Vanguard", label: "Patricia 403b", owner: "Patricia" },
  pRollover: {
    institution: "Vanguard",
    label: "Patricia Rollover IRA",
    owner: "Patricia",
  },
} as const;

type PerfRow = [
  account: keyof typeof PERF_ACCOUNTS,
  year: number,
  begin: number,
  contributions: number,
  gainLoss: number,
  end: number,
  /** A fraction: 0.115 = 11.5%. */
  annualReturn: number,
  employer: number,
  fees: number,
];

// prettier-ignore
const PERF_HISTORY: PerfRow[] = [
  ["j401k", 2016, 900000, 37000, 108000, 1045000, 0.115, 18000, 1800],
  ["j401k", 2017, 1045000, 38000, 219000, 1302000, 0.202, 19000, 1800],
  ["j401k", 2018, 1302000, 39000, -59000, 1282000, -0.044, 19500, 1800],
  ["j401k", 2019, 1282000, 40000, 373000, 1695000, 0.282, 20000, 1800],
  ["j401k", 2020, 1695000, 41000, 297000, 2033000, 0.171, 20500, 1800],
  ["j401k", 2021, 2033000, 42000, 527000, 2602000, 0.254, 21000, 1800],
  ["j401k", 2022, 2602000, 43000, -491000, 2154000, -0.186, 21500, 1800],
  ["j401k", 2023, 2154000, 44000, 551000, 2749000, 0.251, 22000, 1800],
  ["j401k", 2024, 2749000, 20000, 222000, 2991000, 0.079, 12000, 1400],
  ["j401k", 2025, 2991000, 0, -117000, 2874000, -0.038, 0, 1000],
  ["jRollover", 2016, 500000, 0, 58000, 558000, 0.116, 0, 1000],
  ["jRollover", 2017, 558000, 0, 113000, 671000, 0.203, 0, 1000],
  ["jRollover", 2018, 671000, 0, -30000, 641000, -0.045, 0, 1000],
  ["jRollover", 2019, 641000, 0, 181000, 822000, 0.282, 0, 1000],
  ["jRollover", 2020, 822000, 0, 141000, 963000, 0.172, 0, 1000],
  ["jRollover", 2021, 963000, 0, 244000, 1207000, 0.253, 0, 1000],
  ["jRollover", 2022, 1207000, 0, -224000, 983000, -0.186, 0, 1000],
  ["jRollover", 2023, 983000, 0, 247000, 1230000, 0.251, 0, 1000],
  ["jRollover", 2024, 1230000, 0, 97000, 1327000, 0.079, 0, 700],
  ["jRollover", 2025, 1327000, 0, -50000, 1277000, -0.038, 0, 600],
  ["jRoth", 2016, 120000, 7000, 15000, 142000, 0.118, 0, 0],
  ["jRoth", 2017, 142000, 7000, 30000, 179000, 0.201, 0, 0],
  ["jRoth", 2018, 179000, 8000, -8000, 179000, -0.043, 0, 0],
  ["jRoth", 2019, 179000, 8000, 53000, 240000, 0.283, 0, 0],
  ["jRoth", 2020, 240000, 8500, 43000, 291500, 0.173, 0, 0],
  ["jRoth", 2021, 291500, 8500, 76000, 376000, 0.253, 0, 0],
  ["jRoth", 2022, 376000, 9000, -72000, 313000, -0.187, 0, 0],
  ["jRoth", 2023, 313000, 9000, 81000, 403000, 0.252, 0, 0],
  ["jRoth", 2024, 403000, 5000, 32000, 440000, 0.078, 0, 0],
  ["jRoth", 2025, 440000, 0, -17000, 423000, -0.039, 0, 0],
  ["p403b", 2016, 230000, 9000, 28000, 267000, 0.117, 0, 650],
  ["p403b", 2017, 267000, 9500, 56000, 332500, 0.203, 0, 650],
  ["p403b", 2018, 332500, 9500, -15000, 327000, -0.044, 0, 650],
  ["p403b", 2019, 327000, 10000, 95000, 432000, 0.282, 0, 650],
  ["p403b", 2020, 432000, 10000, 76000, 518000, 0.172, 0, 650],
  ["p403b", 2021, 518000, 10000, 134000, 662000, 0.254, 0, 650],
  ["p403b", 2022, 662000, 10500, -125000, 547500, -0.186, 0, 650],
  ["p403b", 2023, 547500, 11000, 140000, 698500, 0.251, 0, 650],
  ["p403b", 2024, 698500, 15000, 56000, 769500, 0.079, 0, 500],
  ["p403b", 2025, 769500, 0, -29000, 740500, -0.038, 0, 400],
  ["pRollover", 2016, 90000, 0, 10000, 100000, 0.111, 0, 250],
  ["pRollover", 2017, 100000, 0, 20000, 120000, 0.2, 0, 250],
  ["pRollover", 2018, 120000, 0, -5000, 115000, -0.042, 0, 250],
  ["pRollover", 2019, 115000, 0, 33000, 148000, 0.287, 0, 250],
  ["pRollover", 2020, 148000, 0, 25000, 173000, 0.169, 0, 250],
  ["pRollover", 2021, 173000, 0, 44000, 217000, 0.254, 0, 250],
  ["pRollover", 2022, 217000, 0, -40000, 177000, -0.184, 0, 250],
  ["pRollover", 2023, 177000, 0, 44000, 221000, 0.249, 0, 250],
  ["pRollover", 2024, 221000, 0, 18000, 239000, 0.081, 0, 200],
  ["pRollover", 2025, 239000, 0, -9000, 230000, -0.038, 0, 100],
];

/** The history rows as the profile stores them (amounts as strings). */
function accountPerformanceRows(): DemoProfile["accountPerformance"] {
  return PERF_HISTORY.map(
    ([account, year, begin, contrib, gain, end, ret, employer, fees]) => {
      const { institution, label, owner } = PERF_ACCOUNTS[account];
      return {
        year,
        institution,
        accountLabel: label,
        ownerPersonName: owner,
        beginningBalance: String(begin),
        totalContributions: String(contrib),
        yearlyGainLoss: String(gain),
        endingBalance: String(end),
        annualReturnPct: String(ret),
        employerContributions: String(employer),
        fees: String(fees),
        parentCategory: PERF_CATEGORY_RETIREMENT as "Retirement",
        perfAccountLabel: label,
      };
    },
  );
}

export const recentlyRetiredProfile: DemoProfile = {
  slug: "recently-retired",
  name: "Recently Retired",
  description:
    "Retired couple, $5M portfolio, delaying Social Security to 70, navigating RMDs and the Roth conversion window.",
  keyStats: { savingsRate: "N/A" },

  // ── People ────────────────────────────────────────────────────────────────
  people: [
    { name: "James", dateOfBirth: "1959-03-22", isPrimaryUser: true },
    { name: "Patricia", dateOfBirth: "1961-08-10", isPrimaryUser: false },
  ],

  // ── Jobs (both retired — end dates present) ──────────────────────────────
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

  // ── Budget profiles & line items ─────────────────────────────────────────
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

  // ── Savings (sinking funds) ──────────────────────────────────────────────
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

  // ── Contributions (empty — both retired) ─────────────────────────────────
  contributionAccounts: [],

  // ── Portfolio snapshot + per-account balances ────────────────────────────
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
      parentCategory: PERF_CATEGORY_RETIREMENT as "Retirement",
      perfAccountLabel: "Joint Brokerage",
    },
  ],

  // ── Performance accounts (account metadata for return tracking) ─────────
  performanceAccounts: [
    {
      institution: "Fidelity",
      accountType: "401k",
      accountLabel: "James 401k",
      ownershipType: "individual",
      parentCategory: PERF_CATEGORY_RETIREMENT as "Retirement",
      label: null,
      isActive: true,
      ownerPersonName: "James",
    },
    {
      institution: "Fidelity",
      accountType: "ira",
      accountLabel: "James Rollover IRA",
      ownershipType: "individual",
      parentCategory: PERF_CATEGORY_RETIREMENT as "Retirement",
      label: "Rollover",
      isActive: true,
      ownerPersonName: "James",
    },
    {
      institution: "Fidelity",
      accountType: "ira",
      accountLabel: "James Roth IRA",
      ownershipType: "individual",
      parentCategory: PERF_CATEGORY_RETIREMENT as "Retirement",
      label: null,
      isActive: true,
      ownerPersonName: "James",
    },
    {
      institution: "Vanguard",
      accountType: "403b",
      accountLabel: "Patricia 403b",
      ownershipType: "individual",
      parentCategory: PERF_CATEGORY_RETIREMENT as "Retirement",
      label: null,
      isActive: true,
      ownerPersonName: "Patricia",
    },
    {
      institution: "Vanguard",
      accountType: "ira",
      accountLabel: "Patricia Rollover IRA",
      ownershipType: "individual",
      parentCategory: PERF_CATEGORY_RETIREMENT as "Retirement",
      label: "Rollover",
      isActive: true,
      ownerPersonName: "Patricia",
    },
    {
      institution: "Vanguard",
      accountType: "ira",
      accountLabel: "Patricia Roth IRA",
      ownershipType: "individual",
      parentCategory: PERF_CATEGORY_RETIREMENT as "Retirement",
      label: null,
      isActive: true,
      ownerPersonName: "Patricia",
    },
    {
      institution: "Schwab",
      accountType: "brokerage",
      accountLabel: "Joint Brokerage",
      ownershipType: "joint",
      parentCategory: PERF_CATEGORY_RETIREMENT as "Retirement",
      label: "Joint Taxable",
      isActive: true,
      ownerPersonName: "James",
    },
  ],

  // ── Aggregated annual performance (10 years, 2016–2025) ─────────────────
  // annualReturnPct: decimal fraction (0.115 = 11.5%)
  annualPerformance: [
    {
      category: PERF_CATEGORY_DEFAULT as "401k/IRA",
      year: 2016,
      beginningBalance: "2100000",
      totalContributions: "85000",
      yearlyGainLoss: "252000",
      endingBalance: "2437000",
      annualReturnPct: "0.115",
      employerContributions: "18000",
      fees: "4200",
      lifetimeGains: "800000",
      lifetimeContributions: "1200000",
      lifetimeMatch: "280000",
    },
    {
      category: PERF_CATEGORY_DEFAULT as "401k/IRA",
      year: 2017,
      beginningBalance: "2437000",
      totalContributions: "88000",
      yearlyGainLoss: "510000",
      endingBalance: "3035000",
      annualReturnPct: "0.202",
      employerContributions: "19000",
      fees: "4800",
      lifetimeGains: "1310000",
      lifetimeContributions: "1288000",
      lifetimeMatch: "299000",
    },
    {
      category: PERF_CATEGORY_DEFAULT as "401k/IRA",
      year: 2018,
      beginningBalance: "3035000",
      totalContributions: "90000",
      yearlyGainLoss: "-137000",
      endingBalance: "2988000",
      annualReturnPct: "-0.044",
      employerContributions: "19500",
      fees: "5100",
      lifetimeGains: "1173000",
      lifetimeContributions: "1378000",
      lifetimeMatch: "318500",
    },
    {
      category: PERF_CATEGORY_DEFAULT as "401k/IRA",
      year: 2019,
      beginningBalance: "2988000",
      totalContributions: "92000",
      yearlyGainLoss: "868000",
      endingBalance: "3948000",
      annualReturnPct: "0.282",
      employerContributions: "20000",
      fees: "5400",
      lifetimeGains: "2041000",
      lifetimeContributions: "1470000",
      lifetimeMatch: "338500",
    },
    {
      category: PERF_CATEGORY_DEFAULT as "401k/IRA",
      year: 2020,
      beginningBalance: "3948000",
      totalContributions: "94000",
      yearlyGainLoss: "690000",
      endingBalance: "4732000",
      annualReturnPct: "0.171",
      employerContributions: "20500",
      fees: "5700",
      lifetimeGains: "2731000",
      lifetimeContributions: "1564000",
      lifetimeMatch: "359000",
    },
    {
      category: PERF_CATEGORY_DEFAULT as "401k/IRA",
      year: 2021,
      beginningBalance: "4732000",
      totalContributions: "96000",
      yearlyGainLoss: "1225000",
      endingBalance: "6053000",
      annualReturnPct: "0.254",
      employerContributions: "21000",
      fees: "6100",
      lifetimeGains: "3956000",
      lifetimeContributions: "1660000",
      lifetimeMatch: "380000",
    },
    {
      category: PERF_CATEGORY_DEFAULT as "401k/IRA",
      year: 2022,
      beginningBalance: "6053000",
      totalContributions: "98000",
      yearlyGainLoss: "-1145000",
      endingBalance: "5006000",
      annualReturnPct: "-0.186",
      employerContributions: "21500",
      fees: "6400",
      lifetimeGains: "2811000",
      lifetimeContributions: "1758000",
      lifetimeMatch: "401500",
    },
    {
      category: PERF_CATEGORY_DEFAULT as "401k/IRA",
      year: 2023,
      beginningBalance: "5006000",
      totalContributions: "100000",
      yearlyGainLoss: "1280000",
      endingBalance: "6386000",
      annualReturnPct: "0.251",
      employerContributions: "22000",
      fees: "6700",
      lifetimeGains: "4091000",
      lifetimeContributions: "1858000",
      lifetimeMatch: "423500",
    },
    {
      category: PERF_CATEGORY_DEFAULT as "401k/IRA",
      year: 2024,
      beginningBalance: "6386000",
      totalContributions: "65000",
      yearlyGainLoss: "510000",
      endingBalance: "6961000",
      annualReturnPct: "0.079",
      employerContributions: "12000",
      fees: "5200",
      lifetimeGains: "4601000",
      lifetimeContributions: "1923000",
      lifetimeMatch: "435500",
    },
    {
      category: PERF_CATEGORY_DEFAULT as "401k/IRA",
      year: 2025,
      beginningBalance: "6961000",
      totalContributions: "0",
      yearlyGainLoss: "-261000",
      endingBalance: "6700000",
      annualReturnPct: "-0.038",
      employerContributions: "0",
      fees: "4800",
      lifetimeGains: "4340000",
      lifetimeContributions: "1923000",
      lifetimeMatch: "435500",
    },
  ],

  // ── Retirement settings (household + per-person) ─────────────────────────
  retirementSettings: {
    personName: "James",
    retirementAge: 65,
    endAge: 95,
    returnAfterRetirement: "0.05",
    annualInflation: "0.025",
    salaryAnnualIncrease: "0",
    withdrawalRate: "0.035",
    withdrawalStrategy: "rmd_spending",
    socialSecurityMonthly: "2000",
    ssStartAge: 70,
  },

  perPersonRetirementSettings: [
    {
      personName: "Patricia",
      retirementAge: 63,
      socialSecurityMonthly: "2000",
      ssStartAge: 70,
    },
  ],

  // ── Return-rate table (age-based glide path) ────────────────────────────
  returnRates: [
    { age: 65, rateOfReturn: "0.06" },
    { age: 70, rateOfReturn: "0.055" },
    { age: 75, rateOfReturn: "0.05" },
    { age: 80, rateOfReturn: "0.045" },
    { age: 85, rateOfReturn: "0.04" },
  ],

  // ── Mortgages (paid-off home — empty active loans) ──────────────────────
  debts: [],

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

  // ── Per-account performance history (10 years × 7 accounts, then 2026) ──
  // annualReturnPct: decimal fraction (0.115 = 11.5%)
  accountPerformance: [
    // PERF_HISTORY's rows, then the accounts still written out below.
    ...accountPerformanceRows(),
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
            ret: "0.117",
          },
          2017: {
            begin: "62000",
            contrib: "3500",
            gain: "13000",
            end: "78500",
            ret: "0.198",
          },
          2018: {
            begin: "78500",
            contrib: "3500",
            gain: "-3500",
            end: "78500",
            ret: "-0.043",
          },
          2019: {
            begin: "78500",
            contrib: "4000",
            gain: "23000",
            end: "105500",
            ret: "0.279",
          },
          2020: {
            begin: "105500",
            contrib: "4000",
            gain: "19000",
            end: "128500",
            ret: "0.174",
          },
          2021: {
            begin: "128500",
            contrib: "4500",
            gain: "34000",
            end: "167000",
            ret: "0.256",
          },
          2022: {
            begin: "167000",
            contrib: "4500",
            gain: "-32000",
            end: "139500",
            ret: "-0.186",
          },
          2023: {
            begin: "139500",
            contrib: "5000",
            gain: "36000",
            end: "180500",
            ret: "0.249",
          },
          2024: {
            begin: "180500",
            contrib: "4500",
            gain: "15000",
            end: "200000",
            ret: "0.081",
          },
          2025: {
            begin: "200000",
            contrib: "0",
            gain: "-8000",
            end: "192000",
            ret: "-0.04",
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
          parentCategory: PERF_CATEGORY_RETIREMENT as "Retirement",
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
            ret: "0.099",
          },
          2017: {
            begin: "211000",
            contrib: "32000",
            gain: "37000",
            end: "280000",
            ret: "0.152",
          },
          2018: {
            begin: "280000",
            contrib: "32000",
            gain: "-9000",
            end: "303000",
            ret: "-0.029",
          },
          2019: {
            begin: "303000",
            contrib: "32000",
            gain: "60000",
            end: "395000",
            ret: "0.179",
          },
          2020: {
            begin: "395000",
            contrib: "40000",
            gain: "45000",
            end: "480000",
            ret: "0.103",
          },
          2021: {
            begin: "480000",
            contrib: "48000",
            gain: "83000",
            end: "611000",
            ret: "0.157",
          },
          2022: {
            begin: "611000",
            contrib: "53000",
            gain: "-78000",
            end: "586000",
            ret: "-0.117",
          },
          2023: {
            begin: "586000",
            contrib: "60000",
            gain: "82000",
            end: "728000",
            ret: "0.127",
          },
          2024: {
            begin: "728000",
            contrib: "67000",
            gain: "25000",
            end: "820000",
            ret: "0.031",
          },
          2025: {
            begin: "820000",
            contrib: "0",
            gain: "-6000",
            end: "814000",
            ret: "-0.007",
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
          parentCategory: PERF_CATEGORY_RETIREMENT as "Retirement",
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
      annualReturnPct: "-0.026",
      employerContributions: "0",
      fees: "250",
      parentCategory: PERF_CATEGORY_RETIREMENT as "Retirement",
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
      annualReturnPct: "-0.029",
      employerContributions: "0",
      fees: "150",
      parentCategory: PERF_CATEGORY_RETIREMENT as "Retirement",
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
      annualReturnPct: "-0.031",
      employerContributions: "0",
      fees: "0",
      parentCategory: PERF_CATEGORY_RETIREMENT as "Retirement",
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
      annualReturnPct: "-0.021",
      employerContributions: "0",
      fees: "100",
      parentCategory: PERF_CATEGORY_RETIREMENT as "Retirement",
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
      annualReturnPct: "-0.022",
      employerContributions: "0",
      fees: "25",
      parentCategory: PERF_CATEGORY_RETIREMENT as "Retirement",
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
      annualReturnPct: "-0.021",
      employerContributions: "0",
      fees: "0",
      parentCategory: PERF_CATEGORY_RETIREMENT as "Retirement",
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
      annualReturnPct: "-0.017",
      employerContributions: "0",
      fees: "100",
      parentCategory: PERF_CATEGORY_RETIREMENT as "Retirement",
      perfAccountLabel: "Joint Brokerage",
    },
  ],

  // ── Other assets + property taxes + home improvements ──────────────────
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

  // ── Net-worth annual history ────────────────────────────────────────────
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

  // ── App settings overrides ──────────────────────────────────────────────
  appSettings: [
    { key: SK_BUDGET_ACTIVE_COLUMN, value: 1 },
    { key: SK_EFUND_BUDGET_COLUMN, value: 0 },
  ],
};
