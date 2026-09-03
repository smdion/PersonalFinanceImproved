/** Performance router for portfolio time-weighted return tracking, snapshot ingestion, account-level performance history, and category rollup calculations. */
import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { asc, eq, and, sql, isNull } from "drizzle-orm";
import {
  PERF_BALANCE_MISMATCH_ABS,
  PERF_BALANCE_MISMATCH_PCT,
} from "@/lib/constants";
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
  getActiveMortgageLoan,
  parseAppSettings,
  getEffectiveCash,
  getEffectiveCreditCardDebt,
  getEffectiveOtherAssets,
  invalidateYearEndCache,
  loadEffectiveSalaryProfile,
  resolvePersonYearIncome,
} from "@/server/helpers";
import { getAllPeople } from "@/server/helpers/people";
import {
  findActiveJob,
  canDeletePerformanceAccount,
} from "@/lib/pure/profiles";
import { computeHomeImpCumulative } from "@/lib/pure/historical";
import {
  resolveCategoryValues,
  resolvePortfolioValues,
  filterAccountsForNextYear,
  buildAccountKeys,
  assembleNetWorthValues,
  computePortfolioTotal,
  sumAccounts,
  sumAnnualRows,
  computeReturn,
  type AnnualRowLike,
  recomputeLifetimeFields,
} from "@/lib/pure/performance";
import { accountDisplayName, buildAccountLabel } from "@/lib/utils/format";
import {
  isRetirementParent,
  isPortfolioParent,
  accountCategoryEnum,
  parentCategoryEnum,
} from "@/lib/config/account-types";
import {
  accountTypeToPerformanceCategory,
  FULLY_RETIREMENT_PERF_CATEGORIES,
  PARENT_CATEGORY_ROLLUPS,
  PERF_CATEGORY_BROKERAGE,
  PERF_CATEGORY_PORTFOLIO,
  PERF_CATEGORY_RETIREMENT,
  PERF_CATEGORY_DISPLAY_ORDER,
  type PerfCategory,
} from "@/lib/config/display-labels";
import {
  ACCOUNT_OWNERSHIP_VALUES,
  RETIREMENT_BEHAVIOR_VALUES,
  CONTRIBUTION_SCALING_VALUES,
} from "@/lib/config/enum-values";
import { recomputeAnnualRollups } from "./settings/_shared";
import { finalizeRothBasisForYear } from "@/server/helpers/roth-basis";

const performanceAccountInput = z.object({
  institution: z.string().trim().min(1),
  accountType: z.enum(accountCategoryEnum()),
  subType: z.string().nullable().optional(),
  label: z.string().trim().nullable().optional(),
  displayName: z.string().trim().nullable().optional(),
  ownerPersonId: z.number().int().nullable().optional(),
  ownershipType: z.enum(ACCOUNT_OWNERSHIP_VALUES),
  retirementBehavior: z
    .enum(RETIREMENT_BEHAVIOR_VALUES)
    .default("stops_at_owner_retirement"),
  contributionScaling: z
    .enum(CONTRIBUTION_SCALING_VALUES)
    .default("scales_with_salary"),
  allowPenalizedWithdrawals: z.boolean().default(false),
  costBasis: z.string().default("0"),
  parentCategory: z.enum(parentCategoryEnum()),
  isActive: z.boolean().default(true),
  displayOrder: z.number().int().default(0),
});

/** Accepts both the main db instance and transaction handles. */
type DbType =
  typeof appDb | Parameters<Parameters<typeof appDb.transaction>[0]>[0];
type PerfAccount = typeof schema.performanceAccounts.$inferSelect;

function buildPerfAcctLookups(perfAccounts: PerfAccount[]) {
  return new Map(perfAccounts.map((pa) => [pa.id, pa]));
}

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

function resolveMaster(
  a: {
    id: number;
    performanceAccountId: number | null;
    institution: string;
    accountLabel: string;
  },
  byId: Map<number, PerfAccount>,
): PerfAccount {
  if (a.performanceAccountId == null) {
    throw new Error(
      `account_performance.id=${a.id} (${a.institution}:${a.accountLabel}) has null performanceAccountId`,
    );
  }
  const master = byId.get(a.performanceAccountId);
  if (!master) {
    throw new Error(
      `account_performance.id=${a.id} references missing performance_account.id=${a.performanceAccountId}`,
    );
  }
  return master;
}

function getEffectiveCategory(
  a: {
    id: number;
    performanceAccountId: number | null;
    institution: string;
    accountLabel: string;
  },
  byId: Map<number, PerfAccount>,
): PerfCategory {
  return accountTypeToPerformanceCategory(
    resolveMaster(a, byId).accountType,
  ) as PerfCategory;
}

