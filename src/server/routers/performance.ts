/** Performance router for portfolio time-weighted return tracking, snapshot ingestion, account-level performance history, and category rollup calculations. */
import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { asc, eq, and, sql } from "drizzle-orm";
import { log } from "@/lib/logger";
import { isPostgres } from "@/lib/db/dialect";
import {
  createTRPCRouter,
  protectedProcedure,
  performanceProcedure,
} from "../trpc";
import * as schema from "@/lib/db/schema";
import type { db as appDb } from "@/lib/db";
import {
  toNumber,
  getLatestSnapshot,
  computeMortgageBalance,
  parseAppSettings,
  getEffectiveCash,
  getEffectiveOtherAssets,
  getSalariesForJobs,
  invalidateYearEndCache,
} from "@/server/helpers";
import { accountDisplayName, stripInstitutionSuffix } from "@/lib/utils/format";
import {
  accountTypeToPerformanceCategory,
  FULLY_RETIREMENT_PERF_CATEGORIES,
  PARENT_CATEGORY_ROLLUPS,
} from "@/lib/config/display-labels";

/** Accepts both the main db instance and transaction handles. */
type DbType =
  | typeof appDb
  | Parameters<Parameters<typeof appDb.transaction>[0]>[0];
type PerfAccount = typeof schema.performanceAccounts.$inferSelect;

/** Build lookup maps for resolving account_performance → performance_accounts master.
 *  Returns { byId, byInstLabel } for direct ID lookup and fallback institution+label matching. */
function buildPerfAcctLookups(perfAccounts: PerfAccount[]) {
  const byId = new Map(perfAccounts.map((pa) => [pa.id, pa]));
  // DEPRECATED: Fallback match by institution + stripped label (for rows without performanceAccountId).
  // Will be removed once all rows are backfilled with performanceAccountId via backfillPerformanceAccountIds.
  const byInstLabel = new Map<string, PerfAccount>();
  for (const pa of perfAccounts) {
    const labelBase = stripInstitutionSuffix(pa.accountLabel);
    byInstLabel.set(`${pa.institution}:${labelBase}`, pa);
  }
  return { byId, byInstLabel };
}

/** Resolve master performance_account for an account_performance row. */
function resolveMaster(
  a: {
    performanceAccountId: number | null;
    institution: string;
    accountLabel: string;
  },
  lookups: ReturnType<typeof buildPerfAcctLookups>,
): PerfAccount | null {
  if (a.performanceAccountId)
    return lookups.byId.get(a.performanceAccountId) ?? null;
  // DEPRECATED: institution+label fallback — will be removed once all rows have performanceAccountId
  const fallback =
    lookups.byInstLabel.get(`${a.institution}:${a.accountLabel}`) ?? null;
  if (fallback) {
    log("warn", "perf_acct_fallback_match", {
      institution: a.institution,
      label: a.accountLabel,
    });
  }
  return fallback;
}

/** Get the effective display category for an account_performance row.
 *  Uses accountType from master performance_account, falls back to parentCategory. */
function getEffectiveCategory(
  a: {
    performanceAccountId: number | null;
    institution: string;
    accountLabel: string;
    parentCategory: string;
  },
  lookups: ReturnType<typeof buildPerfAcctLookups>,
): string {
  const master = resolveMaster(a, lookups);
  return master
    ? accountTypeToPerformanceCategory(master.accountType)
    : a.parentCategory;
}

/** Stamp performance_last_updated in app_settings */
async function stampPerformanceUpdated(db: DbType) {
  const now = new Date().toISOString();
  await db
    .insert(schema.appSettings)
    .values({ key: "performance_last_updated", value: now })
    .onConflictDoUpdate({
      target: schema.appSettings.key,
      set: { value: now },
    });
}

// --- Zod schemas for input validation ---

const annualUpdateInput = z.object({
  id: z.number().int(),
  beginningBalance: z.string().optional(),
  totalContributions: z.string().optional(),
  yearlyGainLoss: z.string().optional(),
  endingBalance: z.string().optional(),
  annualReturnPct: z.string().nullable().optional(),
  employerContributions: z.string().optional(),
  fees: z.string().optional(),
  distributions: z.string().optional(),
  rollovers: z.string().optional(),
});

