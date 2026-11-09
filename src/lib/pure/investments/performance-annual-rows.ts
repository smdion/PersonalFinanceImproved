import { sumBy } from "@/lib/utils/math";
import { toNumber } from "@/lib/utils/numbers";
import {
  sumAccounts,
  sumAnnualRows,
  computeReturn,
  type AccountLike,
} from "./returns";
import { isRetirementParent } from "@/lib/config/account-types";
import {
  accountTypeToPerformanceCategory,
  FULLY_RETIREMENT_PERF_CATEGORIES,
  PARENT_CATEGORY_ROLLUPS,
  PERF_CATEGORY_BROKERAGE,
  PERF_CATEGORY_PORTFOLIO,
  PERF_CATEGORY_RETIREMENT,
} from "@/lib/config/display-labels";
import { getEffectiveCategory, resolveMaster } from "./annual-rollups";

export function performanceAnnualRows(
  annual: {
    id: number;
    year: number;
    category: ReturnType<typeof accountTypeToPerformanceCategory>;
    beginningBalance: string;
    totalContributions: string;
    yearlyGainLoss: string;
    endingBalance: string;
    annualReturnPct: string | null;
    employerContributions: string;
    distributions: string;
    fees: string;
    rollovers: string;
    lifetimeGains: string;
    lifetimeContributions: string;
    lifetimeMatch: string;
    isCurrentYear: boolean;
    isFinalized: boolean;
  }[],
  accounts: (AccountLike & {
    id: number;
    year: number;
    performanceAccountId: number | null;
    institution: string;
    accountLabel: string;
    parentCategory: Parameters<typeof isRetirementParent>[0];
  })[],
  perfLookups: Map<
    number,
    {
      id: number;
      accountType: Parameters<typeof accountTypeToPerformanceCategory>[0];
      parentCategory: Parameters<typeof isRetirementParent>[0];
    }
  >,
) {
  const currentYearRow = annual.find((r) => r.isCurrentYear);
  const currentYear = currentYearRow?.year ?? null;

  // Transform annual rows into mutable objects
  const annualRows = annual.map((r) => ({
    id: r.id,
    year: r.year,
    category: r.category,
    beginningBalance: toNumber(r.beginningBalance),
    totalContributions: toNumber(r.totalContributions),
    yearlyGainLoss: toNumber(r.yearlyGainLoss),
    endingBalance: toNumber(r.endingBalance),
    annualReturnPct: r.annualReturnPct ? toNumber(r.annualReturnPct) : null,
    employerContributions: toNumber(r.employerContributions),
    distributions: toNumber(r.distributions),
    fees: toNumber(r.fees),
    rollovers: toNumber(r.rollovers),
    lifetimeGains: toNumber(r.lifetimeGains),
    lifetimeContributions: toNumber(r.lifetimeContributions),
    lifetimeMatch: toNumber(r.lifetimeMatch),
    isCurrentYear: r.isCurrentYear,
    isFinalized: r.isFinalized,
  }));

  // Build a set of existing annual year+category combos
  const annualKey = (year: number, cat: string) => `${year}:${cat}`;
  const existingAnnual = new Set(
    annualRows.map((r) => annualKey(r.year, r.category)),
  );

  // parentCategory comes from the master performance_accounts row:
  // account_performance.parent_category can disagree with it.
  for (const a of accounts) {
    a.parentCategory = resolveMaster(a, perfLookups).parentCategory;
  }

  // Group account_performance by year → effective category (derived from account type)
  const accountsByYearCat = new Map<string, typeof accounts>();
  const allAccountYears = new Set<number>();
  for (const a of accounts) {
    allAccountYears.add(a.year);
    const effectiveCat = getEffectiveCategory(a, perfLookups);
    const key = annualKey(a.year, effectiveCat);
    const arr = accountsByYearCat.get(key) ?? [];
    arr.push(a);
    accountsByYearCat.set(key, arr);
  }

  // All categories present in account data (derived from account type, not parentCategory)
  const accountCategories = Array.from(
    new Set(accounts.map((a) => getEffectiveCategory(a, perfLookups))),
  );

  // Index existing annual rows by year+category for fast lookup
  const annualByKey = new Map(
    annualRows.map((r) => [annualKey(r.year, r.category), r]),
  );

  // Rows built here from account data have no stored lifetime totals:
  // even in a finalized year they accumulate rather than reset the
  // running total to their placeholder 0.
  const noStoredLifetime = new Set<(typeof annualRows)[number]>();

  // For each year with account data, synthesize missing annual rows and recompute current-year rows
  for (const year of Array.from(allAccountYears)) {
    const yearAccounts = accounts.filter((a) => a.year === year);
    const isCurrentYear = year === currentYear;

    // Check if an annual row for this year exists at all (for isFinalized/isCurrentYear flags)
    const existingRow = annualRows.find((r) => r.year === year);

    // Which categories have existing annual rows for this year?
    // Per-category rollups (grouped by account type, not parentCategory)
    for (const cat of accountCategories) {
      const key = annualKey(year, cat);
      const catAccounts = yearAccounts.filter(
        (a) => getEffectiveCategory(a, perfLookups) === cat,
      );
      if (catAccounts.length === 0) continue;

      const sums = sumAccounts(catAccounts);

      if (!existingAnnual.has(key)) {
        // Synthesize a missing annual row from account data
        annualRows.push({
          id: -1, // synthetic row, not in DB
          year,
          category: cat,
          beginningBalance: sums.beginBal,
          totalContributions: sums.contribs,
          yearlyGainLoss: sums.gainLoss,
          endingBalance: sums.endBal,
          annualReturnPct: computeReturn(
            sums.beginBal,
            sums.contribs,
            sums.gainLoss,
            sums.distributions,
            sums.fees,
            sums.rollovers,
          ),
          employerContributions: sums.employer,
          distributions: sums.distributions,
          fees: sums.fees,
          rollovers: sums.rollovers,
          lifetimeGains: 0,
          lifetimeContributions: 0,
          lifetimeMatch: 0,
          isCurrentYear: isCurrentYear,
          isFinalized: existingRow?.isFinalized ?? false,
        });
        existingAnnual.add(key);
        annualByKey.set(key, annualRows[annualRows.length - 1]!);
        noStoredLifetime.add(annualRows[annualRows.length - 1]!);
      } else {
        // Existing annual row: only recompute non-finalized rows from account data.
        // Finalized rows are authoritative (seeded from spreadsheet or locked by finalizeYear).
        const row = annualByKey.get(key);
        if (row && !row.isFinalized) {
          row.beginningBalance = sums.beginBal;
          row.totalContributions = sums.contribs;
          row.yearlyGainLoss = sums.gainLoss;
          row.endingBalance = sums.endBal;
          row.employerContributions = sums.employer;
          row.distributions = sums.distributions;
          row.fees = sums.fees;
          row.rollovers = sums.rollovers;
          row.annualReturnPct = computeReturn(
            sums.beginBal,
            sums.contribs,
            sums.gainLoss,
            sums.distributions,
            sums.fees,
            sums.rollovers,
          );
        }
      }
    }

    // Portfolio = the account-type categories' rows, never Retirement (a rollup
    // of them; a stray stored Retirement row is excluded explicitly). A year
    // with one such category copies that category's stored row.
    const portfolioKey = annualKey(year, "Portfolio");
    if (!existingAnnual.has(portfolioKey)) {
      // Check: does exactly one non-Portfolio annual row exist for this year?
      // If so, Portfolio = that category (copy stored data, not account sums, for consistency)
      const nonPortfolioCats = annualRows.filter(
        (r) =>
          r.year === year &&
          r.category !== PERF_CATEGORY_PORTFOLIO &&
          r.category !== PERF_CATEGORY_RETIREMENT,
      );
      if (nonPortfolioCats.length === 1 && nonPortfolioCats[0]) {
        const src = nonPortfolioCats[0];
        annualRows.push({
          id: -1,
          year,
          category: "Portfolio",
          beginningBalance: src.beginningBalance,
          totalContributions: src.totalContributions,
          yearlyGainLoss: src.yearlyGainLoss,
          endingBalance: src.endingBalance,
          annualReturnPct: src.annualReturnPct,
          employerContributions: src.employerContributions,
          distributions: src.distributions,
          fees: src.fees,
          rollovers: src.rollovers,
          lifetimeGains: src.lifetimeGains,
          lifetimeContributions: src.lifetimeContributions,
          lifetimeMatch: src.lifetimeMatch,
          isCurrentYear: src.isCurrentYear,
          isFinalized: src.isFinalized,
        });
      } else if (nonPortfolioCats.length > 0) {
        // Multiple categories — sum from per-category annual rows (not account_performance)
        // This correctly includes categories like HSA that may not have account_performance rows
        const ps = sumAnnualRows(nonPortfolioCats);
        annualRows.push({
          id: -1,
          year,
          category: "Portfolio",
          beginningBalance: ps.beginBal,
          totalContributions: ps.contribs,
          yearlyGainLoss: ps.gainLoss,
          endingBalance: ps.endBal,
          annualReturnPct: computeReturn(
            ps.beginBal,
            ps.contribs,
            ps.gainLoss,
            ps.distributions,
            ps.fees,
            ps.rollovers,
          ),
          employerContributions: ps.employer,
          distributions: ps.distributions,
          fees: ps.fees,
          rollovers: ps.rollovers,
          lifetimeGains: ps.lifetimeGains,
          lifetimeContributions: ps.lifetimeContributions,
          lifetimeMatch: ps.lifetimeMatch,
          isCurrentYear: isCurrentYear,
          isFinalized: existingRow?.isFinalized ?? false,
        });
      }
      existingAnnual.add(portfolioKey);
    } else {
      // Existing Portfolio row: only recompute if not finalized
      const row = annualByKey.get(portfolioKey);
      const nonPortfolioForRecompute = annualRows.filter(
        (r) =>
          r.year === year &&
          r.category !== PERF_CATEGORY_PORTFOLIO &&
          r.category !== PERF_CATEGORY_RETIREMENT,
      );
      if (row && !row.isFinalized && nonPortfolioForRecompute.length > 0) {
        const ps = sumAnnualRows(nonPortfolioForRecompute);
        row.beginningBalance = ps.beginBal;
        row.totalContributions = ps.contribs;
        row.yearlyGainLoss = ps.gainLoss;
        row.endingBalance = ps.endBal;
        row.employerContributions = ps.employer;
        row.distributions = ps.distributions;
        row.fees = ps.fees;
        row.rollovers = ps.rollovers;
        row.annualReturnPct = computeReturn(
          ps.beginBal,
          ps.contribs,
          ps.gainLoss,
          ps.distributions,
          ps.fees,
          ps.rollovers,
        );
        row.lifetimeGains = ps.lifetimeGains;
        row.lifetimeContributions = ps.lifetimeContributions;
        row.lifetimeMatch = ps.lifetimeMatch;
      }
    }
  }

  // Fill in missing return % on any row that has stored financials but null return
  for (const row of annualRows) {
    if (row.annualReturnPct === null) {
      row.annualReturnPct = computeReturn(
        row.beginningBalance,
        row.totalContributions,
        row.yearlyGainLoss,
        row.distributions,
        row.fees,
        row.rollovers,
      );
    }
  }

  // Compute lifetime fields for non-finalized rows as cumulative sums.
  // Finalized rows have authoritative lifetime values; non-finalized rows
  // accumulate from the last finalized baseline.
  const lifetimeCategories = Array.from(
    new Set(annualRows.map((r) => r.category)),
  );
  for (const cat of lifetimeCategories) {
    const catRows = annualRows
      .filter((r) => r.category === cat)
      .sort((a, b) => a.year - b.year);

    let runningGains = 0,
      runningContributions = 0,
      runningMatch = 0;

    for (const row of catRows) {
      if (row.isFinalized && !noStoredLifetime.has(row)) {
        // Trust stored lifetime values, use as new running baseline
        runningGains = row.lifetimeGains;
        runningContributions = row.lifetimeContributions;
        runningMatch = row.lifetimeMatch;
      } else {
        // Accumulate from previous baseline
        runningGains += row.yearlyGainLoss;
        runningContributions += row.totalContributions;
        runningMatch += row.employerContributions;
        row.lifetimeGains = runningGains;
        row.lifetimeContributions = runningContributions;
        row.lifetimeMatch = runningMatch;
      }
    }
  }
  return { currentYear, annualRows };
}

