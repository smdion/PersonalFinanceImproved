/** Sync core router handling full data synchronization, sync preview generation, and expense comparison between budget API and local data. */

import { z } from "zod/v4";
import { eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  createTRPCRouter,
  protectedProcedure,
  syncProcedure,
  expensiveRateLimitMiddleware,
} from "../trpc";
import * as schema from "@/lib/db/schema";
import { log } from "@/lib/logger";
import {
  getClientForService,
  getActiveBudgetApi,
  getApiConnection,
  cacheGet,
  cacheSet,
  YNAB_EXPENSE_EXCLUDED_CATEGORIES,
} from "@/lib/budget-api";
import type {
  BudgetApiService,
  BudgetAccount,
  BudgetCategoryGroup,
  BudgetMonthDetail,
  BudgetTransaction,
} from "@/lib/budget-api";
import { parseAppSettings, buildMortgageInputs } from "@/server/helpers";
import { calculateMortgage } from "@/lib/calculators/mortgage";
import { accountDisplayName } from "@/lib/utils/format";

const serviceEnum = z.enum(["ynab", "actual"]);

export const syncCoreRouter = createTRPCRouter({
  /**
   * Full sync for a specific service — works independently of active_budget_api.
   * Pulls accounts, categories, current month, and transactions into cache.
   */
  syncAll: syncProcedure
    .use(expensiveRateLimitMiddleware)
    .input(z.object({ service: serviceEnum }))
    .mutation(async ({ ctx, input }) => {
      const client = await getClientForService(ctx.db, input.service);
      if (!client) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `No ${input.service} connection configured`,
        });
      }

      const service = input.service as BudgetApiService;

      try {
        const [accounts, categories] = await Promise.all([
          client.getAccounts(),
          client.getCategories(),
        ]);

        const now = new Date();
        const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
        const monthDetail = await client.getMonthDetail(currentMonth);

        const sinceDate = `${now.getFullYear() - 1}-01-01`;
        const transactions = await client.getTransactions(sinceDate);

        await Promise.all([
          cacheSet(ctx.db, service, "accounts", accounts),
          cacheSet(ctx.db, service, "categories", categories),
          cacheSet(ctx.db, service, `months/${currentMonth}`, monthDetail),
          cacheSet(ctx.db, service, "transactions", transactions),
        ]);

        await ctx.db
          .update(schema.apiConnections)
          .set({ lastSyncedAt: new Date() })
          .where(eq(schema.apiConnections.service, service));

        // Auto-pull asset values from tracking accounts if pull mappings exist
        let assetsPulled = 0;
        try {
          const conn = await getApiConnection(ctx.db, service);
          const mappings = conn?.accountMappings ?? [];
          const pullMappings = mappings.filter(
            (m) => m.syncDirection === "pull" || m.syncDirection === "both",
          );
          if (pullMappings.length > 0) {
            const apiBalanceMap = new Map<string, number>();
            for (const a of accounts) apiBalanceMap.set(a.id, a.balance);

            const currentYear = new Date().getFullYear();
            for (const mapping of pullMappings) {
              const apiBalance = apiBalanceMap.get(mapping.remoteAccountId);
              if (apiBalance === undefined) continue;

              // Resolve by localId prefix
              const localId = mapping.localId ?? mapping.localName; // backward compat: fall back to localName during migration
              // Prefer typed fields; fall back to prefix parsing for legacy mappings
              if (mapping.loanId || localId.startsWith("mortgage:")) {
                const loanId = mapping.loanId ?? Number(localId.split(":")[1]);
                const mapType = mapping.loanMapType ?? localId.split(":")[2]; // 'propertyValue' or 'loanBalance'
                if (mapType === "propertyValue") {
                  await ctx.db
                    .update(schema.mortgageLoans)
                    .set({
                      propertyValueEstimated: String(apiBalance),
                      usePurchaseOrEstimated: "estimated",
                    })
                    .where(eq(schema.mortgageLoans.id, loanId));
                }
                if (mapType === "loanBalance") {
                  await ctx.db
                    .update(schema.mortgageLoans)
                    .set({
                      apiBalance: String(Math.abs(apiBalance)),
                      apiBalanceDate: new Date().toISOString().slice(0, 10),
                    })
                    .where(eq(schema.mortgageLoans.id, loanId));
                }
                assetsPulled++;
                continue;
              }

              if (mapping.assetId != null || localId.startsWith("asset:")) {
                // Resolve asset by ID → get current name → upsert by name+year
                const assetId =
                  mapping.assetId ?? parseInt(localId.split(":")[1]!, 10);
                const assetRow = await ctx.db
                  .select()
                  .from(schema.otherAssetItems)
                  .where(eq(schema.otherAssetItems.id, assetId))
                  .then((r) => r[0]);
                if (assetRow) {
                  const existing = await ctx.db
                    .select()
                    .from(schema.otherAssetItems)
                    .where(eq(schema.otherAssetItems.name, assetRow.name))
                    .then((rows) => rows.find((r) => r.year === currentYear));
                  if (existing) {
                    await ctx.db
                      .update(schema.otherAssetItems)
                      .set({
                        value: String(apiBalance),
                        note: `Synced from ${service.toUpperCase()}`,
                      })
                      .where(eq(schema.otherAssetItems.id, existing.id));
                  } else {
                    await ctx.db.insert(schema.otherAssetItems).values({
                      name: assetRow.name,
                      year: currentYear,
                      value: String(apiBalance),
                      note: `Synced from ${service.toUpperCase()}`,
                    });
                  }
                }
                assetsPulled++;
                continue;
              }

              // Fallback for unmigrated mappings (localName-based resolution)
              const existing = await ctx.db
                .select()
                .from(schema.otherAssetItems)
                .where(eq(schema.otherAssetItems.name, mapping.localName))
                .then((rows) => rows.find((r) => r.year === currentYear));
              if (existing) {
                await ctx.db
                  .update(schema.otherAssetItems)
                  .set({
                    value: String(apiBalance),
                    note: `Synced from ${service.toUpperCase()}`,
                  })
                  .where(eq(schema.otherAssetItems.id, existing.id));
              } else {
                await ctx.db.insert(schema.otherAssetItems).values({
                  name: mapping.localName,
                  year: currentYear,
                  value: String(apiBalance),
                  note: `Synced from ${service.toUpperCase()}`,
                });
              }
              assetsPulled++;
            }
          }
        } catch (err) {
          log("warn", "asset_pull_failed", {
            error: err instanceof Error ? err.message : String(err),
          });
        }

        return {
          success: true,
          counts: {
            accounts: accounts.length,
            categories: categories.reduce(
              (sum, g) => sum + g.categories.length,
              0,
            ),
            transactions: transactions.length,
            assetsPulled,
          },
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Unknown error";
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Sync failed: ${msg.slice(0, 200)}`,
        });
      }
    }),

  /**
   * Preview: read cached data for a service and compare against current manual values.
   * Works before activation — shows what will change when the API is activated.
   */
  getPreview: protectedProcedure
    .input(z.object({ service: serviceEnum }))
    .query(async ({ ctx, input }) => {
      const service = input.service as BudgetApiService;

      const now = new Date();
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

      const currentYear = now.getFullYear();
      const [
        accountsCache,
        categoriesCache,
        monthCache,
        conn,
        settings,
        allProfiles,
        savingsGoalRows,
        latestSnapshot,
        assetItems,
        activeMortgageLoans,
        mortgageExtraPayments,
      ] = await Promise.all([
        cacheGet<BudgetAccount[]>(ctx.db, service, "accounts"),
        cacheGet<BudgetCategoryGroup[]>(ctx.db, service, "categories"),
        cacheGet<BudgetMonthDetail>(ctx.db, service, `months/${currentMonth}`),
        getApiConnection(ctx.db, service),
        ctx.db.select().from(schema.appSettings),
        ctx.db.select().from(schema.budgetProfiles),
        ctx.db.select().from(schema.savingsGoals),
        ctx.db
          .select()
          .from(schema.portfolioSnapshots)
          .orderBy(sql`${schema.portfolioSnapshots.snapshotDate} DESC`)
          .limit(1)
          .then((r) => r[0] ?? null),
        ctx.db.select().from(schema.otherAssetItems),
        ctx.db
          .select()
          .from(schema.mortgageLoans)
          .where(eq(schema.mortgageLoans.isActive, true)),
        ctx.db.select().from(schema.mortgageExtraPayments),
      ]);

      if (!accountsCache || !conn) {
        return { synced: false } as const;
      }

      const accounts = accountsCache.data;
      const categoryGroups = categoriesCache?.data ?? [];

      // Compute what cash would be under API control
      const cashTypes = new Set(["checking", "savings", "cash"]);
      const onBudgetCashAccounts = accounts.filter(
        (a) => a.onBudget && !a.closed && cashTypes.has(a.type),
      );
      const apiCash = onBudgetCashAccounts.reduce(
        (sum, a) => sum + a.balance,
        0,
      );

      // Current manual cash for comparison
      const setting = parseAppSettings(settings);
      const manualCash = setting("current_cash", 0);

      // Summarize accounts by type
      const accountsByType: Record<string, { count: number; balance: number }> =
        {};
      for (const a of accounts) {
        if (a.closed) continue;
        const entry = accountsByType[a.type] ?? { count: 0, balance: 0 };
        entry.count++;
        entry.balance += a.balance;
        accountsByType[a.type] = entry;
      }

      // Count categories
      const totalCategories = categoryGroups.reduce(
        (sum, g) => sum + g.categories.filter((c) => !c.hidden).length,
        0,
      );

      // -- Budget item matching --
      // Build a flat list of non-hidden API categories with their budgeted/activity/balance
      const monthCategories = monthCache?.data?.categories ?? [];
      const monthMap = new Map(monthCategories.map((c) => [c.id, c]));

      const apiCats: Array<{
        id: string;
        name: string;
        groupName: string;
        budgeted: number;
        activity: number;
        balance: number;
      }> = [];
      for (const g of categoryGroups) {
        if (g.hidden) continue;
        for (const c of g.categories) {
          if (c.hidden) continue;
          const m = monthMap.get(c.id);
          apiCats.push({
            id: c.id,
            name: c.name,
            groupName: g.name,
            budgeted: m?.budgeted ?? 0,
            activity: m?.activity ?? 0,
            balance: m?.balance ?? 0,
          });
        }
      }

      // Normalize name for fuzzy matching: strip non-alpha chars (emoji, parens, symbols), lowercase, trim
      const normalize = (s: string) =>
        s
          .replace(/\(.*?\)/g, "")
          .replace(/[^a-zA-Z0-9 ]/g, "")
          .trim()
          .toLowerCase()
          .replace(/\s+/g, " ");

      // Get budget items for linked profile (or fall back to active profile)
      const linkedProfile = conn.linkedProfileId
        ? allProfiles.find((p) => p.id === conn.linkedProfileId)
        : allProfiles.find((p) => p.isActive);
      const activeProfile =
        linkedProfile ?? allProfiles.find((p) => p.isActive);
      let budgetItemRows: Array<{
        id: number;
        category: string;
        subcategory: string;
        amounts: number[];
        apiCategoryId: string | null;
        apiCategoryName: string | null;
        apiSyncDirection: "pull" | "push" | "both" | null;
        contributionAccountId: number | null;
      }> = [];
      if (activeProfile) {
        budgetItemRows = await ctx.db
          .select({
            id: schema.budgetItems.id,
            category: schema.budgetItems.category,
            subcategory: schema.budgetItems.subcategory,
            amounts: schema.budgetItems.amounts,
            apiCategoryId: schema.budgetItems.apiCategoryId,
            apiCategoryName: schema.budgetItems.apiCategoryName,
            apiSyncDirection: schema.budgetItems.apiSyncDirection,
            contributionAccountId: schema.budgetItems.contributionAccountId,
          })
          .from(schema.budgetItems)
          .where(eq(schema.budgetItems.profileId, activeProfile.id));
      }

      // Determine which budget column to use (linked or active)
      const colIndex = conn.linkedColumnIndex ?? 0;

      // Match each budget item to API categories
      type BudgetMatch = {
        budgetItemId: number;
        ledgrName: string;
        ledgrCategory: string;
        ledgrAmount: number;
        status: "linked" | "suggested" | "unmatched";
        apiCategoryId: string | null;
        apiCategoryName: string | null;
        apiGroupName: string | null;
        apiBudgeted: number | null;
        apiActivity: number | null;
        syncDirection: "pull" | "push" | "both" | null;
        nameDrifted?: boolean;
        categoryDrifted?: boolean;
        contributionAccountId: number | null;
      };

      const usedApiIds = new Set<string>();
      const budgetMatches: BudgetMatch[] = [];

      // First pass: already linked items
      for (const item of budgetItemRows) {
        if (item.apiCategoryId) {
          const apiCat = apiCats.find((c) => c.id === item.apiCategoryId);
          usedApiIds.add(item.apiCategoryId);
          const currentApiName = apiCat?.name ?? item.apiCategoryName;
          budgetMatches.push({
            budgetItemId: item.id,
            ledgrName: item.subcategory,
            ledgrCategory: item.category,
            ledgrAmount: item.amounts[colIndex] ?? 0,
            status: "linked",
            apiCategoryId: item.apiCategoryId,
            apiCategoryName: currentApiName,
            apiGroupName: apiCat?.groupName ?? null,
            apiBudgeted: apiCat?.budgeted ?? null,
            apiActivity: apiCat?.activity ?? null,
            syncDirection: item.apiSyncDirection,
            nameDrifted:
              currentApiName != null && item.subcategory !== currentApiName,
            categoryDrifted:
              apiCat?.groupName != null && item.category !== apiCat.groupName,
            contributionAccountId: item.contributionAccountId,
          });
        }
      }

      // Second pass: fuzzy match unlinked items
      for (const item of budgetItemRows) {
        if (item.apiCategoryId) continue;
        const normSub = normalize(item.subcategory);
        const match = apiCats.find(
          (c) => !usedApiIds.has(c.id) && normalize(c.name) === normSub,
        );
        if (match) {
          usedApiIds.add(match.id);
          budgetMatches.push({
            budgetItemId: item.id,
            ledgrName: item.subcategory,
            ledgrCategory: item.category,
            ledgrAmount: item.amounts[colIndex] ?? 0,
            status: "suggested",
            apiCategoryId: match.id,
            apiCategoryName: match.name,
            apiGroupName: match.groupName,
            apiBudgeted: match.budgeted,
            apiActivity: match.activity,
            syncDirection: null,
            contributionAccountId: item.contributionAccountId,
          });
        } else {
          budgetMatches.push({
            budgetItemId: item.id,
            ledgrName: item.subcategory,
            ledgrCategory: item.category,
            ledgrAmount: item.amounts[colIndex] ?? 0,
            status: "unmatched",
            apiCategoryId: null,
            apiCategoryName: null,
            apiGroupName: null,
            apiBudgeted: null,
            apiActivity: null,
            syncDirection: null,
            contributionAccountId: item.contributionAccountId,
          });
        }
      }

      // -- Savings goal matching --
      type SavingsMatch = {
        goalId: number;
        goalName: string;
        status: "linked" | "suggested" | "unmatched";
        apiCategoryId: string | null;
        apiCategoryName: string | null;
        apiBalance: number | null;
        nameDrifted?: boolean;
        isEmergencyFund: boolean;
        reimbursementApiCategoryId: string | null;
      };

      const usedSavingsApiIds = new Set<string>();
      const savingsMatches: SavingsMatch[] = [];

      for (const goal of savingsGoalRows) {
        if (goal.apiCategoryId) {
          const apiCat = apiCats.find((c) => c.id === goal.apiCategoryId);
          usedSavingsApiIds.add(goal.apiCategoryId);
          const currentApiName = apiCat?.name ?? goal.apiCategoryName;
          savingsMatches.push({
            goalId: goal.id,
            goalName: goal.name,
            status: "linked",
            apiCategoryId: goal.apiCategoryId,
            apiCategoryName: currentApiName,
            apiBalance: apiCat?.balance ?? null,
            nameDrifted: currentApiName != null && goal.name !== currentApiName,
            isEmergencyFund: goal.isEmergencyFund,
            reimbursementApiCategoryId: goal.reimbursementApiCategoryId ?? null,
          });
        }
      }

      // Fuzzy match unlinked savings goals
      for (const goal of savingsGoalRows) {
        if (goal.apiCategoryId) continue;
        const normGoal = normalize(goal.name);
        const match = apiCats.find(
          (c) =>
            !usedApiIds.has(c.id) &&
            !usedSavingsApiIds.has(c.id) &&
            normalize(c.name) === normGoal,
        );
        if (match) {
          usedSavingsApiIds.add(match.id);
          savingsMatches.push({
            goalId: goal.id,
            goalName: goal.name,
            status: "suggested",
            apiCategoryId: match.id,
            apiCategoryName: match.name,
            apiBalance: match.balance,
            isEmergencyFund: goal.isEmergencyFund,
            reimbursementApiCategoryId: goal.reimbursementApiCategoryId ?? null,
          });
        } else {
          savingsMatches.push({
            goalId: goal.id,
            goalName: goal.name,
            status: "unmatched",
            apiCategoryId: null,
            apiCategoryName: null,
            apiBalance: null,
            isEmergencyFund: goal.isEmergencyFund,
            reimbursementApiCategoryId: goal.reimbursementApiCategoryId ?? null,
          });
        }
      }

      // API categories with no Ledgr match (budget or savings)
      const skippedIds = new Set(conn.skippedCategoryIds ?? []);
      const allUnmatchedApi = apiCats
        .filter((c) => !usedApiIds.has(c.id) && !usedSavingsApiIds.has(c.id))
        .map((c) => ({
          id: c.id,
          name: c.name,
          groupName: c.groupName,
          budgeted: c.budgeted,
        }));
      const unmatchedApi = allUnmatchedApi.filter((c) => !skippedIds.has(c.id));
      const skippedApi = allUnmatchedApi.filter((c) => skippedIds.has(c.id));

      // -- Portfolio → tracking account mapping preview --
      const trackingAccounts = accounts
        .filter((a) => !a.onBudget && !a.closed)
        .map((a) => ({
          id: a.id,
          name: a.name,
          balance: a.balance,
          type: a.type,
        }));

      // Get portfolio account labels (aggregated by performanceAccountId) from latest snapshot
      let portfolioLocalAccounts: Array<{
        label: string;
        balance: number;
        performanceAccountId: number | null;
      }> = [];
      if (latestSnapshot) {
        const [snapAccts, allPeople, perfAccounts] = await Promise.all([
          ctx.db
            .select()
            .from(schema.portfolioAccounts)
            .where(eq(schema.portfolioAccounts.snapshotId, latestSnapshot.id)),
          ctx.db.select().from(schema.people),
          ctx.db.select().from(schema.performanceAccounts),
        ]);
        const peopleMap = new Map(allPeople.map((p) => [p.id, p.name]));
        const perfMap = new Map(perfAccounts.map((p) => [p.id, p]));

        // Aggregate by performanceAccountId + ownerPersonId for stable identity.
        // Two people may share the same performanceAccountId (e.g. both have an IRA
        // at the same institution) — they must appear as separate line items.
        const perfOwnerMap = new Map<
          string,
          { perfId: number; label: string; balance: number }
        >();
        for (const a of snapAccts) {
          if (!a.performanceAccountId) continue;
          const perf = perfMap.get(a.performanceAccountId);
          const ownerName = a.ownerPersonId
            ? peopleMap.get(a.ownerPersonId)
            : undefined;
          const label = accountDisplayName(
            {
              accountType: a.accountType,
              subType: a.subType,
              label: a.label,
              institution: a.institution,
              displayName: perf?.displayName,
              accountLabel: perf?.accountLabel,
            },
            ownerName ?? undefined,
          );
          const key = `${a.performanceAccountId}:${a.ownerPersonId ?? ""}`;
          const existing = perfOwnerMap.get(key);
          if (existing) {
            existing.balance += Number(a.amount);
          } else {
            perfOwnerMap.set(key, {
              perfId: a.performanceAccountId,
              label,
              balance: Number(a.amount),
            });
          }
        }
        portfolioLocalAccounts = Array.from(perfOwnerMap.values())
          .map(({ perfId, label, balance }) => ({
            label,
            balance,
            performanceAccountId: perfId,
          }))
          .sort((a, b) => b.balance - a.balance);
      }

      const existingMappings = conn.accountMappings ?? [];

      // Build asset items list (carry-forward: latest value per name where year <= currentYear)
      const assetByName = new Map<
        string,
        { id: number; value: number; year: number }
      >();
      for (const a of assetItems) {
        if (a.year > currentYear) continue;
        const existing = assetByName.get(a.name);
        if (!existing || a.year > existing.year) {
          assetByName.set(a.name, {
            id: a.id,
            value: Number(a.value),
            year: a.year,
          });
        }
      }
      const assetLocalAccounts = Array.from(assetByName.entries())
        .map(([name, { id, value }]) => ({ label: name, balance: value, id }))
        .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));

      // Build mortgage mapping options with computed balances
      const { loanInputs: mortInputs, extras: mortExtras } =
        buildMortgageInputs(activeMortgageLoans, mortgageExtraPayments);
      const mortResult =
        activeMortgageLoans.length > 0
          ? calculateMortgage({
              loans: mortInputs,
              extraPayments: mortExtras,
              whatIfScenarios: [],
              asOfDate: new Date(),
            })
          : null;
      const mortgageAccounts: Array<{
        label: string;
        id: number;
        type: "propertyValue" | "loanBalance";
        value: number;
        calculatedBalance?: number;
        apiBalance?: number;
        apiBalanceDate?: string | null;
      }> = [];
      for (const loan of activeMortgageLoans) {
        mortgageAccounts.push({
          label: `${loan.name} — Property Value`,
          id: loan.id,
          type: "propertyValue",
          value: Number(
            loan.propertyValueEstimated ?? loan.propertyValuePurchase,
          ),
        });
        const loanResult = mortResult?.loans.find((r) => r.loanId === loan.id);
        mortgageAccounts.push({
          label: `${loan.name} — Loan Balance`,
          id: loan.id,
          type: "loanBalance",
          value: -(
            loanResult?.currentBalance ?? Number(loan.originalLoanAmount)
          ),
          calculatedBalance:
            loanResult?.calculatedBalance ?? loanResult?.currentBalance,
          apiBalance: loanResult?.apiBalance,
          apiBalanceDate: loan.apiBalanceDate,
        });
      }

      return {
        synced: true,
        fetchedAt: accountsCache.fetchedAt,
        lastSyncedAt: conn.lastSyncedAt,
        cash: {
          manual: manualCash,
          api: apiCash,
          apiAccounts: onBudgetCashAccounts.map((a) => ({
            name: a.name,
            balance: a.balance,
            type: a.type,
          })),
        },
        accounts: {
          total: accounts.filter((a) => !a.closed).length,
          onBudget: accounts.filter((a) => a.onBudget && !a.closed).length,
          tracking: accounts.filter((a) => !a.onBudget && !a.closed).length,
          byType: accountsByType,
        },
        categories: {
          groups: categoryGroups.filter((g) => !g.hidden).length,
          total: totalCategories,
        },
        // All API categories for dropdown pickers
        apiCategories: apiCats.map((c) => ({
          id: c.id,
          name: c.name,
          groupName: c.groupName,
          budgeted: c.budgeted,
        })),
        // Budget profile info
        profile: {
          linkedProfileId: conn.linkedProfileId,
          linkedProfileName: activeProfile?.name ?? null,
          linkedColumnIndex: conn.linkedColumnIndex ?? 0,
          columnLabels: activeProfile?.columnLabels ?? [],
          availableProfiles: allProfiles.map((p) => ({
            id: p.id,
            name: p.name,
            isActive: p.isActive,
            columnLabels: p.columnLabels,
          })),
        },
        // Portfolio → tracking account data
        portfolio: {
          snapshotDate: latestSnapshot?.snapshotDate ?? null,
          localAccounts: portfolioLocalAccounts,
          assetAccounts: assetLocalAccounts,
          mortgageAccounts,
          trackingAccounts,
          existingMappings,
        },
        budget: {
          matches: budgetMatches,
          unmatchedApiCategories: unmatchedApi,
          skippedApiCategories: skippedApi,
          summary: {
            linked: budgetMatches.filter((m) => m.status === "linked").length,
            suggested: budgetMatches.filter((m) => m.status === "suggested")
              .length,
            unmatched: budgetMatches.filter((m) => m.status === "unmatched")
              .length,
            apiOnly: unmatchedApi.length,
          },
        },
        savings: {
          matches: savingsMatches,
          summary: {
            linked: savingsMatches.filter((m) => m.status === "linked").length,
            suggested: savingsMatches.filter((m) => m.status === "suggested")
              .length,
            unmatched: savingsMatches.filter((m) => m.status === "unmatched")
              .length,
          },
        },
      } as const;
    }),

  /** Compare expenses between two periods using cached transaction data. */
  computeExpenseComparison: protectedProcedure
    .input(
      z.object({
        currentStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        currentEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        priorStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        priorEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      }),
    )
    .query(async ({ ctx, input }) => {
      const active = await getActiveBudgetApi(ctx.db);
      if (active === "none") return { categories: [], service: null };

      const txCache = await cacheGet<BudgetTransaction[]>(
        ctx.db,
        active,
        "transactions",
      );
      if (!txCache) return { categories: [], service: active };

      const transactions = txCache.data.filter(
        (t) =>
          !t.deleted &&
          t.categoryName &&
          !YNAB_EXPENSE_EXCLUDED_CATEGORIES.has(t.categoryName),
      );

      // Group by category, split into current vs prior
      const categoryData = new Map<
        string,
        { current: number; prior: number }
      >();

      for (const tx of transactions) {
        const catName = tx.categoryName!;
        const entry = categoryData.get(catName) ?? { current: 0, prior: 0 };

        if (tx.date >= input.currentStart && tx.date <= input.currentEnd) {
          entry.current += tx.amount;
        } else if (tx.date >= input.priorStart && tx.date <= input.priorEnd) {
          entry.prior += tx.amount;
        }

        categoryData.set(catName, entry);
      }

      const categories = Array.from(categoryData.entries())
        .map(([name, { current, prior }]) => ({
          name,
          current,
          prior,
          diff: current - prior,
          pctChange:
            prior !== 0 ? ((current - prior) / Math.abs(prior)) * 100 : null,
        }))
        .filter((c) => c.current !== 0 || c.prior !== 0)
        .sort((a, b) => Math.abs(b.current) - Math.abs(a.current));

      return { categories, service: active };
    }),
});