const accountUpdateInput = z.object({
  id: z.number().int(),
  beginningBalance: z.string().optional(),
  totalContributions: z.string().optional(),
  yearlyGainLoss: z.string().optional(),
  endingBalance: z.string().optional(),
  annualReturnPct: z.string().nullable().optional(),
  employerContributions: z.string().optional(),
  fees: z.string().optional(),
  distributions: z.string().optional(),
  rollovers: z.string().optional(),
});

const accountCreateInput = z.object({
  year: z.number().int(),
  performanceAccountId: z.number().int(),
  beginningBalance: z.string(),
  totalContributions: z.string(),
  yearlyGainLoss: z.string(),
  endingBalance: z.string(),
  annualReturnPct: z.string().nullable().optional(),
  employerContributions: z.string().default("0"),
  fees: z.string().default("0"),
  distributions: z.string().default("0"),
  rollovers: z.string().default("0"),
  isActive: z.boolean().default(true),
});

// --- Shared helpers (used by getSummary and finalizeYear) ---

/** Modified Dietz return: gainLoss / (beginBal + (contribs + rollovers + employer - distributions - fees) / 2) */
function computeReturn(
  beginBal: number,
  contribs: number,
  gainLoss: number,
  employer: number,
  distributions: number,
  fees: number = 0,
  rollovers: number = 0,
): number | null {
  const denominator =
    beginBal + (contribs + rollovers + employer - distributions - fees) / 2;
  if (denominator === 0) return null;
  return gainLoss / denominator;
}

type AccountLike = {
  beginningBalance: string | null;
  totalContributions: string | null;
  yearlyGainLoss: string | null;
  endingBalance: string | null;
  employerContributions: string | null;
  distributions: string | null;
  fees: string | null;
  rollovers: string | null;
};

/** Sum a set of account rows into a rollup */
function sumAccounts(accts: AccountLike[]) {
  let beginBal = 0,
    contribs = 0,
    gainLoss = 0,
    endBal = 0,
    employer = 0,
    distributions = 0,
    fees = 0,
    rollovers = 0;
  for (const a of accts) {
    beginBal += toNumber(a.beginningBalance);
    contribs += toNumber(a.totalContributions);
    gainLoss += toNumber(a.yearlyGainLoss);
    endBal += toNumber(a.endingBalance);
    employer += toNumber(a.employerContributions);
    distributions += toNumber(a.distributions);
    fees += toNumber(a.fees);
    rollovers += toNumber(a.rollovers);
  }
  return {
    beginBal,
    contribs,
    gainLoss,
    endBal,
    employer,
    distributions,
    fees,
    rollovers,
  };
}

type AnnualRowLike = {
  beginningBalance: number;
  totalContributions: number;
  yearlyGainLoss: number;
  endingBalance: number;
  employerContributions: number;
  distributions: number;
  fees: number;
  rollovers: number;
  lifetimeGains: number;
  lifetimeContributions: number;
  lifetimeMatch: number;
};

/** Sum a set of annual rows (numeric) into a Portfolio rollup */
function sumAnnualRows(rows: AnnualRowLike[]) {
  let beginBal = 0,
    contribs = 0,
    gainLoss = 0,
    endBal = 0,
    employer = 0,
    distributions = 0,
    fees = 0,
    rollovers = 0,
    lifetimeGains = 0,
    lifetimeContribs = 0,
    lifetimeMatch = 0;
  for (const r of rows) {
    beginBal += r.beginningBalance;
    contribs += r.totalContributions;
    gainLoss += r.yearlyGainLoss;
    endBal += r.endingBalance;
    employer += r.employerContributions;
    distributions += r.distributions;
    fees += r.fees;
    rollovers += r.rollovers;
    lifetimeGains += r.lifetimeGains;
    lifetimeContribs += r.lifetimeContributions;
    lifetimeMatch += r.lifetimeMatch;
  }
  return {
    beginBal,
    contribs,
    gainLoss,
    endBal,
    employer,
    distributions,
    fees,
    rollovers,
    lifetimeGains,
    lifetimeContribs,
    lifetimeMatch,
  };
}

