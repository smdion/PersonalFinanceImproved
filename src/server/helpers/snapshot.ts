/**
 * Portfolio snapshot and year-end history helpers.
 */
import { eq, desc, asc } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { AccountCategory } from "@/lib/calculators/types";
import { num } from "./transforms";
import type { Db } from "./transforms";
import { parseAppSettings } from "./settings";
import { stripInstitutionSuffix } from "@/lib/utils/format";
import { log } from "@/lib/logger";
import { getSalariesForJobs } from "./salary";
import { getEffectiveCash, getEffectiveOtherAssets } from "./budget";
import { computeMortgageBalance } from "./mortgage";

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
    amount: num(a.amount),
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
  ]);

  // Build property tax lookup by year (sum across all loans for a given year)
  const propTaxByYear = new Map<number, number>();
  for (const pt of propTaxRows) {
    propTaxByYear.set(
      pt.year,
      (propTaxByYear.get(pt.year) ?? 0) + num(pt.taxAmount),
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
      const endBal = num(acct.endingBalance);
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
      beginningBalance: num(acct.beginningBalance),
      contributions: num(acct.totalContributions),
      employerMatch: num(acct.employerContributions),
      gainLoss: num(acct.yearlyGainLoss),
      endingBalance: num(acct.endingBalance),
    }));
    perfByAccountByYear.set(year, accounts);
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
      beginningBalance: num(row.beginningBalance),
      contributions: num(row.totalContributions),
      employerMatch: num(row.employerContributions),
      gainLoss: num(row.yearlyGainLoss),
      endingBalance: num(row.endingBalance),
      returnPct: row.annualReturnPct !== null ? num(row.annualReturnPct) : null,
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
      beginBal += num(a.beginningBalance);
      contribs += num(a.totalContributions);
      employer += num(a.employerContributions);
      gainLoss += num(a.yearlyGainLoss);
      endBal += num(a.endingBalance);
      distributions += num(a.distributions);
      fees += num(a.fees);
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
    const portfolioTotal = perf?.portfolioTotal ?? num(r.portfolioTotal);
    // Portfolio breakdown by accountType: prefer perf data, fall back to legacy columns
    const portfolioByType: Record<string, number> = perf?.byType ?? {
      "401k": num(r.retirementTotal), // legacy: 401k+403b+IRA combined
      hsa: num(r.hsa),
      brokerage: num(r.ltBrokerage) + num(r.espp) + num(r.rBrokerage),
    };

    // Non-portfolio fields always from net_worth_annual
    const cash = num(r.cash);
    const houseValue = num(r.houseValue);
    const otherAssets = num(r.otherAssets);
    // Mortgage balance: derived from loan amortization when loan data covers this year,
    // falls back to manual netWorthAnnual.mortgageBalance for years predating loan data
    const mortgageBalance =
      mortgageBalanceByYear.get(year) ?? num(r.mortgageBalance);
    const otherLiabilities = num(r.otherLiabilities);
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
      homeImprovements: num(r.homeImprovementsCumulative),
      mortgageBalance,
      otherLiabilities,
      grossIncome: num(r.grossIncome),
      combinedAgi: num(r.combinedAgi),
      ssaEarnings: r.ssaEarnings ? num(r.ssaEarnings) : null,
      effectiveTaxRate: r.effectiveTaxRate ? num(r.effectiveTaxRate) : null,
      taxesPaid: r.taxesPaid ? num(r.taxesPaid) : null,
      propertyTaxes:
        propTaxByYear.get(year) ??
        (r.propertyTaxes ? num(r.propertyTaxes) : null),
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
      ? num(
          activeLoan.propertyValueEstimated ?? activeLoan.propertyValuePurchase,
        )
      : 0;

    // Gross income from active jobs
    const activeJobs = jobs.filter((j) => !j.endDate);
    const jobSalaries = await getSalariesForJobs(db, activeJobs);
    const combinedGross = jobSalaries.reduce(
      (s, js) => s + js.effectiveIncome,
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
        beginBal += num(a.beginningBalance);
        contribs += num(a.totalContributions);
        employer += num(a.employerContributions);
        gainLoss += num(a.yearlyGainLoss);
        distributions += num(a.distributions);
        fees += num(a.fees);
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
        beginningBalance: num(currentPortfolioRow.beginningBalance),
        contributions: num(currentPortfolioRow.totalContributions),
        employerMatch: num(currentPortfolioRow.employerContributions),
        gainLoss: num(currentPortfolioRow.yearlyGainLoss),
        endingBalance: num(currentPortfolioRow.endingBalance),
        returnPct:
          currentPortfolioRow.annualReturnPct !== null
            ? num(currentPortfolioRow.annualReturnPct)
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
    });
  }

  _yearEndCache = { data: history, expiresAt: Date.now() + 5_000 };
  return history;
}

/** Invalidate the buildYearEndHistory cache (call after mutations that affect its data). */
export function invalidateYearEndCache(): void {
  _yearEndCache = null;
}
