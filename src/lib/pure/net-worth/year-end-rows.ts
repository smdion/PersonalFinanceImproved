import { toNumber } from "@/lib/utils/numbers";
import { calendarYear } from "@/lib/utils/date";
import { computeMortgageBalance } from "@/lib/pure/debts/mortgage-balance";
import {
  accountTypeToPerformanceCategory,
  PERF_CATEGORY_PORTFOLIO,
} from "@/lib/config/display-labels";
import type { isRetirementParent } from "@/lib/config/account-types";
import {
  sumAccounts,
  computeReturn,
  type AccountLike,
} from "@/lib/pure/investments/returns";

/** Per-category performance breakdown (contributions, gains, distributions). */
export type CategoryPerformance = {
  endingBalance: number;
  contributions: number;
  employerMatch: number;
  gainLoss: number;
  distributions: number;
  /** Portion of employerMatch that is a purchase-price discount (e.g. ESPP),
   *  not real cash — see isDiscountBasisEmployerContrib(). 0 when no
   *  discount-kind account contributes to this category/year. */
  employerMatchDiscount: number;
};

/** Tax-type distribution within a parent category. */
export type TaxLocationBreakdown = {
  retirement: Record<string, number>; // taxType → amount
  portfolio: Record<string, number>; // taxType → amount
};

/** Unified year-end row returned by buildYearEndHistory. */
export type YearEndRow = {
  year: number;
  yearEndDate: string;
  isCurrent: boolean;
  // Net worth
  netWorth: number;
  // Portfolio (from annual_performance when finalized, otherwise net_worth_annual or live snapshot)
  portfolioTotal: number;
  portfolioByType: Record<string, number>; // keyed by accountType ('401k', '403b', 'ira', 'hsa', 'brokerage')
  // Non-portfolio assets
  cash: number;
  houseValue: number;
  otherAssets: number;
  homeImprovements: number;
  // Liabilities
  mortgageBalance: number;
  otherLiabilities: number;
  // Income & tax
  grossIncome: number;
  combinedAgi: number;
  ssaEarnings: number | null;
  effectiveTaxRate: number | null;
  taxesPaid: number | null;
  propertyTaxes: number | null;
  // Performance summary (from annual_performance — Portfolio category)
  perfBeginningBalance: number | null;
  perfContributions: number | null;
  perfEmployerMatch: number | null;
  perfGainLoss: number | null;
  perfEndingBalance: number | null;
  perfReturnPct: number | null;
  /** Per-account performance breakdown (from account_performance table). */
  perfByAccount: {
    label: string;
    accountType: string;
    beginningBalance: number;
    contributions: number;
    employerMatch: number;
    gainLoss: number;
    endingBalance: number;
  }[];
  /** When performance data was last synced (ISO string). Set for current year to explain
   *  why End Bal (from snapshot) may differ from Beg + Contribs + Gain/Loss. */
  perfLastUpdated: string | null;
  /** Snapshot date used for End Bal on current year (ISO string). */
  snapshotDate: string | null;
  /** How many days old the snapshot is (current-year row only). Null for prior years. */
  snapshotAgeDays: number | null;
  /** Performance breakdown by display category (keys from accountTypeToPerformanceCategory). */
  performanceByCategory: Record<string, CategoryPerformance>;
  /** Portfolio broken down by parentCategory × taxType. Available from snapshot for current year;
   *  approximated from portfolioByType + account config for prior years. */
  portfolioByTaxLocation: TaxLocationBreakdown | null;
  /** Performance breakdown by parentCategory (Retirement / Portfolio).
   *  Derived from account_performance rows grouped by their parentCategory field. */
  performanceByParentCategory: Record<string, CategoryPerformance>;
  /** Fraction of year elapsed (periodsElapsed / periodsPerYear). 1.0 for finalized years.
   *  Used to annualize YTD flow metrics for meaningful year-over-year comparisons. */
  ytdRatio: number;
  // Computed wealth metrics (single computation path — all consumers read these)
  /** Net worth / lifetime earnings (savings efficiency %) — market value. */
  wealthScoreMarket: number;
  /** Net worth / lifetime earnings (savings efficiency %) — cost basis. */
  wealthScoreCostBasis: number;
  /** Money Guy Wealth Accumulator — market value. */
  aawScoreMarket: number;
  /** Money Guy Wealth Accumulator — cost basis. */
  aawScoreCostBasis: number;
  /** (portfolioTotal + cash) / fiTarget. */
  fiProgress: number;
  /** annualExpenses / withdrawalRate. */
  fiTarget: number;
  /** Market-value net worth (home at estimated value). */
  netWorthMarket: number;
  /** Cost-basis net worth (home at purchase + improvements). */
  netWorthCostBasis: number;
  /** Home value at cost basis (purchase price + cumulative improvements). */
  houseValueCostBasis: number;
  // Inputs used for computed metrics (for display / debugging)
  /** Average age across all household members for this year. */
  averageAge: number;
  /** Gross pretax income (AGI where gross wasn't recorded), optionally 3yr averaged. */
  effectiveIncome: number;
  /** Cumulative gross income (AGI where gross wasn't recorded) through this year. */
  lifetimeEarnings: number;
  /** Annual expenses from budget. */
  annualExpenses: number;
  /** Withdrawal rate from retirement settings. */
  withdrawalRate: number;
  /** True when withdrawalRate is the hardcoded default (no retirement settings configured). */
  withdrawalRateIsDefault: boolean;
};

