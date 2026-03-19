/**
 * Shared helpers for benchmark tests.
 *
 * Provides input builders for deterministic engine and Monte Carlo tests,
 * plus tolerance constants calibrated against known platforms.
 */
import type { ProjectionInput, MonteCarloInput } from "@/lib/calculators/types";

const AS_OF = new Date("2026-03-01");

// ---------------------------------------------------------------------------
// Tolerances
// ---------------------------------------------------------------------------

export const TOLERANCES = {
  /** ±8 percentage points for MC success rates (log-normal vs historical divergence). */
  successRate: 0.08,
  /** ±15% for large balance comparisons. */
  balancePercent: 0.15,
  /** ±$50k absolute for large balances. */
  balanceDollar: 50_000,
  /** ±2 percentage points for tax rate comparisons. */
  taxRate: 0.02,
  /** ±2 percentage points for return rate assumptions. */
  returnRate: 0.02,
  /** ±5 percentage points for glide path allocation checks. */
  allocationPct: 0.05,
};

// ---------------------------------------------------------------------------
// Common account categories and defaults
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Input builders
// ---------------------------------------------------------------------------

/**
 * Minimal engine input for testing pure compound growth.
 * Zero contributions, zero tax, zero SS — just lump-sum growth.
 */
export function makePureGrowthInput(
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
      afterTax: 100000,
      afterTaxBasis: 100000,
    },
    startingAccountBalances: {
      ...EMPTY_ACCOUNT_BALANCES,
      brokerage: {
        structure: "basis_tracking",
        balance: 100000,
        basis: 100000,
      },
    },
    annualExpenses: 0,
    inflationRate: 0,
    returnRates: [{ label: "7%", rate: 0.07 }],
    socialSecurityAnnual: 0,
    ssStartAge: 67,
    asOfDate: AS_OF,
    ...overrides,
  };
}

/**
 * Trinity Study scenario: retirement-only, single bucket, no tax, no SS.
 * Designed to match Trinity Study / cFIREsim assumptions for direct comparison.
 */
export function makeTrinityInput(
  overrides: Partial<ProjectionInput> = {},
): ProjectionInput {
  const withdrawalRate = overrides.decumulationDefaults?.withdrawalRate ?? 0.04;
  const startingBalance = 1_000_000;
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
      withdrawalRate,
      distributionTaxRates: {
        traditionalFallbackRate: 0,
        roth: 0,
        hsa: 0,
        brokerage: 0,
      },
    },
    accumulationOverrides: [],
    decumulationOverrides: [],
    currentAge: 65,
    retirementAge: 65,
    projectionEndAge: 95,
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
      afterTax: startingBalance,
      afterTaxBasis: startingBalance,
    },
    startingAccountBalances: {
      ...EMPTY_ACCOUNT_BALANCES,
      brokerage: {
        structure: "basis_tracking",
        balance: startingBalance,
        basis: startingBalance,
      },
    },
    annualExpenses: startingBalance * withdrawalRate,
    inflationRate: 0.03,
    returnRates: [{ label: "7%", rate: 0.07 }],
    socialSecurityAnnual: 0,
    ssStartAge: 99,
    asOfDate: AS_OF,
    ...overrides,
  };
}

/**
 * Standard test fixture matching engine-snapshot.test.ts defaults.
 * Age 35, retire 65, end 90, $150k salary, $72k expenses.
 */