/** Cascade-recompute lifetime fields on all annual_performance rows.
 *  Called after edits to account_performance on finalized years. */
async function cascadeLifetimeFields(db: DbType) {
  const allAnnual = await db
    .select({
      id: schema.annualPerformance.id,
      year: schema.annualPerformance.year,
      category: schema.annualPerformance.category,
      yearlyGainLoss: schema.annualPerformance.yearlyGainLoss,
      totalContributions: schema.annualPerformance.totalContributions,
      employerContributions: schema.annualPerformance.employerContributions,
      lifetimeGains: schema.annualPerformance.lifetimeGains,
      lifetimeContributions: schema.annualPerformance.lifetimeContributions,
      lifetimeMatch: schema.annualPerformance.lifetimeMatch,
    })
    .from(schema.annualPerformance)
    .orderBy(asc(schema.annualPerformance.year));

  const rows = allAnnual.map((r) => ({
    id: r.id,
    year: r.year,
    category: r.category,
    yearlyGainLoss: toNumber(r.yearlyGainLoss),
    totalContributions: toNumber(r.totalContributions),
    employerContributions: toNumber(r.employerContributions),
    lifetimeGains: toNumber(r.lifetimeGains),
    lifetimeContributions: toNumber(r.lifetimeContributions),
    lifetimeMatch: toNumber(r.lifetimeMatch),
  }));

  const updates = recomputeLifetimeFields(rows);
  for (const u of updates) {
    await db
      .update(schema.annualPerformance)
      .set({
        lifetimeGains: u.lifetimeGains.toFixed(2),
        lifetimeContributions: u.lifetimeContributions.toFixed(2),
        lifetimeMatch: u.lifetimeMatch.toFixed(2),
      })
      .where(eq(schema.annualPerformance.id, u.id));
  }
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

import { zDecimal } from "@/server/routers/settings/_shared";

/** Optional decimal — for partial-update mutations. */
const zDecimalOpt = zDecimal.optional();

const annualUpdateInput = z.object({
  id: z.number().int(),
  beginningBalance: zDecimalOpt,
  totalContributions: zDecimalOpt,
  yearlyGainLoss: zDecimalOpt,
  endingBalance: zDecimalOpt,
  annualReturnPct: z.string().nullable().optional(),
  employerContributions: zDecimalOpt,
  fees: zDecimalOpt,
  distributions: zDecimalOpt,
  rollovers: zDecimalOpt,
});

const accountUpdateInput = z.object({
  id: z.number().int(),
  beginningBalance: zDecimalOpt,
  totalContributions: zDecimalOpt,
  yearlyGainLoss: zDecimalOpt,
  endingBalance: zDecimalOpt,
  annualReturnPct: z.string().nullable().optional(),
  employerContributions: zDecimalOpt,
  fees: zDecimalOpt,
  distributions: zDecimalOpt,
  rollovers: zDecimalOpt,
});

const accountCreateInput = z.object({
  year: z.number().int(),
  performanceAccountId: z.number().int(),
  beginningBalance: zDecimal,
  totalContributions: zDecimal,
  yearlyGainLoss: zDecimal,
  endingBalance: zDecimal,
  annualReturnPct: z.string().nullable().optional(),
  employerContributions: zDecimal.default("0"),
  fees: zDecimal.default("0"),
  distributions: zDecimal.default("0"),
  rollovers: zDecimal.default("0"),
  isActive: z.boolean().default(true),
});

// --- Shared helpers — canonical implementations live in @/lib/pure/performance ---
export {
  computeReturn,
  sumAccounts,
  sumAnnualRows,
} from "@/lib/pure/performance";
export type { AccountLike, AnnualRowLike } from "@/lib/pure/performance";

export const performanceRouter = createTRPCRouter({
  /**
   * computeSummary — returns all performance data joined through the master performance_accounts table.
   * Includes: annual rollups, account-level detail, master account list, and current-year status.
   */
  computeSummary: protectedProcedure.query(async ({ ctx }) => {
    const [annual, accounts, perfAccounts, people, basisRows] =
      await Promise.all([
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
      ]);

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
      const basis =
        r.ownerPersonId != null
          ? basisByKey.get(
              `${r.performanceAccountId}|${r.ownerPersonId}|${r.year}`,
            )
          : undefined;
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
        contributionBasis: basis ? toNumber(basis.contributionBasis) : null,
        conversionBasis: basis ? toNumber(basis.conversionBasis) : null,
        latestConversionYear: basis?.latestConversionYear ?? null,
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
    const performanceLastUpdated = perfUpdatedSetting[0]?.value as
      string | null;

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
    const lifetimeFees = portfolioAnnualRows.reduce(
      (sum, r) => sum + r.fees,
      0,
    );
    const lifetimeDistributions = portfolioAnnualRows.reduce(
      (sum, r) => sum + r.distributions,
      0,
    );

    // Pending rollovers — expose to UI for badges and confirmation flow
    const pendingRolloversRaw = await ctx.db
      .select()
      .from(schema.pendingRollovers)
      .where(isNull(schema.pendingRollovers.confirmedAt));

    const pendingRollovers = pendingRolloversRaw.map((r) => ({
      id: r.id,
      sourceAccountPerformanceId: r.sourceAccountPerformanceId,
      destinationPerformanceAccountId: r.destinationPerformanceAccountId,
      amount: toNumber(r.amount),
      saleDate: r.saleDate,
      saleYear: r.saleYear,
      applyYear: r.applyYear,
      notes: r.notes,
      createdAt: r.createdAt.toISOString(),
    }));

    // Ending balance consistency check: compare sum of account ending balances
    // (current year) against the latest portfolio snapshot total.
    // Only fires when both share the same date — a different date means expected staleness.
    const balanceMismatch = (() => {
      if (!snapshotData) return null;
      const snapDate = snapshotData.snapshot.snapshotDate;
      const perfDate =
        typeof performanceLastUpdated === "string"
          ? performanceLastUpdated.slice(0, 10)
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

      // Check if delta is explained by pending rollovers
      const pendingTotal = pendingRollovers
        .filter(
          (pr) => pr.saleYear === currentYear || pr.applyYear === currentYear,
        )
        .reduce((sum, pr) => sum + pr.amount, 0);
      return {
        perfTotal,
        snapTotal,
        delta,
        explainedByPending:
          Math.abs(Math.abs(delta) - pendingTotal) <= threshold,
      };
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
      pendingRollovers,
      balanceMismatch,
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

      // Block edits to lifetime_* fields on immutable rows. Lifetime totals
      // on finalized rows are authoritative and recomputed only via the
      // cascadeLifetimeFields() helper after upstream account_performance
      // edits — never directly via the user-facing updateAnnual mutation.
      // RULES.md § Data Model Principles point 4 cascade rule.
      const LIFETIME_FIELDS = new Set([
        "lifetimeGains",
        "lifetimeContributions",
        "lifetimeMatch",
      ]);
      const touchesLifetime = Object.keys(updates).some((k) =>
        LIFETIME_FIELDS.has(k),
      );
      if (touchesLifetime) {
        const [row] = await ctx.db
          .select({ isImmutable: schema.annualPerformance.isImmutable })
          .from(schema.annualPerformance)
          .where(eq(schema.annualPerformance.id, id))
          .limit(1);
        if (row?.isImmutable) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message:
              "Cannot edit lifetime fields on a finalized annual_performance row directly. " +
              "Edit the underlying account_performance rows instead — the cascade will recompute lifetime totals.",
          });
        }
      }

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
      // If the edited account is on a finalized year, cascade lifetime fields
      const [acctRow] = await ctx.db
        .select({ year: schema.accountPerformance.year })
        .from(schema.accountPerformance)
        .where(eq(schema.accountPerformance.id, id));
      if (acctRow) {
        const [annual] = await ctx.db
          .select({ isFinalized: schema.annualPerformance.isFinalized })
          .from(schema.annualPerformance)
          .where(eq(schema.annualPerformance.year, acctRow.year))
          .limit(1);
        if (annual?.isFinalized) {
          await cascadeLifetimeFields(ctx.db);
        }
      }
      await stampPerformanceUpdated(ctx.db);
      return { success: true };
    }),

  updateCostBasis: performanceProcedure
    .input(
      z.object({
        performanceAccountId: z.number().int(),
        costBasis: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(schema.performanceAccounts)
        .set({ costBasis: input.costBasis })
        .where(eq(schema.performanceAccounts.id, input.performanceAccountId));
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
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Performance account ${input.performanceAccountId} not found`,
        });

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
   * Batch-update account_performance rows for the current year.
   * Used by the Update Performance form to save all flow fields in one pass.
   * Annual rollups are recomputed automatically by computeSummary on next query.
   */
  batchUpdateAccounts: performanceProcedure
    .input(
      z.object({
        accounts: z.array(
          z.object({
            id: z.number().int(),
            totalContributions: zDecimal,
            employerContributions: zDecimal,
            distributions: zDecimal,
            rollovers: zDecimal,
            fees: zDecimal,
            endingBalance: zDecimal,
            yearlyGainLoss: zDecimal,
          }),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.accounts.length === 0) return { success: true };
      await ctx.db.transaction(async (tx) => {
        for (const acct of input.accounts) {
          await tx
            .update(schema.accountPerformance)
            .set({
              totalContributions: acct.totalContributions,
              employerContributions: acct.employerContributions,
              distributions: acct.distributions,
              rollovers: acct.rollovers,
              fees: acct.fees,
              endingBalance: acct.endingBalance,
              yearlyGainLoss: acct.yearlyGainLoss,
            })
            .where(eq(schema.accountPerformance.id, acct.id));
        }
        // If any edited account is on a finalized year, cascade lifetime fields
        if (input.accounts.length > 0) {
          const [sample] = await tx
            .select({ year: schema.accountPerformance.year })
            .from(schema.accountPerformance)
            .where(eq(schema.accountPerformance.id, input.accounts[0]!.id));
          if (sample) {
            const [annual] = await tx
              .select({ isFinalized: schema.annualPerformance.isFinalized })
              .from(schema.annualPerformance)
              .where(eq(schema.annualPerformance.year, sample.year))
              .limit(1);
            if (annual?.isFinalized) {
              await cascadeLifetimeFields(tx);
            }
          }
        }
        await stampPerformanceUpdated(tx);
      });
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
              category: z.enum(PERF_CATEGORY_DISPLAY_ORDER),
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
        // Guard: reject if year is already finalized.
        // SQLite's single-writer model provides serialization; PG relies on
        // the SERIALIZABLE transaction isolation already set on the pool.
        const existingAnnualRows = await tx
          .select()
          .from(schema.annualPerformance)
          .where(eq(schema.annualPerformance.year, year));

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
          const prev = prevAnnualRows.find((r) => r.category === category);
          const { values, returnPct } = resolveCategoryValues(
            catAccounts,
            override,
            {
              lifetimeGains: toNumber(prev?.lifetimeGains),
              lifetimeContributions: toNumber(prev?.lifetimeContributions),
              lifetimeMatch: toNumber(prev?.lifetimeMatch),
            },
          );
          finalizedCatValues.push(values);

          await tx
            .update(schema.annualPerformance)
            .set({
              isFinalized: true,
              isCurrentYear: false,
              isImmutable: true,
              beginningBalance: values.beginningBalance.toFixed(2),
              totalContributions: values.totalContributions.toFixed(2),
              yearlyGainLoss: values.yearlyGainLoss.toFixed(2),
              endingBalance: values.endingBalance.toFixed(2),
              annualReturnPct: returnPct?.toFixed(6) ?? null,
              employerContributions: values.employerContributions.toFixed(2),
              distributions: values.distributions.toFixed(2),
              fees: values.fees.toFixed(2),
              rollovers: values.rollovers.toFixed(2),
              lifetimeGains: values.lifetimeGains.toFixed(2),
              lifetimeContributions: values.lifetimeContributions.toFixed(2),
              lifetimeMatch: values.lifetimeMatch.toFixed(2),
            })
            .where(
              and(
                eq(schema.annualPerformance.year, year),
                eq(schema.annualPerformance.category, category),
              ),
            );
        }

        // Second pass: finalize Portfolio row by summing per-category values
        {
          const portfolioOverride = overrideMap.get("Portfolio");
          const portfolioResult =
            portfolioOverride || finalizedCatValues.length > 0
              ? resolvePortfolioValues(finalizedCatValues, portfolioOverride)
              : null;

          if (portfolioResult) {
            const { values: pv, returnPct } = portfolioResult;
            await tx
              .update(schema.annualPerformance)
              .set({
                isFinalized: true,
                isCurrentYear: false,
                isImmutable: true,
                beginningBalance: pv.beginningBalance.toFixed(2),
                totalContributions: pv.totalContributions.toFixed(2),
                yearlyGainLoss: pv.yearlyGainLoss.toFixed(2),
                endingBalance: pv.endingBalance.toFixed(2),
                annualReturnPct: returnPct?.toFixed(6) ?? null,
                employerContributions: pv.employerContributions.toFixed(2),
                distributions: pv.distributions.toFixed(2),
                fees: pv.fees.toFixed(2),
                rollovers: pv.rollovers.toFixed(2),
                lifetimeGains: pv.lifetimeGains.toFixed(2),
                lifetimeContributions: pv.lifetimeContributions.toFixed(2),
                lifetimeMatch: pv.lifetimeMatch.toFixed(2),
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

        // 4a-roth. Finalize this year's Roth basis rows and seed next
        // year's — same year-boundary event, its own correctly-keyed table
        // (accountPerformance doesn't split a jointly-labeled account per
        // owner, which Roth basis correctness needs).
        await finalizeRothBasisForYear(tx, year);

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
          const activeAccounts = filterAccountsForNextYear(
            finalizedAccts,
            activeMasterIds,
          );

          // Build a Set of existing next-year account keys to skip duplicates
          const existingKeys = buildAccountKeys(existingNext);
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
              category === PERF_CATEGORY_PORTFOLIO
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

        const portfolioTotal = computePortfolioTotal(finalizedAccts);

        // Non-portfolio data from app state + item tables
        const [
          allSettings,
          mortgageLoans,
          mortgageExtras,
          homeImpItems,
          propTaxRows,
        ] = await Promise.all([
          tx.select().from(schema.appSettings),
          tx.select().from(schema.mortgageLoans),
          tx
            .select()
            .from(schema.mortgageExtraPayments)
            .orderBy(asc(schema.mortgageExtraPayments.paymentDate)),
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
        const otherAssets = await getEffectiveOtherAssets(
          tx,
          allSettings,
          asOfDate,
        );
        // Same addition as buildYearEndHistory's current-year branch
        // (snapshot.ts) — locks in whatever the live view showed right
        // before finalizing, so the permanently-stored figure doesn't
        // silently drop the API-mapped credit-card debt component.
        const otherLiabilities =
          setting("current_other_liabilities", 0) +
          (await getEffectiveCreditCardDebt(tx));

        // Compute cumulative home improvements from items table (not app_settings scalar)
        const homeImprovements = computeHomeImpCumulative(homeImpItems, year);

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

        const activeLoan = getActiveMortgageLoan(mortgageLoans);
        const houseValue = activeLoan
          ? toNumber(
              activeLoan.propertyValueEstimated ??
                activeLoan.propertyValuePurchase,
            )
          : 0;

        // Gross income for the finalized year — Historical owns this
        // directly now (a job has no salary/bonus of its own, and there is
        // no dated ledger to resolve a past year from any more; see
        // schema-pg.ts's historicalSalaries table comment). Sum every
        // person's recorded salary + bonus for this year, falling back
        // (current year only) to the active Salary Profile the same way
        // historical.ts's computeSummary/upsertSalary do — otherwise
        // finalizing before anyone has recorded salary permanently writes
        // a false $0 into net_worth_annual.
        const [yearSalaryRows, allPeople, allJobs] = await Promise.all([
          tx
            .select()
            .from(schema.historicalSalaries)
            .where(eq(schema.historicalSalaries.year, year)),
          tx.select().from(schema.people),
          tx.select().from(schema.jobs),
        ]);
        const salaryRowByPerson = new Map(
          yearSalaryRows.map((r) => [r.personId, r]),
        );
        const currentYear = new Date().getFullYear();
        const salaryProfileActiveMap =
          year === currentYear
            ? await loadEffectiveSalaryProfile(tx, null)
            : new Map();
        let grossIncome = 0;
        let anyIncomeRecorded = false;
        for (const person of allPeople) {
          const activeJob = findActiveJob(allJobs, person.id);
          const income = resolvePersonYearIncome(
            year,
            currentYear,
            salaryRowByPerson.get(person.id),
            activeJob?.id ?? null,
            salaryProfileActiveMap,
          );
          grossIncome += income.salary + income.bonus;
          if (income.recorded) anyIncomeRecorded = true;
        }

        if (allPeople.length > 0 && !anyIncomeRecorded) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `No salary data exists for ${year} yet. Record it on the Historical page (or complete the active Salary Profile's entries for the current year) before finalizing.`,
          });
        }

        // Check if row already exists for this year
        const existingNW = await tx.select().from(schema.netWorthAnnual);
        const existingRow = existingNW.find(
          (r) => new Date(r.yearEndDate).getFullYear() === year,
        );

        const nwValues = assembleNetWorthValues({
          yearEndDate,
          grossIncome,
          portfolioTotal,
          cash,
          houseValue,
          otherAssets,
          mortgageBalance,
          otherLiabilities,
          homeImprovements,
          propertyTaxes,
        });

        // Build portfolio_by_tax_location from nearest snapshot at finalization time.
        // This captures the point-in-time tax location breakdown that may not be
        // reconstructible later (snapshots can be pruned/restructured).
        const nearestSnapshot = await tx
          .select()
          .from(schema.portfolioSnapshots)
          .orderBy(
            sql`ABS(EXTRACT(EPOCH FROM (${schema.portfolioSnapshots.snapshotDate}::timestamp - ${yearEndDate}::timestamp)))`,
          )
          .limit(1);

        const portfolioByTaxLocation: {
          retirement: Record<string, number>;
          portfolio: Record<string, number>;
        } = { retirement: {}, portfolio: {} };

        if (nearestSnapshot.length > 0) {
          const snapAccounts = await tx
            .select()
            .from(schema.portfolioAccounts)
            .where(
              eq(schema.portfolioAccounts.snapshotId, nearestSnapshot[0]!.id),
            );
          for (const a of snapAccounts) {
            const bucket = isPortfolioParent(a.parentCategory)
              ? portfolioByTaxLocation.portfolio
              : portfolioByTaxLocation.retirement;
            bucket[a.taxType] = (bucket[a.taxType] ?? 0) + toNumber(a.amount);
          }
        }

        if (existingRow) {
          // Update existing row — preserve manual fields (AGI, taxes, etc.), update auto fields
          await tx
            .update(schema.netWorthAnnual)
            .set({ ...nwValues, portfolioByTaxLocation })
            .where(eq(schema.netWorthAnnual.id, existingRow.id));
        } else {
          // Create new row — manual fields start as null/zero
          await tx.insert(schema.netWorthAnnual).values({
            ...nwValues,
            combinedAgi: "0",
            portfolioByTaxLocation,
          });
        }

        await stampPerformanceUpdated(tx);
        invalidateYearEndCache();
        return { success: true, finalizedYear: year, createdYear: nextYear };
      }); // end transaction
    }),

  // ---------------------------------------------------------------------------
  // Pending Rollover CRUD — all performanceProcedure
  // ---------------------------------------------------------------------------

  createPendingRollover: performanceProcedure
    .input(
      z.object({
        sourceAccountPerformanceId: z.number().int(),
        destinationPerformanceAccountId: z.number().int(),
        amount: zDecimal,
        saleDate: z.string(),
        saleYear: z.number().int(),
        applyYear: z.number().int(),
        notes: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .insert(schema.pendingRollovers)
        .values({
          sourceAccountPerformanceId: input.sourceAccountPerformanceId,
          destinationPerformanceAccountId:
            input.destinationPerformanceAccountId,
          amount: input.amount,
          saleDate: input.saleDate,
          saleYear: input.saleYear,
          applyYear: input.applyYear,
          notes: input.notes ?? null,
        })
        .returning({ id: schema.pendingRollovers.id });
      return { id: row!.id };
    }),

  editPendingRollover: performanceProcedure
    .input(
      z.object({
        id: z.number().int(),
        amount: zDecimalOpt,
        saleDate: z.string().optional(),
        applyYear: z.number().int().optional(),
        notes: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...fields } = input;
      const existing = await ctx.db
        .select({ confirmedAt: schema.pendingRollovers.confirmedAt })
        .from(schema.pendingRollovers)
        .where(eq(schema.pendingRollovers.id, id));
      if (!existing[0])
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Rollover not found",
        });
      if (existing[0].confirmedAt)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot edit a confirmed rollover",
        });
      await ctx.db
        .update(schema.pendingRollovers)
        .set(fields)
        .where(eq(schema.pendingRollovers.id, id));
      return { success: true };
    }),

  deletePendingRollover: performanceProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db
        .select({ confirmedAt: schema.pendingRollovers.confirmedAt })
        .from(schema.pendingRollovers)
        .where(eq(schema.pendingRollovers.id, input.id));
      if (!existing[0])
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Rollover not found",
        });
      if (existing[0].confirmedAt)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot delete a confirmed rollover",
        });
      await ctx.db
        .delete(schema.pendingRollovers)
        .where(eq(schema.pendingRollovers.id, input.id));
      return { success: true };
    }),

  confirmPendingRollover: performanceProcedure
    .input(
      z.object({
        id: z.number().int(),
        /** Override amount if actual wire differed from recorded amount. */
        actualAmount: zDecimalOpt,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db.transaction(async (tx) => {
        const [pr] = await tx
          .select()
          .from(schema.pendingRollovers)
          .where(eq(schema.pendingRollovers.id, input.id));
        if (!pr)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Rollover not found",
          });
        if (pr.confirmedAt)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Rollover already confirmed",
          });

        const finalAmount = input.actualAmount ?? pr.amount;

        // 1. Debit source account_performance: reduce endingBalance, record rollover out (negative)
        const [srcRow] = await tx
          .select()
          .from(schema.accountPerformance)
          .where(
            eq(schema.accountPerformance.id, pr.sourceAccountPerformanceId),
          );
        if (!srcRow)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Source account_performance row not found",
          });
        if (srcRow.isFinalized)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Source year is finalized — cannot apply rollover. Edit manually after unlocking.",
          });

        const srcEndBal =
          toNumber(srcRow.endingBalance) - toNumber(finalAmount);
        const srcRollovers = toNumber(srcRow.rollovers) - toNumber(finalAmount);
        await tx
          .update(schema.accountPerformance)
          .set({
            endingBalance: srcEndBal.toFixed(2),
            rollovers: srcRollovers.toFixed(2),
          })
          .where(
            eq(schema.accountPerformance.id, pr.sourceAccountPerformanceId),
          );

        // 2. Credit destination account_performance for applyYear — upsert if needed
        const destRows = await tx
          .select()
          .from(schema.accountPerformance)
          .where(
            and(
              eq(
                schema.accountPerformance.performanceAccountId,
                pr.destinationPerformanceAccountId,
              ),
              eq(schema.accountPerformance.year, pr.applyYear),
            ),
          );

        if (destRows[0]) {
          if (destRows[0].isFinalized)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "Destination year is finalized — cannot apply rollover. Edit manually after unlocking.",
            });
          const destRollovers =
            toNumber(destRows[0].rollovers) + toNumber(finalAmount);
          const destEndBal =
            toNumber(destRows[0].endingBalance) + toNumber(finalAmount);
          await tx
            .update(schema.accountPerformance)
            .set({
              rollovers: destRollovers.toFixed(2),
              endingBalance: destEndBal.toFixed(2),
            })
            .where(eq(schema.accountPerformance.id, destRows[0].id));
        } else {
          // No row for this year yet — check the year isn't finalized before crediting
          const [applyYearAnnual] = await tx
            .select({ isFinalized: schema.annualPerformance.isFinalized })
            .from(schema.annualPerformance)
            .where(eq(schema.annualPerformance.year, pr.applyYear))
            .limit(1);
          if (applyYearAnnual?.isFinalized)
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message:
                "Destination year is finalized — cannot apply rollover. Edit manually after unlocking.",
            });

          // Get prior year ending balance as beginning balance
          const [priorRow] = await tx
            .select({ endingBalance: schema.accountPerformance.endingBalance })
            .from(schema.accountPerformance)
            .where(
              and(
                eq(
                  schema.accountPerformance.performanceAccountId,
                  pr.destinationPerformanceAccountId,
                ),
                eq(schema.accountPerformance.year, pr.applyYear - 1),
              ),
            );
          const destMaster = await tx
            .select()
            .from(schema.performanceAccounts)
            .where(
              eq(
                schema.performanceAccounts.id,
                pr.destinationPerformanceAccountId,
              ),
            );
          if (!destMaster[0])
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Destination performance account not found",
            });
          const beginBal = priorRow ? toNumber(priorRow.endingBalance) : 0;
          const rolloverIn = toNumber(finalAmount);
          await tx.insert(schema.accountPerformance).values({
            year: pr.applyYear,
            institution: destMaster[0].institution,
            accountLabel: destMaster[0].accountLabel,
            ownerPersonId: destMaster[0].ownerPersonId,
            beginningBalance: beginBal.toFixed(2),
            totalContributions: "0",
            yearlyGainLoss: "0",
            endingBalance: (beginBal + rolloverIn).toFixed(2),
            employerContributions: "0",
            fees: "0",
            distributions: "0",
            rollovers: rolloverIn.toFixed(2),
            parentCategory: destMaster[0].parentCategory,
            isActive: true,
            isFinalized: false,
            performanceAccountId: pr.destinationPerformanceAccountId,
          });
        }

        // 3. Cascade lifetime fields if either year is finalized-adjacent
        await cascadeLifetimeFields(tx);

        // 4. Mark pending rollover confirmed and update amount if it changed
        await tx
          .update(schema.pendingRollovers)
          .set({
            confirmedAt: new Date(),
            amount: finalAmount,
          })
          .where(eq(schema.pendingRollovers.id, input.id));

        await stampPerformanceUpdated(tx);
        return { success: true };
      });
    }),

  performanceAccounts: createTRPCRouter({
    list: protectedProcedure.query(({ ctx }) =>
      ctx.db
        .select()
        .from(schema.performanceAccounts)
        .orderBy(
          asc(schema.performanceAccounts.displayOrder),
          asc(schema.performanceAccounts.id),
        ),
    ),
    create: performanceProcedure
      .input(performanceAccountInput)
      .mutation(async ({ ctx, input }) => {
        // Resolve owner name for programmatic label
        // Joint accounts always get "Joint" prefix; individual accounts get person name.
        let ownerName: string | null =
          input.ownershipType === "joint" ? "Joint" : null;
        if (input.ownershipType !== "joint" && input.ownerPersonId) {
          const [person] = await ctx.db
            .select({ name: schema.people.name })
            .from(schema.people)
            .where(eq(schema.people.id, input.ownerPersonId));
          ownerName = person?.name ?? null;
        }
        const accountLabel = buildAccountLabel({
          ownerName,
          accountType: input.accountType,
          subType: input.subType ?? null,
          label: input.label ?? null,
          institution: input.institution,
        });
        const [created] = await ctx.db
          .insert(schema.performanceAccounts)
          .values({
            ...input,
            accountLabel,
            ownerPersonId: input.ownerPersonId ?? null,
            subType: input.subType ?? null,
            label: input.label ?? null,
          })
          .returning();
        return created;
      }),
    update: performanceProcedure
      .input(
        z
          .object({ id: z.number().int() })
          .extend(performanceAccountInput.shape),
      )
      .mutation(async ({ ctx, input: { id, ...data } }) => {
        // Resolve owner name for programmatic label
        // Joint accounts always get "Joint" prefix; individual accounts get person name.
        let ownerName: string | null =
          data.ownershipType === "joint" ? "Joint" : null;
        if (data.ownershipType !== "joint" && data.ownerPersonId) {
          const [person] = await ctx.db
            .select({ name: schema.people.name })
            .from(schema.people)
            .where(eq(schema.people.id, data.ownerPersonId));
          ownerName = person?.name ?? null;
        }
        const accountLabel = buildAccountLabel({
          ownerName,
          accountType: data.accountType,
          subType: data.subType ?? null,
          label: data.label ?? null,
          institution: data.institution,
        });
        // Wrap entire cascade in a transaction for atomicity
        return await ctx.db.transaction(async (tx) => {
          // 1. Update the master record
          const [updated] = await tx
            .update(schema.performanceAccounts)
            .set({
              ...data,
              accountLabel,
              ownerPersonId: data.ownerPersonId ?? null,
              subType: data.subType ?? null,
              label: data.label ?? null,
            })
            .where(eq(schema.performanceAccounts.id, id))
            .returning();
          if (!updated) return null;

          // 2. Cascade denormalized fields to accountPerformance rows
          await tx
            .update(schema.accountPerformance)
            .set({
              institution: updated.institution,
              accountLabel: updated.accountLabel,
              ownerPersonId: updated.ownerPersonId,
              parentCategory: updated.parentCategory,
            })
            .where(eq(schema.accountPerformance.performanceAccountId, id));

          // 3. Cascade parentCategory to linked contributionAccounts
          await tx
            .update(schema.contributionAccounts)
            .set({ parentCategory: updated.parentCategory })
            .where(eq(schema.contributionAccounts.performanceAccountId, id));

          // 4. Cascade parentCategory to linked portfolioAccounts
          await tx
            .update(schema.portfolioAccounts)
            .set({ parentCategory: updated.parentCategory })
            .where(eq(schema.portfolioAccounts.performanceAccountId, id));

          // 5. Recompute annual rollups for all affected years
          const affectedYears = await tx
            .select({ year: schema.accountPerformance.year })
            .from(schema.accountPerformance)
            .where(eq(schema.accountPerformance.performanceAccountId, id));
          const uniqueYears = Array.from(
            new Set(affectedYears.map((r) => r.year)),
          );
          for (const yr of uniqueYears) {
            await recomputeAnnualRollups(tx, yr);
          }

          // 6. Stamp performance_last_updated for cache invalidation
          await stampPerformanceUpdated(tx);

          return updated;
        });
      }),
    delete: performanceProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(async ({ ctx, input }) => {
        // Pre-check: accountPerformance FK is RESTRICT — validate before hitting DB error
        const [perfCountRow] = await ctx.db
          .select({ count: sql<number>`count(*)` })
          .from(schema.accountPerformance)
          .where(eq(schema.accountPerformance.performanceAccountId, input.id));
        const perfCount = Number(perfCountRow?.count ?? 0);
        const deleteCheck = canDeletePerformanceAccount(perfCount);
        if (!deleteCheck.allowed) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: deleteCheck.reason!,
          });
        }

        // contributionAccounts and portfolioAccounts use SET NULL — they'll be unlinked
        await ctx.db
          .delete(schema.performanceAccounts)
          .where(eq(schema.performanceAccounts.id, input.id));
        return { success: true };
      }),
  }),
});