export function addRetirementRollup(
  annualRows: ReturnType<typeof performanceAnnualRows>["annualRows"],
  accounts: Parameters<typeof performanceAnnualRows>[1],
  perfLookups: Parameters<typeof performanceAnnualRows>[2],
  currentYear: number | null,
) {
  const fullyRetirementCats: readonly string[] =
    FULLY_RETIREMENT_PERF_CATEGORIES;
  const retBrokerageByYear = new Map<string, typeof accounts>();
  for (const a of accounts) {
    if (
      isRetirementParent(a.parentCategory) &&
      getEffectiveCategory(a, perfLookups) === PERF_CATEGORY_BROKERAGE
    ) {
      const arr = retBrokerageByYear.get(String(a.year)) ?? [];
      arr.push(a);
      retBrokerageByYear.set(String(a.year), arr);
    }
  }

  const retYearsSet = new Set<number>();
  for (const r of annualRows) {
    if (fullyRetirementCats.includes(r.category)) retYearsSet.add(r.year);
  }
  for (const a of accounts) {
    if (isRetirementParent(a.parentCategory)) retYearsSet.add(a.year);
  }
  const retYears = Array.from(retYearsSet).sort((a, b) => a - b);

  // Retirement is always a computed rollup, so drop any stored "Retirement" row:
  // readers take the first match per year, and a stored one would shadow the
  // fresh row pushed below.
  for (let i = annualRows.length - 1; i >= 0; i--) {
    if (annualRows[i]!.category === PERF_CATEGORY_RETIREMENT)
      annualRows.splice(i, 1);
  }

  // Lifetime totals: each fully-Retirement category's own lifetime (its
  // stored history included, carried forward through a year it has no
  // row), plus the Retirement brokerage accounts' running sums.
  const catLifetime = new Map<
    string,
    { gains: number; contribs: number; match: number }
  >();
  let brokLtGains = 0,
    brokLtContributions = 0,
    brokLtMatch = 0;
  for (const year of retYears) {
    const isCurrentYear = year === currentYear;
    const existingRow = annualRows.find((r) => r.year === year);

    // Sum from annual rows for fully-Retirement categories
    const catAnnualRows = annualRows.filter(
      (r) => r.year === year && fullyRetirementCats.includes(r.category),
    );
    const annualSums = sumAnnualRows(catAnnualRows);

    // Add Retirement-parentCategory brokerage accounts
    const retBrokAccounts = retBrokerageByYear.get(String(year)) ?? [];
    const brokSums = sumAccounts(retBrokAccounts);

    const beginBalance = annualSums.beginBal + brokSums.beginBal;
    const contribs = annualSums.contribs + brokSums.contribs;
    const gainLoss = annualSums.gainLoss + brokSums.gainLoss;
    const endBalance = annualSums.endBal + brokSums.endBal;
    const employer = annualSums.employer + brokSums.employer;
    const distributions = annualSums.distributions + brokSums.distributions;
    const fees = annualSums.fees + brokSums.fees;
    const rolloverSum = annualSums.rollovers + brokSums.rollovers;

    for (const r of catAnnualRows)
      catLifetime.set(r.category, {
        gains: r.lifetimeGains,
        contribs: r.lifetimeContributions,
        match: r.lifetimeMatch,
      });
    brokLtGains += brokSums.gainLoss;
    brokLtContributions += brokSums.contribs;
    brokLtMatch += brokSums.employer;
    const carried = [...catLifetime.values()];
    const retLtGains = brokLtGains + sumBy(carried, (c) => c.gains);
    const retLtContributions =
      brokLtContributions + sumBy(carried, (c) => c.contribs);
    const retLtMatch = brokLtMatch + sumBy(carried, (c) => c.match);

    annualRows.push({
      id: -1,
      year,
      category: "Retirement",
      beginningBalance: beginBalance,
      totalContributions: contribs,
      yearlyGainLoss: gainLoss,
      endingBalance: endBalance,
      annualReturnPct: computeReturn(
        beginBalance,
        contribs,
        gainLoss,
        distributions,
        fees,
        rolloverSum,
      ),
      employerContributions: employer,
      distributions,
      fees,
      rollovers: rolloverSum,
      lifetimeGains: retLtGains,
      lifetimeContributions: retLtContributions,
      lifetimeMatch: retLtMatch,
      isCurrentYear: isCurrentYear,
      isFinalized: existingRow?.isFinalized ?? false,
    });
  }

  // Sort annual rows by year after synthesizing
  annualRows.sort((a, b) => a.year - b.year);
}

