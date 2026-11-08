import type { Db } from "@/lib/db";
import type { RequestScope } from "@/server/data/request-scope";
import { TRPCError } from "@trpc/server";
import { asc, desc, eq, gte, lte } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import {
  computeMortgageBalance,
  getActiveMortgageLoan,
} from "@/lib/pure/debts/mortgage-balance";
import { invalidateYearEndCache } from "@/server/services/net-worth/year-end-history";
import { getEffectiveOtherAssets } from "@/server/services/net-worth/other-assets";
import { getEffectiveCash } from "@/server/services/budget/account-balances";
import { loadEffectiveSalaryProfile } from "@/server/services/profiles/salary-profile";
import { toNumber } from "@/lib/utils/numbers";
import { computeHomeImpCumulative } from "@/lib/pure/net-worth/historical";
import {
  resolveCategoryValues,
  resolvePortfolioValues,
  filterAccountsForNextYear,
  buildAccountKeys,
  assembleNetWorthValues,
  computePortfolioTotal,
  type AnnualRowLike,
} from "@/lib/pure/investments/returns";
import type { PerfCategory } from "@/lib/config/display-labels";
import {
  buildPerfAcctLookups,
  getEffectiveCategory,
} from "@/lib/pure/investments/annual-rollups";
import { finalizeRothBasisForYear } from "@/server/services/accounts/roth-basis";
import { calendarYear } from "@/lib/utils/date";
import { getEffectiveOtherLiabilities } from "@/server/services/debts/other-liabilities";
import { stampPerformanceUpdated } from "@/server/services/performance/last-updated";
import {
  finalizedAnnualFields,
  nearestToYearEnd,
  nextYearAccountRow,
  nextYearAnnualRow,
  portfolioByTaxLocationFrom,
  yearGrossIncome,
} from "@/lib/pure/investments/finalize-year";

