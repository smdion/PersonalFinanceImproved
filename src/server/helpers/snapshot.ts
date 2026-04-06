/**
 * Portfolio snapshot and year-end history helpers.
 */
import { eq, desc, asc } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { AccountCategory } from "@/lib/calculators/types";
import { toNumber } from "./transforms";
import type { Db } from "./transforms";
import { parseAppSettings } from "./settings";
import { stripInstitutionSuffix } from "@/lib/utils/format";
import { log } from "@/lib/logger";
import { getSalariesForJobs, getTotalCompensation } from "./salary";
import {
  getEffectiveCash,
  getEffectiveOtherAssets,
  getAnnualExpensesFromBudget,
} from "./budget";
import { computeMortgageBalance } from "./mortgage";
import { calculateNetWorth } from "@/lib/calculators/net-worth";
import { countPeriodsElapsed } from "@/lib/calculators/paycheck";
import type { NetWorthInput } from "@/lib/calculators/types";
import { PAY_PERIOD_CONFIG } from "@/lib/config/pay-periods";
import { accountTypeToPerformanceCategory } from "@/lib/config/display-labels";

// ---------------------------------------------------------------------------
// Snapshot account grouping
// ---------------------------------------------------------------------------

/**
 * Group portfolio accounts by snapshotId.
 * Replaces the identical Map-building loop in networth getSnapshotList and getSnapshots.
 */
