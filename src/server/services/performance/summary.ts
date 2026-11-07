import type { Db } from "@/lib/db";
import { asc, eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { getLatestSnapshot } from "@/server/data/snapshots";
import { getAllPeople } from "@/server/data/people";
import { accountDisplayName } from "@/lib/utils/format";
import { PERF_CATEGORY_PORTFOLIO } from "@/lib/config/display-labels";
import { buildPerfAcctLookups } from "@/lib/pure/investments/annual-rollups";
import { loadPerformanceChecks } from "@/server/services/performance/performance-checks";
import {
  addRetirementRollup,
  performanceAnnualRows,
  performanceCategories,
  performanceLifetimeFlows,
} from "@/lib/pure/investments/performance-annual-rows";
import {
  performanceAccountRows,
  performanceBalanceMismatch,
  resolveOwnerName,
} from "@/lib/pure/investments/performance-account-rows";

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

  const { currentYear, annualRows } = performanceAnnualRows(
    annual,
    accounts,
    perfLookups,
  );

  // Synthesize "Retirement" parent-category rollup rows.
  // Retirement = all accounts where parentCategory === "Retirement".
  // 401k/IRA and HSA are fully Retirement — use their annual rows (which have correct
  // employer contributions from the spreadsheet even for older years where account rows don't).
  // Brokerage is mixed — only some accounts are Retirement (e.g. Retirement Brokerage, ESPP).
  // For the Brokerage portion, sum from account_performance rows filtered by parentCategory.
  addRetirementRollup(annualRows, accounts, perfLookups, currentYear);

  // Categories available in the data (rebuild after synthesis)
  const { categories, accountTypeCategories, parentCategories } =
    performanceCategories(annualRows);

  const rowsPerAccountYear = new Map<string, number>();
  for (const r of accounts) {
    const k = `${r.performanceAccountId}|${r.year}`;
    rowsPerAccountYear.set(k, (rowsPerAccountYear.get(k) ?? 0) + 1);
  }

  // Reconciliation checks (one path: also what "accept this gap" reads).
  const checksByRow = await loadPerformanceChecks(ctx.db, accounts);

  // Transform account rows — enrich with master account data + compute missing return %
  const { accountRows } = performanceAccountRows(
    accounts,
    perfLookups,
    basisRows,
    basisByKey,
    peopleMap,
    checksByRow,
    rowsPerAccountYear,
  );

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
  const { lifetimeFees, lifetimeDistributions } =
    performanceLifetimeFlows(annualRows);

  // Ending balance consistency check: compare sum of account ending balances
  // (current year) against the latest portfolio snapshot total.
  // Only fires when both share the same date — a different date means expected staleness.
  const { balanceMismatch } = performanceBalanceMismatch(
    snapshotData,
    performanceLastUpdated,
    accountRows,
    currentYear,
  );

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