export const performanceRouter = createTRPCRouter({
  /**
   * computeSummary — returns all performance data joined through the master performance_accounts table.
   * Includes: annual rollups, account-level detail, master account list, and current-year status.
   */
  computeSummary: protectedProcedure.query(async ({ ctx }) => {
    const [annual, accounts, perfAccounts, people] = await Promise.all([
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
      ctx.db.select().from(schema.people).orderBy(asc(schema.people.id)),
    ]);

    const peopleMap = new Map(people.map((p) => [p.id, p.name]));
    const perfLookups = buildPerfAcctLookups(perfAccounts);

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
      const master = resolveMaster(a, perfLookups);
      if (master) a.parentCategory = master.parentCategory;
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
              sums.employer,
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
              sums.employer,
              sums.distributions,
              sums.fees,
              sums.rollovers,
            );
          }
        }
      }

      // Portfolio row = sum of all categories for this year
      // For years where only one category existed (e.g., pre-2023 = 401k/IRA only),
      // copy from that category's annual row to keep numbers consistent with stored data
      const portfolioKey = annualKey(year, "Portfolio");
      if (!existingAnnual.has(portfolioKey)) {
        // Check: does exactly one non-Portfolio annual row exist for this year?
        // If so, Portfolio = that category (copy stored data, not account sums, for consistency)
        const nonPortfolioCats = annualRows.filter(
          (r) => r.year === year && r.category !== "Portfolio",
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
              ps.employer,
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
          (r) => r.year === year && r.category !== "Portfolio",
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
            ps.employer,
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
          row.employerContributions,
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
        if (row.isFinalized) {
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
        a.parentCategory === "Retirement" &&
        getEffectiveCategory(a, perfLookups) === "Brokerage"
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
      if (a.parentCategory === "Retirement") retYearsSet.add(a.year);
    }
    const retYears = Array.from(retYearsSet).sort((a, b) => a - b);

    let retLtGains = 0,
      retLtContribs = 0,
      retLtMatch = 0;
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

      retLtGains += gainLoss;
      retLtContribs += contribs;
      retLtMatch += employer;

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
          employer,
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
    const accountTypeCategories = allCats
      .filter((c) => !rollupSet.has(c))
      .sort();
    // Parent-category rollups: Retirement (computed), Portfolio (grand total)
    const parentCategories = PARENT_CATEGORY_ROLLUPS.filter((c) =>
      allCats.includes(c),
    );
    // Combined for backwards compat
    const categories = [...accountTypeCategories, ...parentCategories];

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
      const storedReturn = r.annualReturnPct
        ? toNumber(r.annualReturnPct)
        : null;
      return {
        id: r.id,
        year: r.year,
        institution: r.institution,
        accountLabel: accountDisplayName(master ?? r),
        ownerName: r.ownerPersonId
          ? (peopleMap.get(r.ownerPersonId) ?? "Unknown")
          : null,
        ownerPersonId: r.ownerPersonId,
        ownershipType: master?.ownershipType ?? "individual",
        beginningBalance: beginBal,
        totalContributions: contribs,
        yearlyGainLoss: gainLoss,
        endingBalance: toNumber(r.endingBalance),
        annualReturnPct:
          storedReturn ??
          computeReturn(
            beginBal,
            contribs,
            gainLoss,
            employer,
            distributions,
            fees,
            rollovers,
          ),
        employerContributions: employer,
        fees,
        distributions,
        rollovers,
        parentCategory: master?.parentCategory ?? r.parentCategory,
        accountType: master?.accountType ?? null,
        isActive: r.isActive,
        performanceAccountId: r.performanceAccountId,
        displayOrder: master?.displayOrder ?? 999,
      };
    });

    // Lifetime totals: use most recent Portfolio row (lifetime fields are now always computed)
    const portfolioRows = annualRows
      .filter((r) => r.category === "Portfolio")
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
    const performanceLastUpdated = perfUpdatedSetting[0]?.value as
      | string
      | null;

    // Master account list for reference
    const masterAccounts = perfAccounts.map((pa) => ({
      id: pa.id,
      institution: pa.institution,
      accountLabel: accountDisplayName(pa),
      ownerName: pa.ownerPersonId
        ? (peopleMap.get(pa.ownerPersonId) ?? "Unknown")
        : null,
      ownerPersonId: pa.ownerPersonId,
      ownershipType: pa.ownershipType,
      parentCategory: pa.parentCategory,
      accountType: pa.accountType,
      isActive: pa.isActive,
      displayOrder: pa.displayOrder,
    }));

    // Compute lifetime fees and distributions from all Portfolio annual rows
    const portfolioAnnualRows = annualRows.filter(
      (r) => r.category === "Portfolio",
    );
    const lifetimeFees = portfolioAnnualRows.reduce(
      (sum, r) => sum + r.fees,
      0,
    );
    const lifetimeDistributions = portfolioAnnualRows.reduce(
      (sum, r) => sum + r.distributions,
      0,
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
      lifetimeTotals: latestPortfolio
        ? {
            gains: latestPortfolio.lifetimeGains,
            contributions: latestPortfolio.lifetimeContributions,
            match: latestPortfolio.lifetimeMatch,
            fees: lifetimeFees,
            distributions: lifetimeDistributions,
            endingBalance:
              currentPortfolioValue ?? latestPortfolio.endingBalance,
          }
        : null,
    };
  }),

  updateAnnual: performanceProcedure
    .input(annualUpdateInput)
    .mutation(async ({ ctx, input }) => {
      const { id, ...fields } = input;
      const updates: Record<string, string | null> = {};
      for (const [key, value] of Object.entries(fields)) {
        if (value !== undefined) {
          updates[key] = value;
        }
      }
      if (Object.keys(updates).length === 0) return { success: true };
      await ctx.db
        .update(schema.annualPerformance)
        .set(updates)
        .where(eq(schema.annualPerformance.id, id));
      await stampPerformanceUpdated(ctx.db);
      return { success: true };
    }),

  updateAccount: performanceProcedure
    .input(accountUpdateInput)
    .mutation(async ({ ctx, input }) => {
      const { id, ...fields } = input;
      const updates: Record<string, string | null> = {};
      for (const [key, value] of Object.entries(fields)) {
        if (value !== undefined) {
          updates[key] = value;
        }
      }
      if (Object.keys(updates).length === 0) return { success: true };
      await ctx.db
        .update(schema.accountPerformance)
        .set(updates)
        .where(eq(schema.accountPerformance.id, id));
      await stampPerformanceUpdated(ctx.db);
      return { success: true };
    }),

  createAccount: performanceProcedure
    .input(accountCreateInput)
    .mutation(async ({ ctx, input }) => {
      // Look up master account to get denormalized fields
      const [master] = await ctx.db
        .select()
        .from(schema.performanceAccounts)
        .where(eq(schema.performanceAccounts.id, input.performanceAccountId));
      if (!master)
        throw new Error(
          `Performance account ${input.performanceAccountId} not found`,
        );

      const [row] = await ctx.db
        .insert(schema.accountPerformance)
        .values({
          year: input.year,
          institution: master.institution,
          accountLabel: master.accountLabel,
          ownerPersonId: master.ownerPersonId,
          parentCategory: master.parentCategory,
          isActive: input.isActive,
          performanceAccountId: input.performanceAccountId,
          beginningBalance: input.beginningBalance,
          totalContributions: input.totalContributions,
          yearlyGainLoss: input.yearlyGainLoss,
          endingBalance: input.endingBalance,
          annualReturnPct: input.annualReturnPct ?? null,
          employerContributions: input.employerContributions,
          fees: input.fees,
          distributions: input.distributions,
          rollovers: input.rollovers,
        })
        .returning();
      await stampPerformanceUpdated(ctx.db);
      return row;
    }),

  deleteAccount: performanceProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(schema.accountPerformance)
        .where(eq(schema.accountPerformance.id, input.id));
      await stampPerformanceUpdated(ctx.db);
      return { success: true };
    }),

  /**
   * Finalize a year: marks all account_performance and annual_performance rows
   * for that year as finalized, then auto-creates next year's rows for active accounts.
   */
  finalizeYear: performanceProcedure
    .input(
      z.object({
        year: z.number().int(),
        overrides: z
          .array(
            z.object({
              category: z.string(),
              beginningBalance: z.string(),
              totalContributions: z.string(),
              yearlyGainLoss: z.string(),
              endingBalance: z.string(),
              employerContributions: z.string(),
              distributions: z.string(),
              fees: z.string(),
              rollovers: z.string().default("0"),
              lifetimeGains: z.string(),
              lifetimeContributions: z.string(),
              lifetimeMatch: z.string(),
            }),
          )
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { year, overrides } = input;
      const nextYear = year + 1;

      return await ctx.db.transaction(async (tx) => {
        // Guard: reject if year is already finalized — PG uses FOR UPDATE row lock,
        // SQLite relies on its single-writer transaction model for serialization.
        const existingAnnualRows: (typeof schema.annualPerformance.$inferSelect)[] =
          await tx
            .execute(
              isPostgres()
                ? sql`SELECT * FROM annual_performance WHERE year = ${year} FOR UPDATE`
                : sql`SELECT * FROM annual_performance WHERE year = ${year}`,
            )
            .then(
              (r) => r.rows as (typeof schema.annualPerformance.$inferSelect)[],
            );

        if (existingAnnualRows.some((r) => r.isFinalized)) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `Year ${year} is already finalized. Un-finalize it first or use the performance editor to adjust values.`,
          });
        }

        // 1. Get all account_performance rows for this year
        const finalizedAccts = await tx
          .select()
          .from(schema.accountPerformance)
          .where(eq(schema.accountPerformance.year, year));

        // Guard: reject if no account data exists for this year
        if (finalizedAccts.length === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `No account performance data exists for year ${year}. Add account data before finalizing.`,
          });
        }

        // 2. Get previous year's annual rows for lifetime baseline
        const prevAnnualRows = await tx
          .select()
          .from(schema.annualPerformance)
          .where(eq(schema.annualPerformance.year, year - 1));

        // Build override lookup by category
        const overrideMap = new Map(overrides?.map((o) => [o.category, o]));

        // Load performance_accounts for accountType-based grouping
        const allPerfAccounts = await tx
          .select()
          .from(schema.performanceAccounts);
        const finalizeLookups = buildPerfAcctLookups(allPerfAccounts);

        // 3. Compute rollups and persist finalized values for each category, then Portfolio
        // Categories derived from accountType (Brokerage, HSA, 401k/IRA), not parentCategory
        const accountCategories = Array.from(
          new Set(
            finalizedAccts.map((a) => getEffectiveCategory(a, finalizeLookups)),
          ),
        );

        // Track per-category finalized values so Portfolio can sum from them
        const finalizedCatValues: AnnualRowLike[] = [];

        // First pass: finalize per-category rows
        for (const category of accountCategories) {
          const catAccounts = finalizedAccts.filter(
            (a) => getEffectiveCategory(a, finalizeLookups) === category,
          );
          if (catAccounts.length === 0) continue;

          const override = overrideMap.get(category);

          if (override) {
            const vals: AnnualRowLike = {
              beginningBalance: parseFloat(override.beginningBalance),
              totalContributions: parseFloat(override.totalContributions),
              yearlyGainLoss: parseFloat(override.yearlyGainLoss),
              endingBalance: parseFloat(override.endingBalance),
              employerContributions: parseFloat(override.employerContributions),
              distributions: parseFloat(override.distributions),
              fees: parseFloat(override.fees),
              rollovers: parseFloat(override.rollovers),
              lifetimeGains: parseFloat(override.lifetimeGains),
              lifetimeContributions: parseFloat(override.lifetimeContributions),
              lifetimeMatch: parseFloat(override.lifetimeMatch),
            };
            finalizedCatValues.push(vals);

            const returnPct = computeReturn(
              vals.beginningBalance,
              vals.totalContributions,
              vals.yearlyGainLoss,
              vals.employerContributions,
              vals.distributions,
              vals.fees,
              vals.rollovers,
            );

            await tx
              .update(schema.annualPerformance)
              .set({
                isFinalized: true,
                isCurrentYear: false,
                beginningBalance: override.beginningBalance,
                totalContributions: override.totalContributions,
                yearlyGainLoss: override.yearlyGainLoss,
                endingBalance: override.endingBalance,
                annualReturnPct: returnPct?.toFixed(6) ?? null,
                employerContributions: override.employerContributions,
                distributions: override.distributions,
                fees: override.fees,
                rollovers: override.rollovers,
                lifetimeGains: override.lifetimeGains,
                lifetimeContributions: override.lifetimeContributions,
                lifetimeMatch: override.lifetimeMatch,
              })
              .where(
                and(
                  eq(schema.annualPerformance.year, year),
                  eq(schema.annualPerformance.category, category),
                ),
              );
          } else {
            // Compute from account data
            const sums = sumAccounts(catAccounts);
            const prev = prevAnnualRows.find((r) => r.category === category);
            const ltGains = toNumber(prev?.lifetimeGains) + sums.gainLoss;
            const ltContribs =
              toNumber(prev?.lifetimeContributions) + sums.contribs;
            const ltMatch = toNumber(prev?.lifetimeMatch) + sums.employer;
            const returnPct = computeReturn(
              sums.beginBal,
              sums.contribs,
              sums.gainLoss,
              sums.employer,
              sums.distributions,
              sums.fees,
              sums.rollovers,
            );

            finalizedCatValues.push({
              beginningBalance: sums.beginBal,
              totalContributions: sums.contribs,
              yearlyGainLoss: sums.gainLoss,
              endingBalance: sums.endBal,
              employerContributions: sums.employer,
              distributions: sums.distributions,
              fees: sums.fees,
              rollovers: sums.rollovers,
              lifetimeGains: ltGains,
              lifetimeContributions: ltContribs,
              lifetimeMatch: ltMatch,
            });

            await tx
              .update(schema.annualPerformance)
              .set({
                isFinalized: true,
                isCurrentYear: false,
                beginningBalance: sums.beginBal.toFixed(2),
                totalContributions: sums.contribs.toFixed(2),
                yearlyGainLoss: sums.gainLoss.toFixed(2),
                endingBalance: sums.endBal.toFixed(2),
                annualReturnPct: returnPct?.toFixed(6) ?? null,
                employerContributions: sums.employer.toFixed(2),
                distributions: sums.distributions.toFixed(2),
                fees: sums.fees.toFixed(2),
                rollovers: sums.rollovers.toFixed(2),
                lifetimeGains: ltGains.toFixed(2),
                lifetimeContributions: ltContribs.toFixed(2),
                lifetimeMatch: ltMatch.toFixed(2),
              })
              .where(
                and(
                  eq(schema.annualPerformance.year, year),
                  eq(schema.annualPerformance.category, category),
                ),
              );
          }
        }

        // Second pass: finalize Portfolio row by summing per-category values
        {
          const portfolioOverride = overrideMap.get("Portfolio");
          if (portfolioOverride) {
            const returnPct = computeReturn(
              parseFloat(portfolioOverride.beginningBalance),
              parseFloat(portfolioOverride.totalContributions),
              parseFloat(portfolioOverride.yearlyGainLoss),
              parseFloat(portfolioOverride.employerContributions),
              parseFloat(portfolioOverride.distributions),
              parseFloat(portfolioOverride.fees),
              parseFloat(portfolioOverride.rollovers),
            );

            await tx
              .update(schema.annualPerformance)
              .set({
                isFinalized: true,
                isCurrentYear: false,
                beginningBalance: portfolioOverride.beginningBalance,
                totalContributions: portfolioOverride.totalContributions,
                yearlyGainLoss: portfolioOverride.yearlyGainLoss,
                endingBalance: portfolioOverride.endingBalance,
                annualReturnPct: returnPct?.toFixed(6) ?? null,
                employerContributions: portfolioOverride.employerContributions,
                distributions: portfolioOverride.distributions,
                fees: portfolioOverride.fees,
                rollovers: portfolioOverride.rollovers,
                lifetimeGains: portfolioOverride.lifetimeGains,
                lifetimeContributions: portfolioOverride.lifetimeContributions,
                lifetimeMatch: portfolioOverride.lifetimeMatch,
              })
              .where(
                and(
                  eq(schema.annualPerformance.year, year),
                  eq(schema.annualPerformance.category, "Portfolio"),
                ),
              );
          } else if (finalizedCatValues.length > 0) {
            const ps = sumAnnualRows(finalizedCatValues);
            const returnPct = computeReturn(
              ps.beginBal,
              ps.contribs,
              ps.gainLoss,
              ps.employer,
              ps.distributions,
              ps.fees,
              ps.rollovers,
            );

            await tx
              .update(schema.annualPerformance)
              .set({
                isFinalized: true,
                isCurrentYear: false,
                beginningBalance: ps.beginBal.toFixed(2),
                totalContributions: ps.contribs.toFixed(2),
                yearlyGainLoss: ps.gainLoss.toFixed(2),
                endingBalance: ps.endBal.toFixed(2),
                annualReturnPct: returnPct?.toFixed(6) ?? null,
                employerContributions: ps.employer.toFixed(2),
                distributions: ps.distributions.toFixed(2),
                fees: ps.fees.toFixed(2),
                rollovers: ps.rollovers.toFixed(2),
                lifetimeGains: ps.lifetimeGains.toFixed(2),
                lifetimeContributions: ps.lifetimeContribs.toFixed(2),
                lifetimeMatch: ps.lifetimeMatch.toFixed(2),
              })
              .where(
                and(
                  eq(schema.annualPerformance.year, year),
                  eq(schema.annualPerformance.category, "Portfolio"),
                ),
              );
          }
        }

        // 4a. Mark account_performance rows as finalized for this year
        await tx
          .update(schema.accountPerformance)
          .set({ isFinalized: true })
          .where(eq(schema.accountPerformance.year, year));

        // 4b. Load existing next-year rows to merge (create missing accounts, skip existing)
        const existingNext = await tx
          .select()
          .from(schema.accountPerformance)
          .where(eq(schema.accountPerformance.year, nextYear));

        {
          // 5. Create next-year account_performance rows for active accounts that don't already exist
          // (allPerfAccounts already loaded above for finalizeLookups)
          const activeMasterIds = new Set(
            allPerfAccounts.filter((m) => m.isActive).map((m) => m.id),
          );
          const activeAccounts = finalizedAccts.filter((a) => {
            if (!a.isActive) return false;
            if (
              a.performanceAccountId &&
              !activeMasterIds.has(a.performanceAccountId)
            )
              return false;
            return true;
          });

          // Build a Set of existing next-year account keys to skip duplicates
          const existingKeys = new Set(
            existingNext.map(
              (a) =>
                `${a.institution}:${a.accountLabel}:${a.ownerPersonId ?? ""}`,
            ),
          );
          const missingAccounts = activeAccounts.filter(
            (a) =>
              !existingKeys.has(
                `${a.institution}:${a.accountLabel}:${a.ownerPersonId ?? ""}`,
              ),
          );

          if (missingAccounts.length > 0) {
            await tx.insert(schema.accountPerformance).values(
              missingAccounts.map((a) => {
                const masterAcct = a.performanceAccountId
                  ? allPerfAccounts.find((m) => m.id === a.performanceAccountId)
                  : null;
                return {
                  year: nextYear,
                  institution: a.institution,
                  accountLabel: a.accountLabel,
                  ownerPersonId: a.ownerPersonId,
                  parentCategory:
                    masterAcct?.parentCategory ?? a.parentCategory,
                  isActive: true,
                  performanceAccountId: a.performanceAccountId,
                  beginningBalance: a.endingBalance, // prev year ending = next year beginning
                  totalContributions: "0",
                  yearlyGainLoss: "0",
                  endingBalance: a.endingBalance, // start with same as beginning
                  employerContributions: "0",
                  fees: "0",
                  distributions: "0",
                };
              }),
            );
          }

          // 6. Create next-year annual_performance category rollup rows (skip existing categories)
          // Re-read the now-finalized annual rows for accurate lifetime carry-forward
          const finalizedAnnualRows = await tx
            .select()
            .from(schema.annualPerformance)
            .where(eq(schema.annualPerformance.year, year));

          const existingAnnualNext = await tx
            .select()
            .from(schema.annualPerformance)
            .where(eq(schema.annualPerformance.year, nextYear));
          const existingAnnualCategories = new Set(
            existingAnnualNext.map((r) => r.category),
          );

          // Categories derived from accountType (consistent with getSummary grouping)
          const nextYearCategories = Array.from(
            new Set(
              activeAccounts.map((a) =>
                getEffectiveCategory(a, finalizeLookups),
              ),
            ),
          );
          nextYearCategories.push("Portfolio");

          for (const category of nextYearCategories) {
            if (existingAnnualCategories.has(category)) continue;

            const catAccounts =
              category === "Portfolio"
                ? activeAccounts
                : activeAccounts.filter(
                    (a) =>
                      getEffectiveCategory(a, finalizeLookups) === category,
                  );

            const beginBal = catAccounts.reduce(
              (sum, a) => sum + toNumber(a.endingBalance),
              0,
            );
            const prev = finalizedAnnualRows.find(
              (r) => r.category === category,
            );

            await tx.insert(schema.annualPerformance).values({
              year: nextYear,
              category,
              beginningBalance: beginBal.toFixed(2),
              totalContributions: "0",
              yearlyGainLoss: "0",
              endingBalance: beginBal.toFixed(2),
              employerContributions: "0",
              fees: "0",
              distributions: "0",
              lifetimeGains: prev?.lifetimeGains ?? "0",
              lifetimeContributions: prev?.lifetimeContributions ?? "0",
              lifetimeMatch: prev?.lifetimeMatch ?? "0",
              isCurrentYear: true,
              isFinalized: false,
            });
          }
        }

        // 7. Create or update net_worth_annual row for the finalized year
        // Portfolio data comes from finalized account_performance; non-portfolio from app state
        // (allPerfAccounts already loaded above)

        let portfolioTotal = 0;

        for (const acct of finalizedAccts) {
          const endBal = toNumber(acct.endingBalance);
          portfolioTotal += endBal;
        }

        // Non-portfolio data from app state + item tables
        const [
          allSettings,
          mortgageLoans,
          mortgageExtras,
          allJobs,
          homeImpItems,
          propTaxRows,
        ] = await Promise.all([
          tx.select().from(schema.appSettings),
          tx.select().from(schema.mortgageLoans),
          tx
            .select()
            .from(schema.mortgageExtraPayments)
            .orderBy(asc(schema.mortgageExtraPayments.paymentDate)),
          tx.select().from(schema.jobs).orderBy(asc(schema.jobs.startDate)),
          tx.select().from(schema.homeImprovementItems),
          tx
            .select()
            .from(schema.propertyTaxes)
            .where(eq(schema.propertyTaxes.year, year)),
        ]);

        const setting = parseAppSettings(allSettings);
        const yearEndDate = `${year}-12-31`;
        const asOfDate = new Date(yearEndDate);

        const { cash } = await getEffectiveCash(tx, allSettings);
        const otherAssets = await getEffectiveOtherAssets(tx, allSettings);
        const otherLiabilities = setting("current_other_liabilities", 0);

        // Compute cumulative home improvements from items table (not app_settings scalar)
        const homeImprovements = homeImpItems
          .filter((hi) => hi.year <= year)
          .reduce((sum, hi) => sum + toNumber(hi.cost), 0);

        // Snapshot property taxes from propertyTaxes table
        const propertyTaxes = propTaxRows.reduce(
          (sum, pt) => sum + toNumber(pt.taxAmount),
          0,
        );

        const mortgageBalance = computeMortgageBalance(
          mortgageLoans,
          mortgageExtras,
          asOfDate,
        );

        const activeLoan = mortgageLoans.find((m) => m.isActive);
        const houseValue = activeLoan
          ? toNumber(
              activeLoan.propertyValueEstimated ??
                activeLoan.propertyValuePurchase,
            )
          : 0;

        // Gross income from jobs active at year end
        const activeJobsAtYearEnd = allJobs.filter(
          (j) =>
            new Date(j.startDate) <= asOfDate &&
            (!j.endDate || new Date(j.endDate) >= asOfDate),
        );
        const jobSalaries = await getSalariesForJobs(
          tx,
          activeJobsAtYearEnd,
          asOfDate,
        );
        const grossIncome = jobSalaries.reduce(
          (s, js) => s + js.effectiveIncome,
          0,
        );

        // Check if row already exists for this year
        const existingNW = await tx.select().from(schema.netWorthAnnual);
        const existingRow = existingNW.find(
          (r) => new Date(r.yearEndDate).getFullYear() === year,
        );

        const nwValues = {
          yearEndDate,
          grossIncome: grossIncome.toFixed(2),
          portfolioTotal: portfolioTotal.toFixed(2),
          cash: cash.toFixed(2),
          houseValue: houseValue.toFixed(2),
          otherAssets: otherAssets.toFixed(2),
          mortgageBalance: mortgageBalance.toFixed(2),
          otherLiabilities: otherLiabilities.toFixed(2),
          homeImprovementsCumulative: homeImprovements.toFixed(2),
          propertyTaxes: propertyTaxes > 0 ? propertyTaxes.toFixed(2) : null,
        };

        if (existingRow) {
          // Update existing row — preserve manual fields (AGI, taxes, etc.), update auto fields
          await tx
            .update(schema.netWorthAnnual)
            .set(nwValues)
            .where(eq(schema.netWorthAnnual.id, existingRow.id));
        } else {
          // Create new row — manual fields start as null/zero
          await tx.insert(schema.netWorthAnnual).values({
            ...nwValues,
            combinedAgi: "0",
          });
        }

        await stampPerformanceUpdated(tx);
        invalidateYearEndCache();
        return { success: true, finalizedYear: year, createdYear: nextYear };
      }); // end transaction
    }),
});