export function homeFiguresByYear(
  homeImprovementItems: { year: number; cost: string }[],
  nwRows: { yearEndDate: string }[],
  propTaxRows: { year: number; taxAmount: string }[],
) {
  const homeImprovementsCumulativeByYear = new Map<number, number>();
  {
    let cumulative = 0;
    const allYears = new Set([
      ...homeImprovementItems.map((i) => i.year),
      ...nwRows.map((r) => calendarYear(r.yearEndDate)),
    ]);
    for (const year of Array.from(allYears).sort()) {
      const yearItems = homeImprovementItems.filter((i) => i.year <= year);
      cumulative = yearItems.reduce((s, i) => s + toNumber(i.cost), 0);
      homeImprovementsCumulativeByYear.set(year, cumulative);
    }
  }

  // Build property tax lookup by year (sum across all loans for a given year)
  const propTaxByYear = new Map<number, number>();
  for (const pt of propTaxRows) {
    propTaxByYear.set(
      pt.year,
      (propTaxByYear.get(pt.year) ?? 0) + toNumber(pt.taxAmount),
    );
  }
  return { homeImprovementsCumulativeByYear, propTaxByYear };
}

export function yearEndPerformance(
  accountPerfRows: (AccountLike & {
    id: number;
    year: number;
    institution: string;
    accountLabel: string;
    performanceAccountId: number | null;
  })[],
  annualPerfRows: {
    year: number;
    category: ReturnType<typeof accountTypeToPerformanceCategory>;
    isFinalized: boolean;
    beginningBalance: string;
    totalContributions: string;
    employerContributions: string;
    yearlyGainLoss: string;
    endingBalance: string;
    distributions: string;
    annualReturnPct: string | null;
  }[],
  resolveHistoryMaster: (acct: {
    id: number;
    performanceAccountId: number | null;
    institution: string;
    accountLabel: string;
  }) => {
    accountType: NonNullable<
      Parameters<typeof accountTypeToPerformanceCategory>[0]
    >;
    parentCategory: NonNullable<Parameters<typeof isRetirementParent>[0]>;
  },
) {
  const perfPortfolioByYear = new Map<
    number,
    { portfolioTotal: number; byType: Record<string, number> }
  >();
  const allPerfAccountYears = new Set(accountPerfRows.map((a) => a.year));
  for (const year of Array.from(allPerfAccountYears)) {
    const yearAccounts = accountPerfRows.filter((a) => a.year === year);
    let portfolioTotal = 0;
    const byType: Record<string, number> = {};
    for (const acct of yearAccounts) {
      const endBal = toNumber(acct.endingBalance);
      const master = resolveHistoryMaster(acct);
      portfolioTotal += endBal;
      byType[master.accountType] = (byType[master.accountType] ?? 0) + endBal;
    }
    perfPortfolioByYear.set(year, { portfolioTotal, byType });
  }

  // Build per-account performance detail by year (for tooltip breakdowns)
  const perfByAccountByYear = new Map<number, YearEndRow["perfByAccount"]>();
  for (const year of Array.from(allPerfAccountYears)) {
    const yearAccounts = accountPerfRows.filter((a) => a.year === year);
    const accounts: YearEndRow["perfByAccount"] = yearAccounts.map((acct) => ({
      label: `${acct.institution} — ${acct.accountLabel.replace(` (${acct.institution})`, "")}`,
      accountType: resolveHistoryMaster(acct).accountType,
      beginningBalance: toNumber(acct.beginningBalance),
      contributions: toNumber(acct.totalContributions),
      employerMatch: toNumber(acct.employerContributions),
      gainLoss: toNumber(acct.yearlyGainLoss),
      endingBalance: toNumber(acct.endingBalance),
    }));
    perfByAccountByYear.set(year, accounts);
  }

  // Build performance breakdown by display category per year (for spreadsheet view).
  // Uses annualPerformance for finalized non-Portfolio categories, falls back to
  // aggregating accountPerformance rows by accountTypeToPerformanceCategory().
  const perfByCategoryByYear = new Map<
    number,
    Record<string, CategoryPerformance>
  >();
  // 1. Populate from finalized annual_performance rows (non-Portfolio categories)
  for (const row of annualPerfRows) {
    if (!row.isFinalized || row.category === PERF_CATEGORY_PORTFOLIO) continue;
    const yearMap = perfByCategoryByYear.get(row.year) ?? {};
    yearMap[row.category] = {
      endingBalance: toNumber(row.endingBalance),
      contributions: toNumber(row.totalContributions),
      employerMatch: toNumber(row.employerContributions),
      gainLoss: toNumber(row.yearlyGainLoss),
      distributions: toNumber(row.distributions),
      employerMatchDiscount: 0, // backfilled by buildYearEndHistory's step 3
    };
    perfByCategoryByYear.set(row.year, yearMap);
  }

  // 2. For years without finalized annual rows, compute from account_performance
  for (const year of Array.from(allPerfAccountYears)) {
    if (perfByCategoryByYear.has(year)) continue;
    const yearAccounts = accountPerfRows.filter((a) => a.year === year);
    const yearMap: Record<string, CategoryPerformance> = {};
    for (const acct of yearAccounts) {
      const master = resolveHistoryMaster(acct);
      const category = accountTypeToPerformanceCategory(master.accountType);
      const existing = yearMap[category] ?? {
        endingBalance: 0,
        contributions: 0,
        employerMatch: 0,
        gainLoss: 0,
        distributions: 0,
        employerMatchDiscount: 0, // backfilled by buildYearEndHistory's step 3
      };
      existing.endingBalance += toNumber(acct.endingBalance);
      existing.contributions += toNumber(acct.totalContributions);
      existing.employerMatch += toNumber(acct.employerContributions);
      existing.gainLoss += toNumber(acct.yearlyGainLoss);
      existing.distributions += toNumber(acct.distributions);
      yearMap[category] = existing;
    }
    perfByCategoryByYear.set(year, yearMap);
  }
  return {
    perfPortfolioByYear,
    allPerfAccountYears,
    perfByAccountByYear,
    perfByCategoryByYear,
  };
}

