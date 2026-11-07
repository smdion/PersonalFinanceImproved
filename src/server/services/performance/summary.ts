import type { Db } from "@/lib/db";
import { asc, eq } from "drizzle-orm";
import { sumBy } from "@/lib/utils/math";
import {
  PERF_BALANCE_MISMATCH_ABS,
  PERF_BALANCE_MISMATCH_PCT,
} from "@/lib/constants";
import * as schema from "@/lib/db/schema";
import { getLatestSnapshot } from "@/server/data/snapshots";
import { toNumber } from "@/lib/utils/numbers";
import { getAllPeople } from "@/server/data/people";
import {
  sumAccounts,
  sumAnnualRows,
  computeReturn,
} from "@/lib/pure/investments/returns";
import { accountDisplayName } from "@/lib/utils/format";
import { isRetirementParent } from "@/lib/config/account-types";
import {
  FULLY_RETIREMENT_PERF_CATEGORIES,
  PARENT_CATEGORY_ROLLUPS,
  PERF_CATEGORY_BROKERAGE,
  PERF_CATEGORY_PORTFOLIO,
  PERF_CATEGORY_RETIREMENT,
} from "@/lib/config/display-labels";
import {
  buildPerfAcctLookups,
  getEffectiveCategory,
  resolveMaster,
} from "@/lib/pure/investments/annual-rollups";
import { loadPerformanceChecks } from "@/server/services/performance/performance-checks";
import {
  parseAcceptedChecks,
  parseEstimatedFields,
} from "@/lib/pure/investments/performance-annotations";
import { localDateStr, parseLocalDateOnly } from "@/lib/utils/date";

function resolveOwnerName(
  ownerPersonId: number | null,
  peopleMap: Map<number, string>,
): string | null {
  if (ownerPersonId == null) return null;
  const name = peopleMap.get(ownerPersonId);
  if (name == null) {
    // Data-integrity invariant, not a user error — left as a plain Error so
    // it lands as INTERNAL_SERVER_ERROR (logged, generic toast). Same for
    // the two resolveMaster() throws below.
    throw new Error(`people.id=${ownerPersonId} not found (orphan FK)`);
  }
  return name;
}

