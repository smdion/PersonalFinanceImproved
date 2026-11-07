/** The year-end history rows (one per year, finalized or live) and their cache. */
import { onMutationSucceeded } from "@/server/mutation-events";
import { asc } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { toNumber } from "@/lib/utils/numbers";
import { getAllPeople } from "@/server/data/people";
import { safeDivide } from "@/lib/utils/math";
import {
  parseLocalDateOnly,
  localMidnight,
  localDateStr,
} from "@/lib/utils/date";
import { parseAppSettings } from "@/lib/pure/household/app-settings";
import {
  getTotalCompensation,
  resolveCompensation,
  mergeSalaryProfileJobFields,
} from "@/lib/pure/household/compensation";
import { loadAndApplySalaryProfile } from "@/server/services/profiles/salary-profile";
import type { SalaryProfileActiveMap } from "@/lib/pure/household/compensation";
import { SK_ACTIVE_SALARY_PROFILE_ID } from "@/lib/constants/settings-keys";
import { getEffectiveCash } from "@/server/services/budget/account-balances";
import { getEffectiveOtherAssets } from "@/server/services/net-worth/other-assets";
import {
  getAnnualExpensesFromBudget,
  type BudgetTargeting,
} from "@/server/services/budget/annual-expenses";
import {
  computeMortgageBalance,
  getActiveMortgageLoan,
} from "@/lib/pure/debts/mortgage-balance";
import {
  checksPaidYtd,
  periodsBeforeStart,
} from "@/lib/pure/paycheck/paycheck";
import { payPeriodConfig } from "@/lib/config/pay-periods";
import {
  accountTypeToPerformanceCategory,
  PERF_CATEGORY_PORTFOLIO,
  PERF_CATEGORY_RETIREMENT,
} from "@/lib/config/display-labels";
import { sumAccounts, computeReturn } from "@/lib/pure/investments/returns";
import { filterActiveJobs } from "@/lib/pure/household/profiles";
import { isDiscountBasisEmployerContrib } from "@/lib/config/account-types";
import { getEffectiveOtherLiabilities } from "@/server/services/debts/other-liabilities";
import type { Db } from "@/lib/db";
import { getLatestSnapshot } from "@/server/data/snapshots";
import {
  homeFiguresByYear,
  mortgageBalanceByYearFrom,
  storedYearEndRows,
  yearEndPerformance,
  yearEndPerformanceSummary,
  type CategoryPerformance,
  type TaxLocationBreakdown,
  type YearEndRow,
} from "@/lib/pure/net-worth/year-end-rows";
import { yearEndWealthMetrics } from "@/lib/pure/net-worth/year-end-metrics";

// ---------------------------------------------------------------------------
// Year-end history rows (used by historical + networth routers)
// ---------------------------------------------------------------------------

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
 * The cache is keyed by the as-of day and the full targeting (budget profile,
 * column, session salaries), so a Plan-pinned or profile-scoped call only ever
 * reads a result built with exactly the same inputs.
 */
type YearEndHistoryTargeting = BudgetTargeting;

// A 5s cache keyed by the targeting, so one page load builds a targeted
// history once; scoped per database handle, so a demo schema never shares an
// entry, and `generation` drops a build that started before an invalidation.
const YEAR_END_CACHE_TTL_MS = 5_000;
type YearEndCacheEntry = { data: YearEndRow[]; expiresAt: number };
let _yearEndCache = new WeakMap<object, Map<string, YearEndCacheEntry>>();
let _yearEndCacheGeneration = 0;

function yearEndCacheKey(
  asOfDate: Date,
  targeting: YearEndHistoryTargeting | undefined,
) {
  return JSON.stringify([
    localDateStr(asOfDate),
    targeting?.budgetProfileId ?? null,
    targeting?.budgetColumn ?? null,
  ]);
}

