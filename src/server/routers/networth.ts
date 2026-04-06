/** Net worth router that aggregates account snapshots, mortgage balances, cash, and other assets into a current and projected net worth summary. */
import { eq, asc, desc, sql, gte, lte, and } from "drizzle-orm";
import { z } from "zod/v4";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import * as schema from "@/lib/db/schema";
import { calculateNetWorth } from "@/lib/calculators/net-worth";
import { accountDisplayName } from "@/lib/utils/format";
import {
  toNumber,
  getSalariesForJobs,
  getAnnualExpensesFromBudget,
  computeMortgageBalance,
  getLatestSnapshot,
  parseAppSettings,
  getEffectiveCash,
  getEffectiveOtherAssets,
  getEffectiveOtherAssetsDetailed,
  getPrimaryPerson,
  groupSnapshotAccounts,
  buildYearEndHistory,
} from "@/server/helpers";
// MS_PER_YEAR removed — yearsWorking no longer computed here (TODO: phase 5 cleanup)
import { getAge } from "@/lib/utils/date";
import type { NetWorthInput } from "@/lib/calculators/types";

export const networthRouter = createTRPCRouter({
  computeSummary: protectedProcedure.query(async ({ ctx }) => {
    const [
      people,
      allJobs,
      mortgageLoans,
      extraPayments,
      settings,
      snapshotData,
      annualExpenses,
      retirementSettingsRows,
      apiConnections,
    ] = await Promise.all([
      ctx.db.select().from(schema.people).orderBy(asc(schema.people.id)),
      ctx.db.select().from(schema.jobs),
      ctx.db.select().from(schema.mortgageLoans),
      ctx.db
        .select()
        .from(schema.mortgageExtraPayments)
        .orderBy(asc(schema.mortgageExtraPayments.paymentDate)),
      ctx.db.select().from(schema.appSettings),
      getLatestSnapshot(ctx.db),
      getAnnualExpensesFromBudget(ctx.db),
      ctx.db.select().from(schema.retirementSettings),
      ctx.db.select().from(schema.apiConnections),
    ]);

    let portfolioTotal = 0;
    let portfolioAccountDetails: {
      institution: string;
      taxType: string;
      accountType: string;
      amount: number;
      ownerPersonId: number | null;
      category: string | null;
      accountLabel: string | null;
      ownershipType: string | null;
    }[] = [];

    if (snapshotData) {
      portfolioTotal = snapshotData.total;

      // Fetch performance accounts for category lookup
      const perfAccounts = await ctx.db
        .select()
        .from(schema.performanceAccounts);
      const perfMap = new Map(perfAccounts.map((p) => [p.id, p]));

      portfolioAccountDetails = snapshotData.accounts.map((a) => {
        const perf = a.performanceAccountId
          ? perfMap.get(a.performanceAccountId)
          : null;
        return {
          institution: a.institution,
          taxType: a.taxType,
          accountType: a.accountType,
          amount: a.amount,
          ownerPersonId: a.ownerPersonId,
          category: perf?.parentCategory ?? null,
          accountLabel: perf ? accountDisplayName(perf) : null,
          ownershipType: perf?.ownershipType ?? null,
        };
      });
    }

    // Current-state values from app_settings (editable, not tied to year-end snapshots)
    const setting = parseAppSettings(settings);
    const {
      cash,
      source: cashSource,
      cacheAgeDays: cashCacheAgeDays,
    } = await getEffectiveCash(ctx.db, settings);
    const otherAssetsResult = await getEffectiveOtherAssetsDetailed(
      ctx.db,
      settings,
    );
    const otherAssets = otherAssetsResult.total;

    // Enrich other-asset items with API sync status (same pattern as assets.ts)
    const { getActiveBudgetApi } = await import("@/lib/budget-api");
    const activeBudgetApi = await getActiveBudgetApi(ctx.db);
    const apiConn = apiConnections.find((c) => c.service === activeBudgetApi);
    const apiMappings = (apiConn?.accountMappings ?? []) as {
      localId?: string;
      localName?: string;
      assetId?: number;
    }[];
    const mappedAssetIds = new Set(
      apiMappings
        .filter(
          (m) =>
            m.assetId != null ||
            (m.localId ?? m.localName ?? "").startsWith("asset:"),
        )
        .map(
          (m) =>
            m.assetId ??
            parseInt((m.localId ?? m.localName ?? "").split(":")[1]!, 10),
        ),
    );
    const otherAssetItems = otherAssetsResult.items.map((item) => ({
      ...item,
      synced: item.id !== null && mappedAssetIds.has(item.id),
    }));
    const otherAssetsSyncSource =
      activeBudgetApi !== "none" ? activeBudgetApi : null;

    const otherLiabilities = setting("current_other_liabilities", 0);
    const homeImprovements = setting("current_home_improvements", 0);

    // Combined salary from all active jobs (using salary_changes)
    const activeJobs = allJobs.filter((j) => !j.endDate);
    const asOfDate = new Date();
    const jobSalaries = await getSalariesForJobs(ctx.db, activeJobs, asOfDate);
    const currentSalary = jobSalaries.reduce(
      (s, js) => s + js.effectiveIncome,
      0,
    );

    // Optionally average salary over past 3 years for wealth metrics
    const useSalaryAverage = setting("use_salary_average_3_year", 0) === 1;
    let combinedSalary = currentSalary;
    if (useSalaryAverage) {
      const yearEndHistory = await buildYearEndHistory(ctx.db);
      const recentYears = yearEndHistory
        .filter((h) => h.grossIncome > 0)
        .sort((a, b) => b.year - a.year)
        .slice(0, 3);
      if (recentYears.length > 0) {
        combinedSalary =
          recentYears.reduce((s, h) => s + h.grossIncome, 0) /
          recentYears.length;
      }
    }

    // Primary user for age calculation
    const primaryPerson = getPrimaryPerson(people);
    const age = primaryPerson
      ? getAge(new Date(primaryPerson.dateOfBirth), asOfDate)
      : 0;

    // Home values: market (estimated) and cost basis (purchase + improvements)
    const activeLoans = mortgageLoans.filter((m) => m.isActive);
    const activeMortgage = activeLoans[0];
    const homeValueEstimated = activeMortgage
      ? toNumber(
          activeMortgage.propertyValueEstimated ??
            activeMortgage.propertyValuePurchase,
        )
      : 0;
    const homeValuePurchase = activeMortgage
      ? toNumber(activeMortgage.propertyValuePurchase)
      : 0;
    const homeValueConservative = homeValuePurchase + homeImprovements;

    const mortgageBalance = computeMortgageBalance(
      mortgageLoans,
      extraPayments,
      asOfDate,
    );

    // Withdrawal rate from retirement_settings (primary user's settings)
    const primaryRetSettings =
      retirementSettingsRows.find((rs) => rs.personId === primaryPerson?.id) ??
      retirementSettingsRows[0];
    if (!primaryRetSettings) {
      throw new Error(
        "No retirement settings found. Configure withdrawal rate in retirement settings.",
      );
    }
    const withdrawalRate = toNumber(primaryRetSettings.withdrawalRate);

    // TODO(phase5): Replace with buildYearEndHistory() read
    const input: NetWorthInput = {
      portfolioTotal,
      cash,
      homeValueEstimated,
      homeValueConservative,
      otherAssets,
      mortgageBalance,
      otherLiabilities,
      averageAge: age,
      effectiveIncome: combinedSalary,
      lifetimeEarnings: combinedSalary * age, // approximate until phase 5
      annualExpenses,
      withdrawalRate,
      asOfDate,
    };

    const result = calculateNetWorth(input);

    // Performance last-updated timestamp from app_settings
    const perfUpdatedSetting = await ctx.db
      .select()
      .from(schema.appSettings)
      .where(eq(schema.appSettings.key, "performance_last_updated"));
    const performanceLastUpdated =
      (perfUpdatedSetting[0]?.value as string) ?? null;

    // Latest annual performance year (most recent year with data)
    const latestAnnualRow = await ctx.db
      .select({ year: schema.annualPerformance.year })
      .from(schema.annualPerformance)
      .orderBy(desc(schema.annualPerformance.year))
      .limit(1);
    const latestPerformanceYear = latestAnnualRow[0]?.year ?? null;

    return {
      result,
      snapshotDate: snapshotData?.snapshot.snapshotDate ?? null,
      performanceLastUpdated,
      latestPerformanceYear,
      portfolioTotal,
      portfolioAccounts: portfolioAccountDetails,
      people: people.map((p) => ({ id: p.id, name: p.name })),
      hasHouse: !!activeMortgage,
      homeValueEstimated,
      homeValueConservative,
      mortgageBalance,
      cash,
      cashSource,
      cashCacheAgeDays,
      otherAssets,
      otherAssetItems,
      otherAssetsSyncSource,
      otherLiabilities,
      withdrawalRate,
    };
  }),

  listHistory: protectedProcedure.query(async ({ ctx }) => {
    const [yearEndHistory, people, mortgageLoansAll] = await Promise.all([
      buildYearEndHistory(ctx.db),
      ctx.db.select().from(schema.people).orderBy(asc(schema.people.id)),
      ctx.db.select().from(schema.mortgageLoans),
    ]);

    const primaryPerson = getPrimaryPerson(people);
    const primaryBirthYear = primaryPerson
      ? new Date(primaryPerson.dateOfBirth).getFullYear()
      : null;

    // Purchase price for cost basis: use earliest mortgage (or active) as the property
    const activeMortgageForHistory =
      mortgageLoansAll.find((m) => m.isActive) ?? mortgageLoansAll[0];
    const purchasePrice = activeMortgageForHistory
      ? toNumber(activeMortgageForHistory.propertyValuePurchase)
      : 0;

    // Derive cost-basis and totals from shared year-end rows
    const history = yearEndHistory.map((row) => {
      const totalLiabilities = row.mortgageBalance + row.otherLiabilities;
      const totalAssets =
        row.portfolioTotal + row.cash + row.houseValue + row.otherAssets;
      const houseValueCostBasis =
        row.houseValue > 0 ? purchasePrice + row.homeImprovements : 0;
      const totalAssetsCB =
        row.portfolioTotal + row.cash + houseValueCostBasis + row.otherAssets;

      return {
        year: row.year,
        netWorth: row.netWorth,
        netWorthCostBasis: totalAssetsCB - totalLiabilities,
        portfolioTotal: row.portfolioTotal,
        portfolioByType: row.portfolioByType,
        cash: row.cash,
        houseValue: row.houseValue,
        houseValueCostBasis,
        mortgageBalance: row.mortgageBalance,
        otherAssets: row.otherAssets,
        otherLiabilities: row.otherLiabilities,
        totalAssets,
        totalLiabilities,
        grossIncome: row.grossIncome,
        combinedAgi: row.combinedAgi,
        effectiveTaxRate: row.effectiveTaxRate ?? 0,
        taxesPaid: row.taxesPaid ?? 0,
        isCurrent: row.isCurrent,
      };
    });

    return { years: history, primaryBirthYear };
  }),

  /** Extended history with per-category performance breakdowns and tax location data.
   *  Used by the spreadsheet view; heavier than listHistory (which feeds charts). */
  computeDetailedHistory: protectedProcedure.query(async ({ ctx }) => {
    const [yearEndHistory, people, mortgageLoansAll] = await Promise.all([
      buildYearEndHistory(ctx.db),
      ctx.db.select().from(schema.people).orderBy(asc(schema.people.id)),
      ctx.db.select().from(schema.mortgageLoans),
    ]);

    const primaryPerson = getPrimaryPerson(people);
    const primaryBirthYear = primaryPerson
      ? new Date(primaryPerson.dateOfBirth).getFullYear()
      : null;

    const activeMortgageForHistory =
      mortgageLoansAll.find((m) => m.isActive) ?? mortgageLoansAll[0];
    const purchasePrice = activeMortgageForHistory
      ? toNumber(activeMortgageForHistory.propertyValuePurchase)
      : 0;

    const history = yearEndHistory.map((row) => {
      const totalLiabilities = row.mortgageBalance + row.otherLiabilities;
      const totalAssets =
        row.portfolioTotal + row.cash + row.houseValue + row.otherAssets;
      const houseValueCostBasis =
        row.houseValue > 0 ? purchasePrice + row.homeImprovements : 0;
      const totalAssetsCB =
        row.portfolioTotal + row.cash + houseValueCostBasis + row.otherAssets;

      return {
        year: row.year,
        netWorth: row.netWorth,
        netWorthCostBasis: totalAssetsCB - totalLiabilities,
        portfolioTotal: row.portfolioTotal,
        portfolioByType: row.portfolioByType,
        cash: row.cash,
        houseValue: row.houseValue,
        houseValueCostBasis,
        mortgageBalance: row.mortgageBalance,
        otherAssets: row.otherAssets,
        otherLiabilities: row.otherLiabilities,
        totalAssets,
        totalLiabilities,
        grossIncome: row.grossIncome,
        isCurrent: row.isCurrent,
        combinedAgi: row.combinedAgi,
        perfLastUpdated: row.perfLastUpdated,
        perfContributions: row.perfContributions,
        perfGainLoss: row.perfGainLoss,
        performanceByCategory: row.performanceByCategory,
        portfolioByTaxLocation: row.portfolioByTaxLocation,
      };
    });

    // All people's birth years for average age computation (spreadsheet uses avg of all)
    const birthYears = people.map((p) => new Date(p.dateOfBirth).getFullYear());

    return { years: history, primaryBirthYear, birthYears };
  }),

  /** Paginated snapshot list with optional date range filter and sorting. */
  listSnapshots: protectedProcedure
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(1000).default(52),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        sortCol: z
          .enum(["date", "total", "accounts", "change", "changePct"])
          .optional(),
        sortDir: z.enum(["asc", "desc"]).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { page, pageSize, dateFrom, dateTo, sortCol, sortDir } = input;

      // Build WHERE conditions for date range
      const conditions = [];
      if (dateFrom) {
        conditions.push(gte(schema.portfolioSnapshots.snapshotDate, dateFrom));
      }
      if (dateTo) {
        conditions.push(lte(schema.portfolioSnapshots.snapshotDate, dateTo));
      }
      const whereClause =
        conditions.length > 0 ? and(...conditions) : undefined;

      // 1. Fetch ALL matching snapshots with totals (lightweight — for delta + sort)
      const allSnapsQuery = ctx.db
        .select({
          id: schema.portfolioSnapshots.id,
          snapshotDate: schema.portfolioSnapshots.snapshotDate,
          notes: schema.portfolioSnapshots.notes,
          total: sql<string>`coalesce(sum(${schema.portfolioAccounts.amount}), 0)`,
          accountCount: sql<number>`count(${schema.portfolioAccounts.id})`,
        })
        .from(schema.portfolioSnapshots)
        .leftJoin(
          schema.portfolioAccounts,
          eq(schema.portfolioSnapshots.id, schema.portfolioAccounts.snapshotId),
        )
        .groupBy(schema.portfolioSnapshots.id);
      const allSnaps = whereClause
        ? await allSnapsQuery.where(whereClause)
        : await allSnapsQuery;

      const totalCount = allSnaps.length;
      if (totalCount === 0) {
        return {
          snapshots: [],
          totalCount: 0,
          page,
          pageSize,
          totalPages: 0,
        };
      }

      // 2. Compute delta and deltaPct across the full sorted-by-date dataset
      const byDate = [...allSnaps].sort((a, b) =>
        a.snapshotDate.localeCompare(b.snapshotDate),
      );
      const deltaMap = new Map<
        number,
        {
          delta: number | null;
          deltaPct: number | null;
          daysSincePrev: number | null;
        }
      >();
      for (let i = 0; i < byDate.length; i++) {
        const curr = toNumber(byDate[i]!.total);
        const prev = i > 0 ? toNumber(byDate[i - 1]!.total) : null;
        const delta = prev != null ? curr - prev : null;
        const deltaPct =
          prev != null && prev > 0 ? ((curr - prev) / prev) * 100 : null;
        const daysSincePrev =
          i > 0
            ? Math.round(
                (new Date(byDate[i]!.snapshotDate).getTime() -
                  new Date(byDate[i - 1]!.snapshotDate).getTime()) /
                  86400000,
              )
            : null;
        deltaMap.set(byDate[i]!.id, { delta, deltaPct, daysSincePrev });
      }

      // 3. Build sortable items and sort by requested column
      type SnapItem = (typeof allSnaps)[number] & {
        totalNum: number;
        delta: number | null;
        deltaPct: number | null;
        daysSincePrev: number | null;
      };
      const sortable: SnapItem[] = allSnaps.map((s) => ({
        ...s,
        totalNum: toNumber(s.total),
        ...(deltaMap.get(s.id) ?? {
          delta: null,
          deltaPct: null,
          daysSincePrev: null,
        }),
      }));

      const dir = sortDir === "asc" ? 1 : -1;
      if (sortCol) {
        sortable.sort((a, b) => {
          let cmp = 0;
          switch (sortCol) {
            case "date":
              cmp = a.snapshotDate.localeCompare(b.snapshotDate);
              break;
            case "total":
              cmp = a.totalNum - b.totalNum;
              break;
            case "accounts":
              cmp = Number(a.accountCount) - Number(b.accountCount);
              break;
            case "change":
              cmp = (a.delta ?? 0) - (b.delta ?? 0);
              break;
            case "changePct":
              cmp = (a.deltaPct ?? 0) - (b.deltaPct ?? 0);
              break;
          }
          return cmp * dir;
        });
      } else {
        // Default: newest first
        sortable.sort((a, b) => b.snapshotDate.localeCompare(a.snapshotDate));
      }

      // 4. Paginate
      const offset = (page - 1) * pageSize;
      const pageSnaps = sortable.slice(offset, offset + pageSize);
      if (pageSnaps.length === 0) {
        return {
          snapshots: [],
          totalCount,
          page,
          pageSize,
          totalPages: Math.ceil(totalCount / pageSize),
        };
      }

      // 5. Batch-load detailed accounts only for the page
      const snapshotIds = pageSnaps.map((s) => s.id);
      const allAccounts = await ctx.db
        .select({
          snapshotId: schema.portfolioAccounts.snapshotId,
          institution: schema.portfolioAccounts.institution,
          taxType: schema.portfolioAccounts.taxType,
          accountType: schema.portfolioAccounts.accountType,
          subType: schema.portfolioAccounts.subType,
          amount: schema.portfolioAccounts.amount,
          ownerPersonId: schema.portfolioAccounts.ownerPersonId,
          performanceAccountId: schema.portfolioAccounts.performanceAccountId,
          ownerName: schema.people.name,
          perfAccountLabel: schema.performanceAccounts.accountLabel,
          perfDisplayName: schema.performanceAccounts.displayName,
          perfAccountType: schema.performanceAccounts.accountType,
          perfOwnerPersonId: schema.performanceAccounts.ownerPersonId,
        })
        .from(schema.portfolioAccounts)
        .leftJoin(
          schema.performanceAccounts,
          eq(
            schema.portfolioAccounts.performanceAccountId,
            schema.performanceAccounts.id,
          ),
        )
        .leftJoin(
          schema.people,
          eq(schema.portfolioAccounts.ownerPersonId, schema.people.id),
        )
        .where(
          sql`${schema.portfolioAccounts.snapshotId} IN (${sql.join(
            snapshotIds.map((id) => sql`${id}`),
            sql`, `,
          )})`,
        );

      const accountsBySnapshot = groupSnapshotAccounts(allAccounts);

      const items = pageSnaps.map((s) => {
        const accounts = accountsBySnapshot.get(s.id) ?? [];
        return {
          id: s.id,
          snapshotDate: s.snapshotDate,
          notes: s.notes,
          total: s.totalNum,
          accountCount: Number(s.accountCount),
          delta: s.delta,
          deltaPct: s.deltaPct,
          daysSincePrev: s.daysSincePrev,
          accounts: accounts.map((a) => ({
            institution: a.institution,
            taxType: a.taxType,
            accountType: a.accountType,
            subType: a.subType,
            amount: toNumber(a.amount),
            ownerPersonId: a.ownerPersonId,
            ownerName: a.ownerName,
            performanceAccountId: a.performanceAccountId,
            perfAccountLabel: a.perfAccountLabel,
            perfDisplayName: a.perfDisplayName,
            perfAccountType: a.perfAccountType,
            perfOwnerPersonId: a.perfOwnerPersonId,
          })),
        };
      });

      return {
        snapshots: items,
        totalCount,
        page,
        pageSize,
        totalPages: Math.ceil(totalCount / pageSize),
      };
    }),

  /** Lightweight snapshot totals for portfolio chart — returns (date, total) pairs. */
  listSnapshotTotals: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        snapshotDate: schema.portfolioSnapshots.snapshotDate,
        snapshotId: schema.portfolioSnapshots.id,
      })
      .from(schema.portfolioSnapshots)
      .orderBy(asc(schema.portfolioSnapshots.snapshotDate));

    if (rows.length === 0) return [];

    // Batch sum accounts per snapshot
    const totals = await ctx.db
      .select({
        snapshotId: schema.portfolioAccounts.snapshotId,
        total: sql<string>`sum(${schema.portfolioAccounts.amount})`,
      })
      .from(schema.portfolioAccounts)
      .groupBy(schema.portfolioAccounts.snapshotId);

    const totalMap = new Map(
      totals.map((t) => [t.snapshotId, toNumber(t.total)]),
    );

    return rows.map((r) => ({
      id: r.snapshotId,
      date: r.snapshotDate,
      total: totalMap.get(r.snapshotId) ?? 0,
    }));
  }),

  computeFIProgress: protectedProcedure.query(async ({ ctx }) => {
    const [snapshotData, annualExpenses, retirementSettingsRows, settings] =
      await Promise.all([
        getLatestSnapshot(ctx.db),
        getAnnualExpensesFromBudget(ctx.db),
        ctx.db.select().from(schema.retirementSettings),
        ctx.db.select().from(schema.appSettings),
      ]);

    const portfolioTotal = snapshotData?.total ?? 0;
    const { cash } = await getEffectiveCash(ctx.db, settings);

    const retSettings = retirementSettingsRows[0];
    if (!retSettings) {
      throw new Error(
        "No retirement settings found. Configure withdrawal rate in retirement settings.",
      );
    }

    // TODO(phase6): Replace with buildYearEndHistory() read
    const input: NetWorthInput = {
      portfolioTotal,
      cash,
      homeValueEstimated: 0,
      homeValueConservative: 0,
      otherAssets: 0,
      mortgageBalance: 0,
      otherLiabilities: 0,
      averageAge: 0,
      effectiveIncome: 0,
      lifetimeEarnings: 0,
      annualExpenses,
      withdrawalRate: toNumber(retSettings.withdrawalRate),
      asOfDate: new Date(),
    };

    const result = calculateNetWorth(input);
    return {
      fiProgress: result.fiProgress,
      fiTarget: result.fiTarget,
      currentPortfolio: portfolioTotal,
      cash,
    };
  }),

  /**
   * Compare net worth at two dates.
   * Uses nearest portfolio snapshot for investment values, computes mortgage
   * balance at each date, and uses current values for home/cash/other (noted as limitation).
   */
  computeComparison: protectedProcedure
    .input(
      z.object({
        dateFrom: z.string(), // YYYY-MM-DD
        dateTo: z.string(), // YYYY-MM-DD
        useMarketValue: z.boolean().optional().default(true),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { dateFrom, dateTo, useMarketValue } = input;

      // Fetch shared data needed for both dates
      const [mortgageLoans, extraPayments, settings, allSnapshots] =
        await Promise.all([
          ctx.db.select().from(schema.mortgageLoans),
          ctx.db
            .select()
            .from(schema.mortgageExtraPayments)
            .orderBy(asc(schema.mortgageExtraPayments.paymentDate)),
          ctx.db.select().from(schema.appSettings),
          ctx.db
            .select()
            .from(schema.portfolioSnapshots)
            .orderBy(asc(schema.portfolioSnapshots.snapshotDate)),
        ]);

      const setting = parseAppSettings(settings);
      const homeImprovements = setting("current_home_improvements", 0);
      const homeValue = (() => {
        const activeLoans = mortgageLoans.filter((m) => m.isActive);
        const activeMortgage = activeLoans[0];
        if (!activeMortgage) return 0;
        if (useMarketValue) {
          return toNumber(
            activeMortgage.propertyValueEstimated ??
              activeMortgage.propertyValuePurchase,
          );
        }
        return (
          toNumber(activeMortgage.propertyValuePurchase) + homeImprovements
        );
      })();
      const { cash } = await getEffectiveCash(ctx.db, settings);
      const otherAssets = await getEffectiveOtherAssets(ctx.db, settings);
      const otherLiabilities = setting("current_other_liabilities", 0);

      // Find nearest snapshot to a target date
      async function getSnapshotAtDate(targetDate: string) {
        if (allSnapshots.length === 0) {
          return {
            total: 0,
            byTaxType: {} as Record<string, number>,
            snapshotDate: null,
          };
        }

        // Find closest snapshot by absolute date distance
        let closest = allSnapshots[0]!;
        let closestDist = Math.abs(
          new Date(closest.snapshotDate).getTime() -
            new Date(targetDate).getTime(),
        );
        for (const s of allSnapshots) {
          const dist = Math.abs(
            new Date(s.snapshotDate).getTime() - new Date(targetDate).getTime(),
          );
          if (dist < closestDist) {
            closest = s;
            closestDist = dist;
          }
        }

        // Load accounts for this snapshot
        const accounts = await ctx.db
          .select()
          .from(schema.portfolioAccounts)
          .where(eq(schema.portfolioAccounts.snapshotId, closest.id));

        const total = accounts.reduce((s, a) => s + toNumber(a.amount), 0);
        const byTaxType: Record<string, number> = {};
        for (const a of accounts) {
          const key = a.taxType;
          byTaxType[key] = (byTaxType[key] ?? 0) + toNumber(a.amount);
        }

        return { total, byTaxType, snapshotDate: closest.snapshotDate };
      }

      const [fromSnapshot, toSnapshot] = await Promise.all([
        getSnapshotAtDate(dateFrom),
        getSnapshotAtDate(dateTo),
      ]);

      // Compute mortgage balance at each date
      const mortgageFrom = computeMortgageBalance(
        mortgageLoans,
        extraPayments,
        new Date(dateFrom + "T00:00:00"),
      );
      const mortgageTo = computeMortgageBalance(
        mortgageLoans,
        extraPayments,
        new Date(dateTo + "T00:00:00"),
      );

      // Build category breakdown
      // Categories: portfolio (by tax type), home equity, cash, other assets, mortgage, other liabilities
      type DatePoint = {
        date: string;
        snapshotDate: string | null;
        portfolioTotal: number;
        portfolioByTaxType: Record<string, number>;
        homeValue: number;
        cash: number;
        otherAssets: number;
        mortgageBalance: number;
        otherLiabilities: number;
        netWorth: number;
      };

      function buildPoint(
        date: string,
        snapshot: {
          total: number;
          byTaxType: Record<string, number>;
          snapshotDate: string | null;
        },
        mortgage: number,
      ): DatePoint {
        const nw =
          snapshot.total +
          homeValue +
          cash +
          otherAssets -
          mortgage -
          otherLiabilities;
        return {
          date,
          snapshotDate: snapshot.snapshotDate,
          portfolioTotal: snapshot.total,
          portfolioByTaxType: snapshot.byTaxType,
          homeValue,
          cash,
          otherAssets,
          mortgageBalance: mortgage,
          otherLiabilities,
          netWorth: nw,
        };
      }

      const from = buildPoint(dateFrom, fromSnapshot, mortgageFrom);
      const to = buildPoint(dateTo, toSnapshot, mortgageTo);

      const absoluteChange = to.netWorth - from.netWorth;
      const percentChange =
        from.netWorth !== 0 ? absoluteChange / Math.abs(from.netWorth) : 0;

      // Per-category deltas
      const categories = [
        {
          label: "Investment Portfolio",
          from: from.portfolioTotal,
          to: to.portfolioTotal,
        },
        { label: "Home Value", from: from.homeValue, to: to.homeValue },
        { label: "Cash", from: from.cash, to: to.cash },
        { label: "Other Assets", from: from.otherAssets, to: to.otherAssets },
        {
          label: "Mortgage",
          from: -from.mortgageBalance,
          to: -to.mortgageBalance,
        },
        {
          label: "Other Liabilities",
          from: -from.otherLiabilities,
          to: -to.otherLiabilities,
        },
      ];

      // Portfolio sub-categories by tax type
      const allTaxTypes = new Set([
        ...Object.keys(from.portfolioByTaxType),
        ...Object.keys(to.portfolioByTaxType),
      ]);
      const portfolioBreakdown = Array.from(allTaxTypes).map((taxType) => ({
        label: taxType,
        from: from.portfolioByTaxType[taxType] ?? 0,
        to: to.portfolioByTaxType[taxType] ?? 0,
        delta:
          (to.portfolioByTaxType[taxType] ?? 0) -
          (from.portfolioByTaxType[taxType] ?? 0),
      }));

      return {
        from,
        to,
        absoluteChange,
        percentChange,
        categories: categories.map((c) => ({
          ...c,
          delta: c.to - c.from,
        })),
        portfolioBreakdown,
        limitations: [
          "Home value, cash, and other assets/liabilities use current values for both dates (historical values not tracked).",
          "Portfolio values use the nearest available weekly snapshot.",
        ],
      };
    }),
});