export function performanceCategories(
  annualRows: ReturnType<typeof performanceAnnualRows>["annualRows"],
) {
  const allCats = Array.from(new Set(annualRows.map((r) => r.category)));
  // Account-type categories: 401k/IRA, HSA, Brokerage (sorted)
  const rollupSet = new Set<string>(PARENT_CATEGORY_ROLLUPS);
  const accountTypeCategories = allCats.filter((c) => !rollupSet.has(c)).sort();
  // Parent-category rollups: Retirement (computed), Portfolio (grand total)
  const parentCategories = PARENT_CATEGORY_ROLLUPS.filter((c) =>
    allCats.includes(c),
  );
  // Combined for backwards compat
  const categories = [...accountTypeCategories, ...parentCategories];
  return { categories, accountTypeCategories, parentCategories };
}

export function performanceLifetimeFlows(
  annualRows: ReturnType<typeof performanceAnnualRows>["annualRows"],
) {
  const portfolioAnnualRows = annualRows.filter(
    (r) => r.category === PERF_CATEGORY_PORTFOLIO,
  );
  const lifetimeFees = portfolioAnnualRows.reduce((sum, r) => sum + r.fees, 0);
  const lifetimeDistributions = portfolioAnnualRows.reduce(
    (sum, r) => sum + r.distributions,
    0,
  );
  return { lifetimeFees, lifetimeDistributions };
}