export function groupSnapshotAccounts<T extends { snapshotId: number }>(
  accounts: T[],
): Map<number, T[]> {
  const map = new Map<number, T[]>();
  for (const a of accounts) {
    const arr = map.get(a.snapshotId) ?? [];
    arr.push(a);
    map.set(a.snapshotId, arr);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Latest portfolio snapshot
// ---------------------------------------------------------------------------

export type SnapshotAccount = {
  institution: string;
  taxType: string;
  accountType: AccountCategory;
  subType: string | null;
  label: string | null;
  parentCategory: string | null;
  amount: number;
  ownerPersonId: number | null;
  performanceAccountId: number | null;
  displayName: string | null;
  accountLabel: string | null;
};

export type SnapshotResult = {
  snapshot: typeof schema.portfolioSnapshots.$inferSelect;
  accounts: SnapshotAccount[];
  total: number;
};

/**
 * Fetch a specific snapshot by ID, or the latest if no ID is given.
 * Returns null if the snapshot doesn't exist.
 */
export async function getLatestSnapshot(
  db: Db,
  snapshotId?: number,
): Promise<SnapshotResult | null> {
  let snapshot: typeof schema.portfolioSnapshots.$inferSelect | undefined;
  if (snapshotId != null) {
    const rows = await db
      .select()
      .from(schema.portfolioSnapshots)
      .where(eq(schema.portfolioSnapshots.id, snapshotId))
      .limit(1);
    snapshot = rows[0];
  } else {
    const rows = await db
      .select()
      .from(schema.portfolioSnapshots)
      .orderBy(desc(schema.portfolioSnapshots.snapshotDate))
      .limit(1);
    snapshot = rows[0];
  }
  if (!snapshot) return null;

  const rawAccounts = await db
    .select({
      institution: schema.portfolioAccounts.institution,
      taxType: schema.portfolioAccounts.taxType,
      accountType: schema.portfolioAccounts.accountType,
      subType: schema.portfolioAccounts.subType,
      label: schema.portfolioAccounts.label,
      parentCategory: schema.portfolioAccounts.parentCategory,
      amount: schema.portfolioAccounts.amount,
      ownerPersonId: schema.portfolioAccounts.ownerPersonId,
      performanceAccountId: schema.portfolioAccounts.performanceAccountId,
      accountLabel: schema.performanceAccounts.accountLabel,
      displayName: schema.performanceAccounts.displayName,
      perfParentCategory: schema.performanceAccounts.parentCategory,
    })
    .from(schema.portfolioAccounts)
    .leftJoin(
      schema.performanceAccounts,
      eq(
        schema.portfolioAccounts.performanceAccountId,
        schema.performanceAccounts.id,
      ),
    )
    .where(eq(schema.portfolioAccounts.snapshotId, snapshot.id));

  const accounts: SnapshotAccount[] = rawAccounts.map((a) => ({
    institution: a.institution,
    taxType: a.taxType,
    accountType: a.accountType as AccountCategory,
    subType: a.subType,
    label: a.label,
    parentCategory: a.perfParentCategory ?? a.parentCategory,
    amount: toNumber(a.amount),
    ownerPersonId: a.ownerPersonId,
    performanceAccountId: a.performanceAccountId,
    displayName: a.displayName,
    accountLabel: a.accountLabel,
  }));
  const total = accounts.reduce(
    (s: number, a: SnapshotAccount) => s + a.amount,
    0,
  );

  return { snapshot, accounts, total };
}

// ---------------------------------------------------------------------------
// Year-end history rows (used by historical + networth routers)
// ---------------------------------------------------------------------------

/** Per-category performance breakdown (contributions, gains, distributions). */
export type CategoryPerformance = {
  endingBalance: number;
  contributions: number;
  employerMatch: number;
  gainLoss: number;
  distributions: number;
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
  /** Fraction of year elapsed (periodsElapsed / periodsPerYear). 1.0 for finalized years.
   *  Used to annualize YTD flow metrics for meaningful year-over-year comparisons. */
  ytdRatio: number;
  // Computed wealth metrics (single computation path — all consumers read these)
  /** Net worth / lifetime earnings (savings efficiency %). */
  wealthScore: number;
  /** Money Guy Wealth Accumulator: netWorth / ((avgAge × income) / (10 + yearsUntil40)). */
  aawScore: number;
  /** (portfolioTotal + cash) / fiTarget. */
  fiProgress: number;
  /** annualExpenses / withdrawalRate. */
  fiTarget: number;
  /** Market-value net worth (home at estimated value). */
  netWorthMarket: number;
  /** Cost-basis net worth (home at purchase + improvements). */
  netWorthCostBasis: number;
  // Inputs used for computed metrics (for display / debugging)
  /** Average age across all household members for this year. */
  averageAge: number;
  /** CombinedAGI (or grossIncome fallback), optionally 3yr averaged. */
  effectiveIncome: number;
  /** Cumulative AGI through this year. */
  lifetimeEarnings: number;
  /** Annual expenses from budget. */
  annualExpenses: number;
  /** Withdrawal rate from retirement settings. */
  withdrawalRate: number;
};

/**
 * Build unified year-end history rows from net_worth_annual + annual_performance.
 *
 * This is the single source of truth for historical year-end data, used by both
 * the historical and networth routers. It:
 * 1. Reads all finalized net_worth_annual rows
 * 2. Overlays portfolio data from finalized annual_performance (source of truth)
 * 3. Appends a current-year YTD row from live app state if not yet finalized
 *
 * Eliminates the duplicated logic that previously existed in both routers.
 *
 * Results are cached for 5 seconds to deduplicate concurrent calls (e.g. NetWorth
 * page fires getSummary + getHistory in parallel, both of which call this function).
 */
let _yearEndCache: { data: YearEndRow[]; expiresAt: number } | null = null;

export async function buildYearEndHistory(db: Db): Promise<YearEndRow[]> {
  if (_yearEndCache && Date.now() < _yearEndCache.expiresAt) {
    return _yearEndCache.data;
  }
  const [
    nwRows,
    perfAccounts,
    accountPerfRows,
    annualPerfRows,
    mortgageLoans,
    extraPayments,
    settings,
    jobs,
    snapshotData,
    propTaxRows,
    people,
    retirementSettingsRows,
    annualExpensesBudget,
  ] = await Promise.all([
    db
      .select()
      .from(schema.netWorthAnnual)
      .orderBy(asc(schema.netWorthAnnual.yearEndDate)),
    db.select().from(schema.performanceAccounts),
    db.select().from(schema.accountPerformance),
    db.select().from(schema.annualPerformance),
    db.select().from(schema.mortgageLoans),
    db
      .select()
      .from(schema.mortgageExtraPayments)
      .orderBy(asc(schema.mortgageExtraPayments.paymentDate)),
    db.select().from(schema.appSettings),
    db.select().from(schema.jobs).orderBy(asc(schema.jobs.startDate)),
    getLatestSnapshot(db),
    db.select().from(schema.propertyTaxes),
    db.select().from(schema.people).orderBy(asc(schema.people.id)),
    db.select().from(schema.retirementSettings),
    getAnnualExpensesFromBudget(db),
  ]);

  // Build property tax lookup by year (sum across all loans for a given year)
  const propTaxByYear = new Map<number, number>();
  for (const pt of propTaxRows) {
    propTaxByYear.set(
      pt.year,
      (propTaxByYear.get(pt.year) ?? 0) + toNumber(pt.taxAmount),
    );
  }

  // Build performance account lookups (by ID + fallback by institution:label)
  const perfAcctMap = new Map(perfAccounts.map((pa) => [pa.id, pa]));
  const perfAcctByInstLabel = new Map<string, (typeof perfAccounts)[0]>();
  for (const pa of perfAccounts) {
    const labelBase = stripInstitutionSuffix(pa.accountLabel);
    perfAcctByInstLabel.set(`${pa.institution}:${labelBase}`, pa);
  }

  /** Resolve master performance_account with fallback for null performanceAccountId. */
  function resolveHistoryMaster(acct: {
    performanceAccountId: number | null;
    institution: string;
    accountLabel: string;
  }) {
    if (acct.performanceAccountId)
      return perfAcctMap.get(acct.performanceAccountId) ?? null;
    // DEPRECATED: institution+label fallback — will be removed once all rows have performanceAccountId
    const fallback =
      perfAcctByInstLabel.get(`${acct.institution}:${acct.accountLabel}`) ??
      null;
    if (fallback) {
      log("warn", "perf_acct_fallback_match", {
        institution: acct.institution,
        label: acct.accountLabel,
      });
    }
    return fallback;
  }

  // Build performance portfolio breakdown by year
  // (from account_performance ending balances, grouped by accountType)
  // Includes ALL years with account data, not just finalized — so historical page
  // can show portfolio breakdown even for years without finalized annual rows.
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
      const accountType = master?.accountType ?? "unknown";

      portfolioTotal += endBal;
      byType[accountType] = (byType[accountType] ?? 0) + endBal;
    }

    perfPortfolioByYear.set(year, { portfolioTotal, byType });
  }

  // Build per-account performance detail by year (for tooltip breakdowns)
  const perfByAccountByYear = new Map<number, YearEndRow["perfByAccount"]>();
  for (const year of Array.from(allPerfAccountYears)) {
    const yearAccounts = accountPerfRows.filter((a) => a.year === year);
    const accounts: YearEndRow["perfByAccount"] = yearAccounts.map((acct) => ({
      label: `${acct.institution} — ${acct.accountLabel}`,
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
    if (!row.isFinalized || row.category === "Portfolio") continue;
    const yearMap = perfByCategoryByYear.get(row.year) ?? {};
    yearMap[row.category] = {
      endingBalance: toNumber(row.endingBalance),
      contributions: toNumber(row.totalContributions),
      employerMatch: toNumber(row.employerContributions),
      gainLoss: toNumber(row.yearlyGainLoss),
      distributions: toNumber(row.distributions),
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
      const category = accountTypeToPerformanceCategory(
        master?.accountType ?? null,
      );
      const existing = yearMap[category] ?? {
        endingBalance: 0,
        contributions: 0,
        employerMatch: 0,
        gainLoss: 0,
        distributions: 0,
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
    if (!row.isFinalized || row.category !== "Portfolio") continue;
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
    let beginBal = 0,
      contribs = 0,
      employer = 0,
      gainLoss = 0,
      endBal = 0,
      distributions = 0,
      fees = 0;
    for (const a of yearAccounts) {
      beginBal += toNumber(a.beginningBalance);
      contribs += toNumber(a.totalContributions);
      employer += toNumber(a.employerContributions);
      gainLoss += toNumber(a.yearlyGainLoss);
      endBal += toNumber(a.endingBalance);
      distributions += toNumber(a.distributions);
      fees += toNumber(a.fees);
    }
    const denom = beginBal + (contribs + employer - distributions - fees) / 2;
    perfSummaryByYear.set(year, {
      beginningBalance: beginBal,
      contributions: contribs,
      employerMatch: employer,
      gainLoss,
      endingBalance: endBal,
      returnPct: denom !== 0 ? gainLoss / denom : null,
    });
  }

  // Pre-compute mortgage balance by year from loan amortization data.
  // If loan data covers the year, use the computed balance; otherwise fall back to manual netWorthAnnual.mortgageBalance.
  const earliestLoanYear =
    mortgageLoans.length > 0
      ? Math.min(
          ...mortgageLoans.map((l) =>
            new Date(l.firstPaymentDate).getFullYear(),
          ),
        )
      : Infinity;
  const mortgageBalanceByYear = new Map<number, number>();
  for (const r of nwRows) {
    const year = new Date(r.yearEndDate).getFullYear();
    if (mortgageLoans.length > 0 && year >= earliestLoanYear) {
      const yearEnd = new Date(year, 11, 31); // Dec 31
      mortgageBalanceByYear.set(
        year,
        computeMortgageBalance(mortgageLoans, extraPayments, yearEnd),
      );
    }
  }

  // Map net_worth_annual rows to unified YearEndRow
  const history: YearEndRow[] = nwRows.map((r) => {
    const year = new Date(r.yearEndDate).getFullYear();
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
      homeImprovements: toNumber(r.homeImprovementsCumulative),
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
      // JSONB column from net_worth_annual; fall back to legacy columns if null
      portfolioByTaxLocation:
        (r.portfolioByTaxLocation as TaxLocationBreakdown | null) ?? {
          retirement: {
            taxFree: toNumber(r.taxFreeTotal),
            preTax: toNumber(r.taxDeferredTotal),
            hsa: toNumber(r.hsa),
            afterTax: toNumber(r.rBrokerage),
          },
          portfolio: {
            afterTax: toNumber(r.ltBrokerage) + toNumber(r.espp),
          },
        },
      ytdRatio: 1, // finalized year — full year
      // Placeholders — computed in final pass after all rows are built
      wealthScore: 0,
      aawScore: 0,
      fiProgress: 0,
      fiTarget: 0,
      netWorthMarket: netWorth,
      netWorthCostBasis: netWorth, // overwritten in final pass
      averageAge: 0,
      effectiveIncome: 0,
      lifetimeEarnings: 0,
      annualExpenses: 0,
      withdrawalRate: 0,
    };
  });

  // Append current year from live data if not already in history
  const currentYear = new Date().getFullYear();
  const hasCurrentYear = history.some((h) => h.year === currentYear);
  if (!hasCurrentYear) {
    const portfolioTotal = snapshotData?.total ?? 0;
    // Group snapshot accounts by accountType for portfolio breakdown
    const portfolioByType: Record<string, number> = {};
    if (snapshotData) {
      for (const a of snapshotData.accounts) {
        const acctType = a.accountType ?? "unknown";
        portfolioByType[acctType] = (portfolioByType[acctType] ?? 0) + a.amount;
      }
    }

    const setting = parseAppSettings(settings);
    const { cash } = await getEffectiveCash(db, settings);
    const otherAssets = await getEffectiveOtherAssets(db, settings);
    const otherLiabilities = setting("current_other_liabilities", 0);

    const mortgageBalance = computeMortgageBalance(
      mortgageLoans,
      extraPayments,
    );

    const activeLoan = mortgageLoans.find((m) => m.isActive);
    const houseValue = activeLoan
      ? toNumber(
          activeLoan.propertyValueEstimated ?? activeLoan.propertyValuePurchase,
        )
      : 0;

    // Gross income from active jobs (includes bonus — matches finalized year-end data)
    const activeJobs = jobs.filter((j) => !j.endDate);
    const jobSalaries = await getSalariesForJobs(db, activeJobs);
    const combinedGross = jobSalaries.reduce(
      (s, js) => s + getTotalCompensation(js.job, js.baseSalary),
      0,
    );

    const netWorth =
      portfolioTotal +
      cash +
      houseValue +
      otherAssets -
      mortgageBalance -
      otherLiabilities;

    // Current year performance — recompute from account_performance data
    // (annual_performance rows for non-finalized years have stale zeros;
    // the performance page recomputes from account data, so we must do the same)
    const currentYearAcctPerf = accountPerfRows.filter(
      (a) => a.year === currentYear,
    );
    const currentPortfolioRow = annualPerfRows.find(
      (r) => r.year === currentYear && r.category === "Portfolio",
    );
    let perfSummary: {
      beginningBalance: number;
      contributions: number;
      employerMatch: number;
      gainLoss: number;
      endingBalance: number;
      returnPct: number | null;
    } | null = null;

    if (currentYearAcctPerf.length > 0) {
      // Sum from account_performance (same logic as performance page getSummary)
      let beginBal = 0,
        contribs = 0,
        employer = 0,
        gainLoss = 0,
        distributions = 0,
        fees = 0;
      for (const a of currentYearAcctPerf) {
        beginBal += toNumber(a.beginningBalance);
        contribs += toNumber(a.totalContributions);
        employer += toNumber(a.employerContributions);
        gainLoss += toNumber(a.yearlyGainLoss);
        distributions += toNumber(a.distributions);
        fees += toNumber(a.fees);
      }
      const denom = beginBal + (contribs + employer - distributions - fees) / 2;
      perfSummary = {
        beginningBalance: beginBal,
        contributions: contribs,
        employerMatch: employer,
        gainLoss,
        // Use snapshot total (most current) instead of stale performance ending balance
        endingBalance: portfolioTotal,
        returnPct: denom !== 0 ? gainLoss / denom : null,
      };
    } else if (currentPortfolioRow) {
      // Fallback to annual_performance row if no account data
      perfSummary = {
        beginningBalance: toNumber(currentPortfolioRow.beginningBalance),
        contributions: toNumber(currentPortfolioRow.totalContributions),
        employerMatch: toNumber(currentPortfolioRow.employerContributions),
        gainLoss: toNumber(currentPortfolioRow.yearlyGainLoss),
        endingBalance: toNumber(currentPortfolioRow.endingBalance),
        returnPct:
          currentPortfolioRow.annualReturnPct !== null
            ? toNumber(currentPortfolioRow.annualReturnPct)
            : null,
      };
    }

    history.push({
      year: currentYear,
      yearEndDate: new Date().toISOString().slice(0, 10),
      isCurrent: true,
      netWorth,
      portfolioTotal,
      portfolioByType,
      cash,
      houseValue,
      otherAssets,
      homeImprovements: setting("current_home_improvements", 0),
      mortgageBalance,
      otherLiabilities,
      grossIncome: combinedGross,
      combinedAgi: 0,
      ssaEarnings: null,
      effectiveTaxRate: null,
      taxesPaid: null,
      propertyTaxes: null,
      perfBeginningBalance: perfSummary?.beginningBalance ?? null,
      perfContributions: perfSummary?.contributions ?? null,
      perfEmployerMatch: perfSummary?.employerMatch ?? null,
      perfGainLoss: perfSummary?.gainLoss ?? null,
      perfEndingBalance: perfSummary?.endingBalance ?? null,
      perfReturnPct: perfSummary?.returnPct ?? null,
      perfByAccount: perfByAccountByYear.get(currentYear) ?? [],
      perfLastUpdated:
        (settings.find((s) => s.key === "performance_last_updated")
          ?.value as string) ?? null,
      snapshotDate: snapshotData?.snapshot.snapshotDate ?? null,
      snapshotAgeDays: snapshotData
        ? Math.floor(
            (Date.now() -
              new Date(snapshotData.snapshot.snapshotDate).getTime()) /
              86_400_000,
          )
        : null,
      performanceByCategory: (() => {
        // Prefer pre-computed data from account_performance rows
        const preComputed = perfByCategoryByYear.get(currentYear);
        if (preComputed && Object.keys(preComputed).length > 0)
          return preComputed;
        // Build from current year account_performance rows if available
        if (currentYearAcctPerf.length > 0) {
          const catMap: Record<string, CategoryPerformance> = {};
          for (const acct of currentYearAcctPerf) {
            const master = resolveHistoryMaster(acct);
            const category = accountTypeToPerformanceCategory(
              master?.accountType ?? null,
            );
            const existing = catMap[category] ?? {
              endingBalance: 0,
              contributions: 0,
              employerMatch: 0,
              gainLoss: 0,
              distributions: 0,
            };
            existing.endingBalance += toNumber(acct.endingBalance);
            existing.contributions += toNumber(acct.totalContributions);
            existing.employerMatch += toNumber(acct.employerContributions);
            existing.gainLoss += toNumber(acct.yearlyGainLoss);
            existing.distributions += toNumber(acct.distributions);
            catMap[category] = existing;
          }
          return catMap;
        }
        // Final fallback: derive ending balances from snapshot portfolioByType
        // (no contribution/gain data available — only balances)
        const catMap: Record<string, CategoryPerformance> = {};
        for (const [accountType, amount] of Object.entries(portfolioByType)) {
          const category = accountTypeToPerformanceCategory(accountType);
          const existing = catMap[category] ?? {
            endingBalance: 0,
            contributions: 0,
            employerMatch: 0,
            gainLoss: 0,
            distributions: 0,
          };
          existing.endingBalance += amount;
          catMap[category] = existing;
        }
        return catMap;
      })(),
      portfolioByTaxLocation: (() => {
        // For current year, use actual snapshot accounts with real taxType + parentCategory
        if (!snapshotData) return null;
        const breakdown: TaxLocationBreakdown = {
          retirement: {},
          portfolio: {},
        };
        for (const a of snapshotData.accounts) {
          const parentCat = a.parentCategory ?? "Retirement";
          const taxType = a.taxType ?? "preTax";
          const bucket =
            parentCat === "Portfolio"
              ? breakdown.portfolio
              : breakdown.retirement;
          bucket[taxType] = (bucket[taxType] ?? 0) + a.amount;
        }
        return breakdown;
      })(),
      // YTD ratio from paycheck schedule (salary-weighted average across jobs).
      // Uses perfLastUpdated as the reference date — annualization should match
      // the point in time when performance data was recorded, not today.
      ytdRatio: (() => {
        const perfUpdated = settings.find(
          (s) => s.key === "performance_last_updated",
        )?.value as string | undefined;
        const asOf = perfUpdated ? new Date(perfUpdated) : new Date();
        let totalSalary = 0;
        let weightedRatio = 0;
        for (const js of jobSalaries) {
          const ppy = PAY_PERIOD_CONFIG[js.job.payPeriod]?.periodsPerYear ?? 12;
          const elapsed = js.job.anchorPayDate
            ? countPeriodsElapsed(
                asOf,
                js.job.payPeriod,
                new Date(js.job.anchorPayDate),
              )
            : Math.round((asOf.getMonth() / 12) * ppy);
          const ratio = ppy > 0 ? elapsed / ppy : 0;
          const salary = getTotalCompensation(js.job, js.baseSalary);
          weightedRatio += ratio * salary;
          totalSalary += salary;
        }
        return totalSalary > 0 ? weightedRatio / totalSalary : 0;
      })(),
      // Placeholders — computed in final pass
      wealthScore: 0,
      aawScore: 0,
      fiProgress: 0,
      fiTarget: 0,
      netWorthMarket: netWorth,
      netWorthCostBasis: netWorth, // overwritten in final pass
      averageAge: 0,
      effectiveIncome: 0,
      lifetimeEarnings: 0,
      annualExpenses: 0,
      withdrawalRate: 0,
    });
  }

  // =========================================================================
  // Final pass: compute wealth metrics for every row (single computation path)
  // =========================================================================

  const setting = parseAppSettings(settings);
  const useSalaryAverage = setting("use_salary_average_3_year", 0) === 1;

  // Birth years for average age
  const birthYears = people.map((p) => new Date(p.dateOfBirth).getFullYear());

  // Withdrawal rate from primary person's retirement settings
  const primaryPerson = people.find((p) => p.isPrimaryUser) ?? people[0];
  const primaryRetSettings = primaryPerson
    ? retirementSettingsRows.find((rs) => rs.personId === primaryPerson.id)
    : retirementSettingsRows[0];
  const withdrawalRate = primaryRetSettings
    ? toNumber(primaryRetSettings.withdrawalRate)
    : 0.04;

  // Purchase price for cost basis
  const activeMortgageForCostBasis =
    mortgageLoans.find((m) => m.isActive) ?? mortgageLoans[0];
  const purchasePrice = activeMortgageForCostBasis
    ? toNumber(activeMortgageForCostBasis.propertyValuePurchase)
    : 0;

  // Sort by year for cumulative lifetime earnings
  history.sort((a, b) => a.year - b.year);
  let cumulativeEarnings = 0;

  for (const row of history) {
    // Average age for this year
    const avgAge =
      birthYears.length > 0
        ? birthYears.reduce((s, by) => s + (row.year - by), 0) /
          birthYears.length
        : 0;

    // Effective income: combinedAgi with grossIncome fallback for current year
    const yearIncome = row.combinedAgi > 0 ? row.combinedAgi : row.grossIncome;

    // Optionally average over 3 most recent years
    let effectiveIncome = yearIncome;
    if (useSalaryAverage) {
      const recent = history
        .filter(
          (h) => h.year <= row.year && (h.combinedAgi > 0 || h.grossIncome > 0),
        )
        .sort((a, b) => b.year - a.year)
        .slice(0, 3);
      if (recent.length > 0) {
        effectiveIncome =
          recent.reduce(
            (s, h) => s + (h.combinedAgi > 0 ? h.combinedAgi : h.grossIncome),
            0,
          ) / recent.length;
      }
    }

    // Cumulative lifetime earnings
    cumulativeEarnings += yearIncome;

    // Cost basis net worth
    const houseValueCostBasis =
      row.houseValue > 0 ? purchasePrice + row.homeImprovements : 0;
    const netWorthCostBasis =
      row.portfolioTotal +
      row.cash +
      houseValueCostBasis +
      row.otherAssets -
      row.mortgageBalance -
      row.otherLiabilities;

    // Call calculateNetWorth — single computation path for all metrics
    const nwInput: NetWorthInput = {
      portfolioTotal: row.portfolioTotal,
      cash: row.cash,
      homeValueEstimated: row.houseValue,
      homeValueConservative: houseValueCostBasis,
      otherAssets: row.otherAssets,
      mortgageBalance: row.mortgageBalance,
      otherLiabilities: row.otherLiabilities,
      averageAge: avgAge,
      effectiveIncome,
      lifetimeEarnings: cumulativeEarnings,
      annualExpenses: annualExpensesBudget,
      withdrawalRate,
      asOfDate: new Date(row.yearEndDate),
    };
    const result = calculateNetWorth(nwInput);

    // Write computed values back to the row
    row.wealthScore = result.wealthScore;
    row.aawScore = result.aawScore;
    row.fiProgress = result.fiProgress;
    row.fiTarget = result.fiTarget;
    row.netWorthMarket = result.netWorthMarket;
    row.netWorthCostBasis = netWorthCostBasis;
    row.averageAge = avgAge;
    row.effectiveIncome = effectiveIncome;
    row.lifetimeEarnings = cumulativeEarnings;
    row.annualExpenses = annualExpensesBudget;
    row.withdrawalRate = withdrawalRate;
  }

  _yearEndCache = { data: history, expiresAt: Date.now() + 5_000 };
  return history;
}

/** Invalidate the buildYearEndHistory cache (call after mutations that affect its data). */
export function invalidateYearEndCache(): void {
  _yearEndCache = null;
}