export function makeStandardInput(
  overrides: Partial<ProjectionInput> = {},
): ProjectionInput {
  return {
    accumulationDefaults: {
      contributionRate: 0.25,
      routingMode: "waterfall",
      accountOrder: ["401k", "403b", "hsa", "ira", "brokerage"],
      accountSplits: {
        "401k": 0.4,
        "403b": 0,
        hsa: 0.1,
        ira: 0.15,
        brokerage: 0.35,
      },
      taxSplits: { "401k": 0.5, ira: 1.0 },
    },
    decumulationDefaults: DEFAULT_DECUMULATION,
    accumulationOverrides: [],
    decumulationOverrides: [],
    currentAge: 35,
    retirementAge: 65,
    projectionEndAge: 90,
    currentSalary: 150000,
    salaryGrowthRate: 0.03,
    salaryCap: null,
    salaryOverrides: [],
    budgetOverrides: [],
    baseLimits: {
      "401k": 23500,
      "403b": 23500,
      hsa: 4300,
      ira: 7000,
      brokerage: 0,
    },
    limitGrowthRate: 0.02,
    catchupLimits: { "401k": 7500, ira: 1000, hsa: 1000, "401k_super": 11250 },
    employerMatchRateByCategory: {
      "401k": 0.03,
      "403b": 0,
      hsa: 0,
      ira: 0,
      brokerage: 0,
    },
    startingBalances: {
      preTax: 100000,
      taxFree: 50000,
      hsa: 15000,
      afterTax: 30000,
      afterTaxBasis: 20000,
    },
    startingAccountBalances: {
      "401k": {
        structure: "roth_traditional",
        traditional: 80000,
        roth: 20000,
      },
      "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
      hsa: { structure: "single_bucket", balance: 15000 },
      ira: { structure: "roth_traditional", traditional: 30000, roth: 20000 },
      brokerage: { structure: "basis_tracking", balance: 30000, basis: 20000 },
    },
    annualExpenses: 72000,
    inflationRate: 0.025,
    returnRates: [{ label: "7%", rate: 0.07 }],
    socialSecurityAnnual: 36000,
    ssStartAge: 67,
    asOfDate: AS_OF,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Monte Carlo helpers
// ---------------------------------------------------------------------------

/** Asset class parameters from seed-monte-carlo.ts (canonical source). Historical long-run averages. */
export const ASSET_CLASSES = [
  { id: 1, name: "US Equities", meanReturn: 0.1, stdDev: 0.16 },
  { id: 2, name: "International Equities", meanReturn: 0.08, stdDev: 0.17 },
  { id: 3, name: "US Bonds", meanReturn: 0.05, stdDev: 0.05 },
  { id: 4, name: "TIPS", meanReturn: 0.035, stdDev: 0.04 },
  { id: 5, name: "Cash", meanReturn: 0.03, stdDev: 0.01 },
];

/** Historical Ibbotson returns for Trinity Study comparisons. */
export const IBBOTSON_CLASSES = [
  { id: 1, name: "US Equities", meanReturn: 0.103, stdDev: 0.16 },
  { id: 3, name: "US Bonds", meanReturn: 0.055, stdDev: 0.05 },
];

/** Correlation data from seed-monte-carlo.ts. */
export const CORRELATIONS = [
  { classAId: 1, classBId: 2, correlation: 0.75 },
  { classAId: 1, classBId: 3, correlation: -0.1 },
  { classAId: 1, classBId: 4, correlation: 0.0 },
  { classAId: 1, classBId: 5, correlation: 0.0 },
  { classAId: 2, classBId: 3, correlation: -0.05 },
  { classAId: 2, classBId: 4, correlation: 0.0 },
  { classAId: 2, classBId: 5, correlation: 0.0 },
  { classAId: 3, classBId: 4, correlation: 0.5 },
  { classAId: 3, classBId: 5, correlation: 0.3 },
  { classAId: 4, classBId: 5, correlation: 0.2 },
];

/** Hybrid glide path: Vanguard TDF accumulation + FIRE retirement (50% equity floor). Matches projection.ts Default preset. */
export const CURRENT_GLIDE_PATH = [
  { age: 25, allocations: { 1: 0.6, 2: 0.3, 3: 0.07, 4: 0.02, 5: 0.01 } },
  { age: 35, allocations: { 1: 0.57, 2: 0.3, 3: 0.09, 4: 0.03, 5: 0.01 } },
  { age: 45, allocations: { 1: 0.52, 2: 0.25, 3: 0.15, 4: 0.06, 5: 0.02 } },
  { age: 55, allocations: { 1: 0.42, 2: 0.21, 3: 0.24, 4: 0.08, 5: 0.05 } },
  { age: 65, allocations: { 1: 0.4, 2: 0.2, 3: 0.25, 4: 0.09, 5: 0.06 } },
  { age: 75, allocations: { 1: 0.37, 2: 0.18, 3: 0.27, 4: 0.11, 5: 0.07 } },
  { age: 85, allocations: { 1: 0.33, 2: 0.17, 3: 0.27, 4: 0.13, 5: 0.1 } },
];

/** Simple 50/50 stock/bond glide path for Trinity comparisons. */
export function make5050GlidePath() {
  return [
    { age: 0, allocations: { 1: 0.5, 3: 0.5 } },
    { age: 120, allocations: { 1: 0.5, 3: 0.5 } },
  ];
}

/** Simple 75/25 stock/bond glide path for cFIREsim comparisons. */
export function make7525GlidePath() {
  return [
    { age: 0, allocations: { 1: 0.75, 3: 0.25 } },
    { age: 120, allocations: { 1: 0.75, 3: 0.25 } },
  ];
}

/** Build a MonteCarloInput from an engine input + MC params. */
export function makeMCInput(
  engineInput: ProjectionInput,
  opts: {
    numTrials?: number;
    seed?: number;
    assetClasses?: {
      id: number;
      name: string;
      meanReturn: number;
      stdDev: number;
    }[];
    correlations?: {
      classAId: number;
      classBId: number;
      correlation: number;
    }[];
    glidePath?: { age: number; allocations: Record<number, number> }[];
    inflationRisk?: { meanRate: number; stdDev: number };
  } = {},
): MonteCarloInput {
  return {
    engineInput,
    numTrials: opts.numTrials ?? 5000,
    seed: opts.seed ?? 42,
    assetClasses: opts.assetClasses ?? ASSET_CLASSES,
    correlations: opts.correlations ?? CORRELATIONS,
    glidePath: opts.glidePath ?? CURRENT_GLIDE_PATH,
    inflationRisk: opts.inflationRisk,
  };
}