export async function computePerformanceSummary(ctx: { db: Db }) {
  const [annual, accounts, perfAccounts, people, basisRows] = await Promise.all(
    [
      ctx.db
        .select()
        .from(schema.annualPerformance)
        .orderBy(asc(schema.annualPerformance.year)),
      ctx.db
        .select()
        .from(schema.accountPerformance)
        .orderBy(asc(schema.accountPerformance.year)),
      ctx.db
        .select()
        .from(schema.performanceAccounts)
        .orderBy(
          asc(schema.performanceAccounts.displayOrder),
          asc(schema.performanceAccounts.id),
        ),
      getAllPeople(ctx.db),
      ctx.db.select().from(schema.accountBasis),
    ],
  );

  const peopleMap = new Map(people.map((p) => [p.id, p.name]));
  const perfLookups = buildPerfAcctLookups(perfAccounts);
  // Exact (account, owner, year) match — deliberately not the "current
  // row per pair" fallback selectCurrentRothBasisRow()/buildCurrentRothBasisMap()
  // use elsewhere: this table shows one column per historical year, so
  // each year's cell must show that year's own finalized value, not a
  // carried-forward guess. An account/year with no row is simply blank,
  // same as an account with no roth_basis entry at all today.
  const basisByKey = new Map(
    basisRows.map((b) => [
      `${b.performanceAccountId}|${b.ownerPersonId}|${b.year}`,
      b,
    ]),
  );

  // Determine current year
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

  // Resolve parentCategory from master performance_accounts table.
  // account_performance.parent_category is a legacy field that may not match
  // the canonical parentCategory on the master record (e.g. HSA/ESPP accounts
  // store "HSA"/"Brokerage" but master says "Retirement").
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
    const isCurrentYr = year === currentYear;

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
          isCurrentYear: isCurrentYr,
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

    // Portfolio row = sum of all ACCOUNT-TYPE categories for this year
    // (401k/IRA, Brokerage, HSA) — never Retirement, which is itself a
    // rollup of a subset of those same categories (see the synthesis
    // below) and would double-count if summed in here too. This bit
    // 'annualRows' can still contain a raw historical "Retirement" row
    // at this point if one was ever mistakenly written directly to
    // annual_performance (that's a real incident this guarded against —
    // see the Retirement de-dup a few hundred lines down), so the filter
    // must exclude it explicitly rather than assuming it's absent.
    // For years where only one non-rollup category existed (e.g.
    // pre-2023 = 401k/IRA only), copy from that category's annual row to
    // keep numbers consistent with stored data.
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
          lifetimeContributions: ps.lifetimeContribs,
          lifetimeMatch: ps.lifetimeMatch,
          isCurrentYear: isCurrentYr,
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
        row.lifetimeContributions = ps.lifetimeContribs;
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
      runningContribs = 0,
      runningMatch = 0;

    for (const row of catRows) {
      if (row.isFinalized && !noStoredLifetime.has(row)) {
        // Trust stored lifetime values, use as new running baseline
        runningGains = row.lifetimeGains;
        runningContribs = row.lifetimeContributions;
        runningMatch = row.lifetimeMatch;
      } else {
        // Accumulate from previous baseline
        runningGains += row.yearlyGainLoss;
        runningContribs += row.totalContributions;
        runningMatch += row.employerContributions;
        row.lifetimeGains = runningGains;
        row.lifetimeContributions = runningContribs;
        row.lifetimeMatch = runningMatch;
      }
    }
  }

  // Synthesize "Retirement" parent-category rollup rows.
  // Retirement = all accounts where parentCategory === "Retirement".
  // 401k/IRA and HSA are fully Retirement — use their annual rows (which have correct
  // employer contributions from the spreadsheet even for older years where account rows don't).
  // Brokerage is mixed — only some accounts are Retirement (e.g. Retirement Brokerage, ESPP).
  // For the Brokerage portion, sum from account_performance rows filtered by parentCategory.
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

  // Retirement is always a computed rollup, never a stored per-category
  // row a user finalizes directly (unlike Portfolio, which legitimately
  // copies stored data when exactly one category exists for a year) — so
  // any pre-existing "Retirement" row here (e.g. a stray historical
  // import) must not be allowed to silently shadow the fresh one pushed
  // below. Array.find() elsewhere always returns the FIRST match for a
  // given year, so leaving a stale row in place — even with a correct
  // endingBalance — would keep serving its stale isCurrentYear/isFinalized
  // flags forever, invisibly, since nothing else here ever inspects it.
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
    brokLtContribs = 0,
    brokLtMatch = 0;
  for (const year of retYears) {
    const isCurrentYr = year === currentYear;
    const existingRow = annualRows.find((r) => r.year === year);

    // Sum from annual rows for fully-Retirement categories
    const catAnnualRows = annualRows.filter(
      (r) => r.year === year && fullyRetirementCats.includes(r.category),
    );
    const annualSums = sumAnnualRows(catAnnualRows);

    // Add Retirement-parentCategory brokerage accounts
    const retBrokAccts = retBrokerageByYear.get(String(year)) ?? [];
    const brokSums = sumAccounts(retBrokAccts);

    const beginBal = annualSums.beginBal + brokSums.beginBal;
    const contribs = annualSums.contribs + brokSums.contribs;
    const gainLoss = annualSums.gainLoss + brokSums.gainLoss;
    const endBal = annualSums.endBal + brokSums.endBal;
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
    brokLtContribs += brokSums.contribs;
    brokLtMatch += brokSums.employer;
    const carried = [...catLifetime.values()];
    const retLtGains = brokLtGains + sumBy(carried, (c) => c.gains);
    const retLtContribs = brokLtContribs + sumBy(carried, (c) => c.contribs);
    const retLtMatch = brokLtMatch + sumBy(carried, (c) => c.match);

    annualRows.push({
      id: -1,
      year,
      category: "Retirement",
      beginningBalance: beginBal,
      totalContributions: contribs,
      yearlyGainLoss: gainLoss,
      endingBalance: endBal,
      annualReturnPct: computeReturn(
        beginBal,
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
      lifetimeContributions: retLtContribs,
      lifetimeMatch: retLtMatch,
      isCurrentYear: isCurrentYr,
      isFinalized: existingRow?.isFinalized ?? false,
    });
  }

  // Sort annual rows by year after synthesizing
  annualRows.sort((a, b) => a.year - b.year);

  // Categories available in the data (rebuild after synthesis)
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

  const rowsPerAccountYear = new Map<string, number>();
  for (const r of accounts) {
    const k = `${r.performanceAccountId}|${r.year}`;
    rowsPerAccountYear.set(k, (rowsPerAccountYear.get(k) ?? 0) + 1);
  }

  // Reconciliation checks (one path: also what "accept this gap" reads).
  const checksByRow = await loadPerformanceChecks(ctx.db, accounts);

  // Transform account rows — enrich with master account data + compute missing return %
  const accountRows = accounts.map((r) => {
    const master = resolveMaster(r, perfLookups);
    const beginBal = toNumber(r.beginningBalance);
    const contribs = toNumber(r.totalContributions);
    const gainLoss = toNumber(r.yearlyGainLoss);
    const employer = toNumber(r.employerContributions);
    const distributions = toNumber(r.distributions);
    const fees = toNumber(r.fees);
    const rollovers = toNumber(r.rollovers);
    // Roth basis is per person, but one Performance row can cover an
    // account two people hold (a joint-labeled IRA with each spouse's
    // Roth). Every person's basis for this account and year rides along;
    // the row's own figures are their total.
    // (An account tracked with a row per person keeps each row to its
    // own person, so nothing is counted twice.)
    const perPerson =
      (rowsPerAccountYear.get(`${r.performanceAccountId}|${r.year}`) ?? 0) > 1;
    const owners = basisRows.filter(
      (b) =>
        b.performanceAccountId === r.performanceAccountId &&
        b.year === r.year &&
        (!perPerson || b.ownerPersonId === r.ownerPersonId),
    );
    const own =
      r.ownerPersonId != null
        ? basisByKey.get(
            `${r.performanceAccountId}|${r.ownerPersonId}|${r.year}`,
          )
        : undefined;
    const basisByOwner = (
      owners.length > 0
        ? owners
        : r.ownerPersonId != null
          ? [
              {
                ownerPersonId: r.ownerPersonId,
                contributionBasis: "0",
                conversionBasis: "0",
                latestConversionYear: null,
                recorded: false,
              },
            ]
          : []
    )
      .map((b) => ({
        ownerPersonId: b.ownerPersonId,
        ownerName: resolveOwnerName(b.ownerPersonId, peopleMap),
        contributionBasis: toNumber(b.contributionBasis),
        conversionBasis: toNumber(b.conversionBasis),
        latestConversionYear: b.latestConversionYear,
        /** False when there's no basis row for this person and year yet. */
        recorded: !("recorded" in b),
      }))
      .sort((a, b) => a.ownerPersonId - b.ownerPersonId);
    const sumBasis = (f: "contributionBasis" | "conversionBasis") =>
      basisByOwner.reduce((t, b) => t + b[f], 0);
    return {
      id: r.id,
      year: r.year,
      institution: r.institution,
      accountLabel: accountDisplayName(master),
      ownerName: resolveOwnerName(r.ownerPersonId, peopleMap),
      ownerPersonId: r.ownerPersonId,
      ownershipType: master.ownershipType,
      beginningBalance: beginBal,
      totalContributions: contribs,
      yearlyGainLoss: gainLoss,
      endingBalance: toNumber(r.endingBalance),
      annualReturnPct: computeReturn(
        beginBal,
        contribs,
        gainLoss,
        distributions,
        fees,
        rollovers,
      ),
      employerContributions: employer,
      fees,
      distributions,
      rollovers,
      parentCategory: master.parentCategory,
      accountType: master.accountType,
      subType: master.subType ?? null,
      isActive: r.isActive,
      performanceAccountId: r.performanceAccountId,
      displayOrder: master.displayOrder,
      contributionBasis:
        owners.length > 0 || own ? sumBasis("contributionBasis") : null,
      conversionBasis:
        owners.length > 0 || own ? sumBasis("conversionBasis") : null,
      latestConversionYear:
        basisByOwner.reduce<number | null>(
          (y, b) =>
            b.latestConversionYear !== null &&
            (y === null || b.latestConversionYear > y)
              ? b.latestConversionYear
              : y,
          null,
        ) ?? null,
      basisByOwner,
      checks: checksByRow.get(r.id) ?? [],
      note: r.note,
      estimatedFields: parseEstimatedFields(r.estimatedFields),
      acceptedChecks: parseAcceptedChecks(r.acceptedChecks),
    };
  });

  // Lifetime totals: use most recent Portfolio row (lifetime fields are now always computed)
  const portfolioRows = annualRows
    .filter((r) => r.category === PERF_CATEGORY_PORTFOLIO)
    .sort((a, b) => b.year - a.year);
  const latestPortfolio = portfolioRows[0] ?? null;

  // Latest portfolio snapshot total (most accurate current value)
  const snapshotData = await getLatestSnapshot(ctx.db);
  const currentPortfolioValue = snapshotData?.total ?? null;
  const lastSnapshotDate = snapshotData?.snapshot.snapshotDate ?? null;

  // Last-updated timestamp
  const perfUpdatedSetting = await ctx.db
    .select()
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, "performance_last_updated"));
  const performanceLastUpdated = perfUpdatedSetting[0]?.value as string | null;

  // Master account list for reference
  const masterAccounts = perfAccounts.map((pa) => ({
    id: pa.id,
    institution: pa.institution,
    accountLabel: accountDisplayName(pa),
    ownerName: resolveOwnerName(pa.ownerPersonId, peopleMap),
    ownerPersonId: pa.ownerPersonId,
    ownershipType: pa.ownershipType,
    parentCategory: pa.parentCategory,
    accountType: pa.accountType,
    isActive: pa.isActive,
    displayOrder: pa.displayOrder,
    costBasis: String(pa.costBasis ?? "0"),
  }));

  // Compute lifetime fees and distributions from all Portfolio annual rows
  const portfolioAnnualRows = annualRows.filter(
    (r) => r.category === PERF_CATEGORY_PORTFOLIO,
  );
  const lifetimeFees = portfolioAnnualRows.reduce((sum, r) => sum + r.fees, 0);
  const lifetimeDistributions = portfolioAnnualRows.reduce(
    (sum, r) => sum + r.distributions,
    0,
  );

  // Ending balance consistency check: compare sum of account ending balances
  // (current year) against the latest portfolio snapshot total.
  // Only fires when both share the same date — a different date means expected staleness.
  const balanceMismatch = (() => {
    if (!snapshotData) return null;
    const snapDate = snapshotData.snapshot.snapshotDate;
    // The stamp is a UTC instant; the snapshot date is the household's
    // calendar day — compare on the household's day (an evening edit is
    // already tomorrow in UTC).
    const perfDate =
      typeof performanceLastUpdated === "string"
        ? localDateStr(parseLocalDateOnly(performanceLastUpdated))
        : null;
    if (!perfDate || snapDate !== perfDate) return null;

    const perfTotal = accountRows
      .filter((r) => r.year === currentYear && r.isActive)
      .reduce((sum, r) => sum + r.endingBalance, 0);
    const snapTotal = snapshotData.total;
    const delta = perfTotal - snapTotal;
    const threshold = Math.max(
      PERF_BALANCE_MISMATCH_ABS,
      snapTotal * PERF_BALANCE_MISMATCH_PCT,
    );
    if (Math.abs(delta) <= threshold) return null;
    return { perfTotal, snapTotal, delta };
  })();

  return {
    categories,
    accountTypeCategories,
    parentCategories,
    currentYear,
    annualRows,
    accountRows,
    masterAccounts,
    lastSnapshotDate,
    performanceLastUpdated,
    balanceMismatch,
    lifetimeTotals: latestPortfolio
      ? {
          gains: latestPortfolio.lifetimeGains,
          contributions: latestPortfolio.lifetimeContributions,
          match: latestPortfolio.lifetimeMatch,
          fees: lifetimeFees,
          distributions: lifetimeDistributions,
          endingBalance: currentPortfolioValue ?? latestPortfolio.endingBalance,
        }
      : null,
  };
}