export async function buildYearEndHistory(
  db: Db,
  asOfDate: Date = new Date(),
  targeting?: YearEndHistoryTargeting,
): Promise<YearEndRow[]> {
  const cacheKey = yearEndCacheKey(asOfDate, targeting);
  const generation = _yearEndCacheGeneration;
  const cached = _yearEndCache.get(db)?.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.data;
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
    retirementProfileRows,
    annualExpensesBudget,
    homeImprovementItems,
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
    getAllPeople(db),
    db.select().from(schema.retirementSettings),
    db
      .select()
      .from(schema.retirementProfiles)
      .orderBy(asc(schema.retirementProfiles.id)),
    getAnnualExpensesFromBudget(db, targeting),
    db
      .select()
      .from(schema.homeImprovementItems)
      .orderBy(asc(schema.homeImprovementItems.year)),
  ]);

  // Bonus terms have no live value on a job any more — resolve against the
  // globally-ACTIVE Salary Profile (this builds a permanent net_worth_annual
  // record, a "recorded fact," same philosophy as savings.ts's
  // computeJobNetPayPerCheck).
  const activeSalaryProfileId = Number(
    settings.find((s) => s.key === SK_ACTIVE_SALARY_PROFILE_ID)?.value ?? NaN,
  );
  const salaryProfileActiveMap: SalaryProfileActiveMap = Number.isFinite(
    activeSalaryProfileId,
  )
    ? await loadAndApplySalaryProfile(db, activeSalaryProfileId)
    : new Map();

  // Build cumulative home improvements by year from items table (source of truth).
  // The net_worth_annual.home_improvements_cumulative column is per-year, not cumulative — ignore it.
  const { homeImprovementsCumulativeByYear, propTaxByYear } = homeFiguresByYear(
    homeImprovementItems,
    nwRows,
    propTaxRows,
  );

  const perfAcctMap = new Map(perfAccounts.map((pa) => [pa.id, pa]));

  function resolveHistoryMaster(acct: {
    id: number;
    performanceAccountId: number | null;
    institution: string;
    accountLabel: string;
  }): (typeof perfAccounts)[number] {
    if (acct.performanceAccountId == null) {
      throw new Error(
        `account_performance.id=${acct.id} (${acct.institution}:${acct.accountLabel}) has null performanceAccountId`,
      );
    }
    const master = perfAcctMap.get(acct.performanceAccountId);
    if (!master) {
      throw new Error(
        `account_performance.id=${acct.id} references missing performance_account.id=${acct.performanceAccountId}`,
      );
    }
    return master;
  }

  // Sum employer_contributions per performance category, but only for
  // accounts whose employer money is a purchase-price discount (e.g. ESPP),
  // not a real cash match. Used to backfill CategoryPerformance.employerMatchDiscount
  // without touching the existing employerMatch accumulation logic.
  function sumDiscountEmployerByCategory(
    rows: typeof accountPerfRows,
  ): Map<string, number> {
    const sums = new Map<string, number>();
    for (const acct of rows) {
      const master = resolveHistoryMaster(acct);
      if (!isDiscountBasisEmployerContrib(master.accountType, master.subType))
        continue;
      const category = accountTypeToPerformanceCategory(master.accountType);
      sums.set(
        category,
        (sums.get(category) ?? 0) + toNumber(acct.employerContributions),
      );
    }
    return sums;
  }

  // Build performance portfolio breakdown by year
  // (from account_performance ending balances, grouped by accountType)
  // Includes ALL years with account data, not just finalized — so historical page
  // can show portfolio breakdown even for years without finalized annual rows.
  const {
    perfPortfolioByYear,
    allPerfAccountYears,
    perfByAccountByYear,
    perfByCategoryByYear,
  } = yearEndPerformance(accountPerfRows, annualPerfRows, resolveHistoryMaster);

  // 3. Backfill employerMatchDiscount onto perfByCategoryByYear for every
  // year, whether yearEndPerformance (year-end-rows.ts) filled it from its
  // branch 1 (finalized) or branch 2 (fallback) — a finalized row has no
  // per-account breakdown to derive this from, so it's always recomputed
  // fresh from account_performance rows here instead. Every other field
  // (contributions, employerMatch, gainLoss, endingBalance) keeps reading
  // from its original source untouched.
  //
  // Only merges onto category keys that already exist in a year's map —
  // never creates a new partial CategoryPerformance object (which would be
  // missing gainLoss/endingBalance and produce NaN downstream). Note: a
  // partially-finalized year can already drop an entire non-finalized
  // category from this map (see yearEndPerformance's year-level `.has(year)`
  // check in its branch 2) — this backfill doesn't fix that gap, just avoids
  // making it worse.
  for (const [year, yearMap] of perfByCategoryByYear.entries()) {
    const yearAccounts = accountPerfRows.filter((a) => a.year === year);
    const discountSums = sumDiscountEmployerByCategory(yearAccounts);
    for (const [category, discountAmount] of discountSums.entries()) {
      const existing = yearMap[category];
      if (!existing) continue;
      existing.employerMatchDiscount = discountAmount;
    }
  }

  // Build performance breakdown by parentCategory (Retirement / Portfolio) per year.
  // Uses parentCategory directly from account_performance rows — not derived from config.
  const { perfByParentCategoryByYear, perfSummaryByYear } =
    yearEndPerformanceSummary(
      accountPerfRows,
      annualPerfRows,
      allPerfAccountYears,
      resolveHistoryMaster,
    );

  // Pre-compute mortgage balance by year from loan amortization data.
  // If loan data covers the year, use the computed balance; otherwise fall back to manual netWorthAnnual.mortgageBalance.
  const { mortgageBalanceByYear } = mortgageBalanceByYearFrom(
    mortgageLoans,
    nwRows,
    extraPayments,
    asOfDate,
  );

  // Map net_worth_annual rows to unified YearEndRow
  const { history } = storedYearEndRows(
    nwRows,
    perfPortfolioByYear,
    perfSummaryByYear,
    mortgageBalanceByYear,
    homeImprovementsCumulativeByYear,
    propTaxByYear,
    perfByAccountByYear,
    perfByCategoryByYear,
    perfByParentCategoryByYear,
  );

  // Append current year from live data if not already in history
  const currentYear = asOfDate.getFullYear();
  const hasCurrentYear = history.some((h) => h.year === currentYear);
  if (!hasCurrentYear) {
    const portfolioTotal = snapshotData?.total ?? 0;
    // Group snapshot accounts by accountType for portfolio breakdown
    const portfolioByType: Record<string, number> = {};
    if (snapshotData) {
      for (const a of snapshotData.accounts) {
        portfolioByType[a.accountType] =
          (portfolioByType[a.accountType] ?? 0) + a.amount;
      }
    }

    const setting = parseAppSettings(settings);
    const { cash } = await getEffectiveCash(db, settings);
    const otherAssets = await getEffectiveOtherAssets(db, settings, asOfDate);
    // Typed figure + the debts list + mapped credit cards
    // (server/services/debts/other-liabilities.ts). Only computed for the CURRENT (isCurrent: true) row; a
    // finalized past year always reads otherLiabilities from the stored
    // net_worth_annual row instead (below), which finalizeYear (routers/performance/finalize-year.ts)
    // writes with this same addition baked in at finalize time.
    const otherLiabilities = (
      await getEffectiveOtherLiabilities(db, { asOf: asOfDate })
    ).total;

    const mortgageBalance = computeMortgageBalance(
      mortgageLoans,
      extraPayments,
      asOfDate,
    );

    const activeLoan = getActiveMortgageLoan(mortgageLoans);
    const houseValue = activeLoan
      ? toNumber(
          activeLoan.propertyValueEstimated ?? activeLoan.propertyValuePurchase,
        )
      : 0;

    // Gross income from active jobs (includes bonus — matches finalized year-end data)
    const activeJobs = mergeSalaryProfileJobFields(
      filterActiveJobs(jobs, asOfDate),
      salaryProfileActiveMap,
    );
    const combinedGross = activeJobs.reduce((s, job) => {
      const comp = resolveCompensation(salaryProfileActiveMap, job.id);
      return s + getTotalCompensation(comp.salary, comp.terms);
    }, 0);

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
      (r) => r.year === currentYear && r.category === PERF_CATEGORY_PORTFOLIO,
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
      const sums = sumAccounts(currentYearAcctPerf);
      perfSummary = {
        beginningBalance: sums.beginBal,
        contributions: sums.contribs,
        employerMatch: sums.employer,
        gainLoss: sums.gainLoss,
        // Use snapshot total (most current) instead of stale performance ending balance
        endingBalance: portfolioTotal,
        returnPct: computeReturn(
          sums.beginBal,
          sums.contribs,
          sums.gainLoss,
          sums.distributions,
          sums.fees,
          sums.rollovers,
        ),
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
      // Local calendar day — `.toISOString()` would render this in UTC and
      // store tomorrow's date (and the wrong YEAR at a Dec-31 boundary) for
      // the "current" year-end row any evening in a US timezone.
      yearEndDate: localDateStr(asOfDate),
      isCurrent: true,
      netWorth,
      portfolioTotal,
      portfolioByType,
      cash,
      houseValue,
      otherAssets,
      homeImprovements:
        homeImprovementsCumulativeByYear.get(currentYear) ??
        setting("current_home_improvements", 0),
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
      // Calendar-day difference, not a raw ms/86400000 divide — the old
      // version parsed the date-only snapshotDate as UTC midnight against
      // Date.now() (a real instant), which reads a same-day snapshot as
      // already 1 day old for part of every day. Compare local calendar
      // dates instead.
      snapshotAgeDays: snapshotData
        ? Math.round(
            (localMidnight(new Date()).getTime() -
              parseLocalDateOnly(
                snapshotData.snapshot.snapshotDate,
              ).getTime()) /
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
              employerMatchDiscount: 0,
            };
            existing.endingBalance += toNumber(acct.endingBalance);
            existing.contributions += toNumber(acct.totalContributions);
            existing.employerMatch += toNumber(acct.employerContributions);
            existing.gainLoss += toNumber(acct.yearlyGainLoss);
            existing.distributions += toNumber(acct.distributions);
            // This catMap is a separate, throwaway object that never merges
            // into perfByCategoryByYear — safe to compute inline here too.
            if (
              isDiscountBasisEmployerContrib(master.accountType, master.subType)
            ) {
              existing.employerMatchDiscount += toNumber(
                acct.employerContributions,
              );
            }
            catMap[category] = existing;
          }
          return catMap;
        }
        // Final fallback: derive ending balances from snapshot portfolioByType
        // (no contribution/gain data available — only balances, so no way to
        // compute employerMatchDiscount here)
        const catMap: Record<string, CategoryPerformance> = {};
        for (const [accountType, amount] of Object.entries(portfolioByType)) {
          const category = accountTypeToPerformanceCategory(accountType);
          const existing = catMap[category] ?? {
            endingBalance: 0,
            contributions: 0,
            employerMatch: 0,
            gainLoss: 0,
            distributions: 0,
            employerMatchDiscount: 0,
          };
          existing.endingBalance += amount;
          catMap[category] = existing;
        }
        return catMap;
      })(),
      performanceByParentCategory:
        perfByParentCategoryByYear.get(currentYear) ?? {},
      portfolioByTaxLocation: (() => {
        // For current year, use actual snapshot accounts with real taxType + parentCategory
        if (!snapshotData) return null;
        const breakdown: TaxLocationBreakdown = {
          retirement: {},
          portfolio: {},
        };
        for (const a of snapshotData.accounts) {
          const parentCat = a.parentCategory ?? PERF_CATEGORY_RETIREMENT;
          const taxType = a.taxType ?? "preTax";
          const bucket =
            parentCat === PERF_CATEGORY_PORTFOLIO
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
        const asOf = perfUpdated ? new Date(perfUpdated) : asOfDate;
        let totalSalary = 0;
        let weightedRatio = 0;
        for (const job of activeJobs) {
          // No entry for this job in the active Salary Profile — no
          // schedule to weight this job's contribution to the ratio by;
          // excluded, not defaulted to a guessed period count.
          if (job.payPeriod == null) continue;
          const ppy = payPeriodConfig(job.payPeriod)?.periodsPerYear ?? 12;
          // The checks this job has paid out of the ones it pays THIS year
          // (a job started this year has fewer — none before its start), so
          // YTD ÷ ratio is this year's own total. Contributions' ytdRatio
          // divides by a full year's checks instead (full-year rates).
          const anchor = job.anchorPayDate ?? job.startDate;
          const paid = checksPaidYtd(
            asOf,
            job.payPeriod,
            anchor,
            ppy,
            job.startDate,
          );
          const thisYear =
            ppy -
            periodsBeforeStart(asOf, job.payPeriod, anchor, job.startDate);
          const ratio = safeDivide(paid, thisYear, 0);
          const comp = resolveCompensation(salaryProfileActiveMap, job.id);
          const salary = getTotalCompensation(comp.salary, comp.terms);
          weightedRatio += ratio * salary;
          totalSalary += salary;
        }
        return safeDivide(weightedRatio, totalSalary, 0);
      })(),
      // Placeholders — computed in final pass
      wealthScoreMarket: 0,
      wealthScoreCostBasis: 0,
      aawScoreMarket: 0,
      aawScoreCostBasis: 0,
      fiProgress: 0,
      fiTarget: 0,
      netWorthMarket: netWorth,
      netWorthCostBasis: netWorth, // overwritten in final pass
      houseValueCostBasis: 0, // overwritten in final pass
      averageAge: 0,
      effectiveIncome: 0,
      lifetimeEarnings: 0,
      annualExpenses: 0,
      withdrawalRate: 0,
      withdrawalRateIsDefault: false,
    });
  }

  // =========================================================================
  // Final pass: compute wealth metrics for every row (single computation path)
  // =========================================================================

  yearEndWealthMetrics(
    history,
    settings,
    people,
    retirementSettingsRows,
    retirementProfileRows,
    mortgageLoans,
    annualExpensesBudget,
  );

  if (generation === _yearEndCacheGeneration) {
    const now = Date.now();
    let entries = _yearEndCache.get(db);
    if (!entries) {
      entries = new Map();
      _yearEndCache.set(db, entries);
    }
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= now) entries.delete(key);
    }
    entries.set(cacheKey, {
      data: history,
      expiresAt: now + YEAR_END_CACHE_TTL_MS,
    });
  }
  return history;
}

/** Invalidate the buildYearEndHistory cache (call after mutations that affect its data). */
export function invalidateYearEndCache(): void {
  _yearEndCache = new WeakMap();
  _yearEndCacheGeneration++;
}
// Any successful write may change what the history is built from.
onMutationSucceeded(invalidateYearEndCache);