export function yearEndPerformanceSummary(
  accountPerfRows: Parameters<typeof yearEndPerformance>[0],
  annualPerfRows: Parameters<typeof yearEndPerformance>[1],
  allPerfAccountYears: Set<number>,
  resolveHistoryMaster: Parameters<typeof yearEndPerformance>[2],
) {
  const perfByParentCategoryByYear = new Map<
    number,
    Record<string, CategoryPerformance>
  >();
  for (const year of Array.from(allPerfAccountYears)) {
    const yearAccounts = accountPerfRows.filter((a) => a.year === year);
    const yearMap: Record<string, CategoryPerformance> = {};
    for (const acct of yearAccounts) {
      const master = resolveHistoryMaster(acct);
      const parentCategory = master.parentCategory;
      const existing = yearMap[parentCategory] ?? {
        endingBalance: 0,
        contributions: 0,
        employerMatch: 0,
        gainLoss: 0,
        distributions: 0,
        // Type symmetry only — nothing currently reads a parent-category
        // employerMatchDiscount (the Trends table's cashBasisAccessor only
        // sits on per-category rows), so this isn't backfilled.
        employerMatchDiscount: 0,
      };
      existing.endingBalance += toNumber(acct.endingBalance);
      existing.contributions += toNumber(acct.totalContributions);
      existing.employerMatch += toNumber(acct.employerContributions);
      existing.gainLoss += toNumber(acct.yearlyGainLoss);
      existing.distributions += toNumber(acct.distributions);
      yearMap[parentCategory] = existing;
    }
    perfByParentCategoryByYear.set(year, yearMap);
  }

  // Build annual_performance summary by year — prefer finalized "Portfolio" category,
  // fall back to computing from account_performance data (same as performance page getSummary)
  type PerfSummary = {
    beginningBalance: number;
    contributions: number;
    employerMatch: number;
    gainLoss: number;
    endingBalance: number;
    returnPct: number | null;
  };
  const perfSummaryByYear = new Map<number, PerfSummary>();

  // 1. Finalized Portfolio annual rows (authoritative)
  for (const row of annualPerfRows) {
    if (!row.isFinalized || row.category !== PERF_CATEGORY_PORTFOLIO) continue;
    perfSummaryByYear.set(row.year, {
      beginningBalance: toNumber(row.beginningBalance),
      contributions: toNumber(row.totalContributions),
      employerMatch: toNumber(row.employerContributions),
      gainLoss: toNumber(row.yearlyGainLoss),
      endingBalance: toNumber(row.endingBalance),
      returnPct:
        row.annualReturnPct !== null ? toNumber(row.annualReturnPct) : null,
    });
  }

  // 2. For years with account_performance data but no finalized Portfolio annual row,
  // compute summary from account data (mirrors performance page getSummary logic)
  const allAccountYears = new Set(accountPerfRows.map((a) => a.year));
  for (const year of Array.from(allAccountYears)) {
    if (perfSummaryByYear.has(year)) continue; // already have finalized data
    const yearAccounts = accountPerfRows.filter((a) => a.year === year);
    if (yearAccounts.length === 0) continue;
    const sums = sumAccounts(yearAccounts);
    perfSummaryByYear.set(year, {
      beginningBalance: sums.beginBal,
      contributions: sums.contribs,
      employerMatch: sums.employer,
      gainLoss: sums.gainLoss,
      endingBalance: sums.endBal,
      returnPct: computeReturn(
        sums.beginBal,
        sums.contribs,
        sums.gainLoss,
        sums.distributions,
        sums.fees,
        sums.rollovers,
      ),
    });
  }
  return { perfByParentCategoryByYear, perfSummaryByYear };
}