export async function finalizePerformanceYear(
  ctx: { db: Db; scope: RequestScope },
  input: {
    year: number;
    overrides?: {
      category: PerfCategory;
      beginningBalance: string;
      totalContributions: string;
      yearlyGainLoss: string;
      endingBalance: string;
      employerContributions: string;
      distributions: string;
      fees: string;
      rollovers: string;
      lifetimeGains: string;
      lifetimeContributions: string;
      lifetimeMatch: string;
    }[];
  },
) {
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
        message: `Year ${year} is already finalized. Adjust its figures in the Performance table instead.`,
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
    const allPerfAccounts = await tx.select().from(schema.performanceAccounts);
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

      // Upsert: a category can have account rows but no annual row
      // yet — an update alone would leave the year unfinalized.
      const catFields = finalizedAnnualFields(values, returnPct);
      await tx
        .insert(schema.annualPerformance)
        .values({ year, category, ...catFields })
        .onConflictDoUpdate({
          target: [
            schema.annualPerformance.year,
            schema.annualPerformance.category,
          ],
          set: catFields,
        });
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
        const portfolioFields = finalizedAnnualFields(pv, returnPct);
        await tx
          .insert(schema.annualPerformance)
          .values({ year, category: "Portfolio", ...portfolioFields })
          .onConflictDoUpdate({
            target: [
              schema.annualPerformance.year,
              schema.annualPerformance.category,
            ],
            set: portfolioFields,
          });
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
        await tx
          .insert(schema.accountPerformance)
          .values(
            missingAccounts.map((a) =>
              nextYearAccountRow(a, allPerfAccounts, nextYear),
            ),
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
          activeAccounts.map((a) => getEffectiveCategory(a, finalizeLookups)),
        ),
      );
      nextYearCategories.push("Portfolio");

      for (const category of nextYearCategories) {
        if (existingAnnualCategories.has(category)) continue;

        await tx
          .insert(schema.annualPerformance)
          .values(
            nextYearAnnualRow(
              nextYear,
              category,
              activeAccounts,
              finalizeLookups,
              finalizedAnnualRows,
            ),
          );
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
    ] = [
      // One query at a time on the transaction's connection.
      await tx.select().from(schema.appSettings),
      await tx.select().from(schema.mortgageLoans),
      await tx
        .select()
        .from(schema.mortgageExtraPayments)
        .orderBy(asc(schema.mortgageExtraPayments.paymentDate)),
      await tx.select().from(schema.homeImprovementItems),
      await tx
        .select()
        .from(schema.propertyTaxes)
        .where(eq(schema.propertyTaxes.year, year)),
    ] as const;

    const yearEndDate = `${year}-12-31`;
    const asOfDate = new Date(yearEndDate);

    const { cash } = await getEffectiveCash(tx, allSettings);
    const otherAssets = await getEffectiveOtherAssets(
      tx,
      allSettings,
      asOfDate,
    );
    // Same addition as buildYearEndHistory's current-year branch
    // (year-end-history.ts) — locks in whatever the live view showed right
    // before finalizing, so the permanently-stored figure doesn't
    // silently drop the debts list or the API-mapped credit cards.
    // Which debts count is judged at Dec 31 (local) of the year being
    // finalized: one paid off since then still belongs to that year.
    const otherLiabilities = (
      await getEffectiveOtherLiabilities(tx, {
        asOf: new Date(year, 11, 31),
      })
    ).total;

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
          activeLoan.propertyValueEstimated ?? activeLoan.propertyValuePurchase,
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
    const yearSalaryRows = await tx
      .select()
      .from(schema.historicalSalaries)
      .where(eq(schema.historicalSalaries.year, year));
    const allPeople = await tx.select().from(schema.people);
    const allJobs = await tx.select().from(schema.jobs);
    const salaryRowByPerson = new Map(
      yearSalaryRows.map((r) => [r.personId, r]),
    );
    const currentYear = ctx.scope.asOf.getFullYear();
    const salaryProfileActiveMap =
      year === currentYear
        ? await loadEffectiveSalaryProfile(tx, null)
        : new Map();
    const { grossIncome, anyIncomeRecorded } = yearGrossIncome(
      year,
      currentYear,
      allPeople,
      allJobs,
      salaryRowByPerson,
      salaryProfileActiveMap,
      ctx.scope.asOf,
    );

    if (allPeople.length > 0 && !anyIncomeRecorded) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `No salary data exists for ${year} yet. Record it on the Historical page (or complete the active Salary Profile's entries for the current year) before finalizing.`,
      });
    }

    // Check if row already exists for this year
    const existingNW = await tx.select().from(schema.netWorthAnnual);
    const existingRow = existingNW.find(
      (r) => calendarYear(r.yearEndDate) === year,
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
    // The closest on each side of Dec 31, then the nearer — portable
    // across PostgreSQL and SQLite (the date arithmetic isn't).
    const [onOrBefore] = await tx
      .select()
      .from(schema.portfolioSnapshots)
      .where(lte(schema.portfolioSnapshots.snapshotDate, yearEndDate))
      .orderBy(desc(schema.portfolioSnapshots.snapshotDate))
      .limit(1);
    const [onOrAfter] = await tx
      .select()
      .from(schema.portfolioSnapshots)
      .where(gte(schema.portfolioSnapshots.snapshotDate, yearEndDate))
      .orderBy(asc(schema.portfolioSnapshots.snapshotDate))
      .limit(1);
    const nearestSnapshot = nearestToYearEnd(yearEndDate, [
      onOrBefore,
      onOrAfter,
    ]);

    const snapAccounts =
      nearestSnapshot.length > 0
        ? await tx
            .select()
            .from(schema.portfolioAccounts)
            .where(
              eq(schema.portfolioAccounts.snapshotId, nearestSnapshot[0]!.id),
            )
        : [];
    const portfolioByTaxLocation = portfolioByTaxLocationFrom(snapAccounts);

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
    return { ok: true, finalizedYear: year, createdYear: nextYear };
  }); // end transaction
}