export function mortgageBalanceByYearFrom(
  mortgageLoans: (Parameters<typeof computeMortgageBalance>[0][number] & {
    firstPaymentDate: string;
  })[],
  nwRows: { yearEndDate: string }[],
  extraPayments: Parameters<typeof computeMortgageBalance>[1],
  asOfDate: Date,
) {
  const earliestLoanYear =
    mortgageLoans.length > 0
      ? Math.min(...mortgageLoans.map((l) => calendarYear(l.firstPaymentDate)))
      : Infinity;
  const mortgageBalanceByYear = new Map<number, number>();
  for (const r of nwRows) {
    const year = calendarYear(r.yearEndDate);
    if (mortgageLoans.length > 0 && year >= earliestLoanYear) {
      const yearEnd = new Date(year, 11, 31); // Dec 31
      mortgageBalanceByYear.set(
        year,
        computeMortgageBalance(mortgageLoans, extraPayments, yearEnd, asOfDate),
      );
    }
  }
  return { mortgageBalanceByYear };
}

export function storedYearEndRows(
  nwRows: {
    yearEndDate: string;
    portfolioTotal: string | null;
    retirementTotal: string | null;
    hsa: string | null;
    ltBrokerage: string | null;
    espp: string | null;
    rBrokerage: string | null;
    cash: string | null;
    houseValue: string | null;
    otherAssets: string | null;
    mortgageBalance: string | null;
    otherLiabilities: string | null;
    grossIncome: string | null;
    combinedAgi: string | null;
    ssaEarnings: string | null;
    effectiveTaxRate: string | null;
    taxesPaid: string | null;
    propertyTaxes: string | null;
    portfolioByTaxLocation: unknown;
  }[],
  perfPortfolioByYear: ReturnType<
    typeof yearEndPerformance
  >["perfPortfolioByYear"],
  perfSummaryByYear: ReturnType<
    typeof yearEndPerformanceSummary
  >["perfSummaryByYear"],
  mortgageBalanceByYear: Map<number, number>,
  homeImprovementsCumulativeByYear: Map<number, number>,
  propTaxByYear: Map<number, number>,
  perfByAccountByYear: ReturnType<
    typeof yearEndPerformance
  >["perfByAccountByYear"],
  perfByCategoryByYear: ReturnType<
    typeof yearEndPerformance
  >["perfByCategoryByYear"],
  perfByParentCategoryByYear: ReturnType<
    typeof yearEndPerformanceSummary
  >["perfByParentCategoryByYear"],
) {
  const history: YearEndRow[] = nwRows.map((r) => {
    const year = calendarYear(r.yearEndDate);
    const perf = perfPortfolioByYear.get(year);
    const perfSummary = perfSummaryByYear.get(year);

    // Portfolio fields: prefer finalized performance data over stored net_worth_annual
    const portfolioTotal = perf?.portfolioTotal ?? toNumber(r.portfolioTotal);
    // Portfolio breakdown by accountType: prefer perf data, fall back to legacy columns
    const portfolioByType: Record<string, number> = perf?.byType ?? {
      "401k": toNumber(r.retirementTotal), // legacy: 401k+403b+IRA combined
      hsa: toNumber(r.hsa),
      brokerage:
        toNumber(r.ltBrokerage) + toNumber(r.espp) + toNumber(r.rBrokerage),
    };

    // Non-portfolio fields always from net_worth_annual
    const cash = toNumber(r.cash);
    const houseValue = toNumber(r.houseValue);
    const otherAssets = toNumber(r.otherAssets);
    // Mortgage balance: derived from loan amortization when loan data covers this year,
    // falls back to manual netWorthAnnual.mortgageBalance for years predating loan data
    const mortgageBalance =
      mortgageBalanceByYear.get(year) ?? toNumber(r.mortgageBalance);
    const otherLiabilities = toNumber(r.otherLiabilities);
    const netWorth =
      portfolioTotal +
      cash +
      houseValue +
      otherAssets -
      mortgageBalance -
      otherLiabilities;

    return {
      year,
      yearEndDate: r.yearEndDate,
      isCurrent: false,
      netWorth,
      portfolioTotal,
      portfolioByType,
      cash,
      houseValue,
      otherAssets,
      homeImprovements: homeImprovementsCumulativeByYear.get(year) ?? 0,
      mortgageBalance,
      otherLiabilities,
      grossIncome: toNumber(r.grossIncome),
      combinedAgi: toNumber(r.combinedAgi),
      ssaEarnings: r.ssaEarnings ? toNumber(r.ssaEarnings) : null,
      effectiveTaxRate: r.effectiveTaxRate
        ? toNumber(r.effectiveTaxRate)
        : null,
      taxesPaid: r.taxesPaid ? toNumber(r.taxesPaid) : null,
      propertyTaxes:
        propTaxByYear.get(year) ??
        (r.propertyTaxes ? toNumber(r.propertyTaxes) : null),
      perfBeginningBalance: perfSummary?.beginningBalance ?? null,
      perfContributions: perfSummary?.contributions ?? null,
      perfEmployerMatch: perfSummary?.employerMatch ?? null,
      perfGainLoss: perfSummary?.gainLoss ?? null,
      perfEndingBalance: perfSummary?.endingBalance ?? null,
      perfReturnPct: perfSummary?.returnPct ?? null,
      perfByAccount: perfByAccountByYear.get(year) ?? [],
      perfLastUpdated: null,
      snapshotDate: null,
      snapshotAgeDays: null,
      performanceByCategory: perfByCategoryByYear.get(year) ?? {},
      performanceByParentCategory: perfByParentCategoryByYear.get(year) ?? {},
      portfolioByTaxLocation: r.portfolioByTaxLocation as TaxLocationBreakdown,
      ytdRatio: 1, // finalized year — full year
      // Placeholders — set by yearEndWealthMetrics once all rows are built
      wealthScoreMarket: 0,
      wealthScoreCostBasis: 0,
      aawScoreMarket: 0,
      aawScoreCostBasis: 0,
      fiProgress: 0,
      fiTarget: 0,
      netWorthMarket: netWorth,
      netWorthCostBasis: netWorth, // overwritten by yearEndWealthMetrics
      houseValueCostBasis: 0, // overwritten by yearEndWealthMetrics
      averageAge: 0,
      effectiveIncome: 0,
      lifetimeEarnings: 0,
      annualExpenses: 0,
      withdrawalRate: 0,
      withdrawalRateIsDefault: false,
    };
  });
  return { history };
}
