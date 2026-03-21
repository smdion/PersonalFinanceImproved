// Sync router — budget API connection management and data synchronization.
// Sync works independently of activation — you can sync + preview before going live.

import { z } from "zod/v4";
import { eq, sql, isNotNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  createTRPCRouter,
  protectedProcedure,
  adminProcedure,
  syncProcedure,
} from "../trpc";
import * as schema from "@/lib/db/schema";
import {
  getClientForService,
  getActiveBudgetApi,
  getApiConnection,
  cacheGet,
  cacheSet,
  cacheClear,
} from "@/lib/budget-api";
import type {
  BudgetApiService,
  BudgetAccount,
  BudgetCategoryGroup,
  BudgetMonthDetail,
  BudgetTransaction,
  YnabConfig,
  ActualConfig,
} from "@/lib/budget-api";
import { parseAppSettings, buildMortgageInputs } from "@/server/helpers";
import { calculateMortgage } from "@/lib/calculators/mortgage";
import { accountDisplayName } from "@/lib/utils/format";
import { accountMappingSchema } from "@/lib/db/json-schemas";

const serviceEnum = z.enum(["ynab", "actual"]);

export const syncRouter = createTRPCRouter({
  /** Get connection status for each service (not just the active one) */
  getConnection: protectedProcedure.query(async ({ ctx }) => {
    const active = await getActiveBudgetApi(ctx.db);
    const [ynabConn, actualConn] = await Promise.all([
      getApiConnection(ctx.db, "ynab"),
      getApiConnection(ctx.db, "actual"),
    ]);

    return {
      activeApi: active,
      ynab: ynabConn
        ? { connected: true, lastSyncedAt: ynabConn.lastSyncedAt }
        : { connected: false, lastSyncedAt: null },
      actual: actualConn
        ? { connected: true, lastSyncedAt: actualConn.lastSyncedAt }
        : { connected: false, lastSyncedAt: null },
    };
  }),

  /** Save (upsert) a budget API connection */
  saveConnection: adminProcedure
    .input(
      z.discriminatedUnion("service", [
        z.object({
          service: z.literal("ynab"),
          accessToken: z.string().min(1),
          budgetId: z.string().min(1),
        }),
        z.object({
          service: z.literal("actual"),
          serverUrl: z.string().url(),
          apiKey: z.string().min(1),
          budgetSyncId: z.string().min(1),
        }),
      ]),
    )
    .mutation(async ({ ctx, input }) => {
      const config: YnabConfig | ActualConfig =
        input.service === "ynab"
          ? { accessToken: input.accessToken, budgetId: input.budgetId }
          : {
              serverUrl: input.serverUrl,
              apiKey: input.apiKey,
              budgetSyncId: input.budgetSyncId,
            };

      // Single atomic upsert — onConflictDoUpdate is already transactional in
      // Postgres (the INSERT … ON CONFLICT DO UPDATE runs as one statement).
      // No explicit transaction wrapper needed.
      await ctx.db
        .insert(schema.apiConnections)
        .values({
          service: input.service,
          config,
        })
        .onConflictDoUpdate({
          target: schema.apiConnections.service,
          set: { config },
        });

      return { success: true };
    }),

  /** Fetch YNAB budgets list using a raw token (before saving connection) */
  fetchYnabBudgets: adminProcedure
    .input(z.object({ accessToken: z.string().min(1) }))
    .mutation(async ({ input }) => {
      try {
        const res = await fetch("https://api.ynab.com/v1/budgets", {
          headers: { Authorization: `Bearer ${input.accessToken}` },
        });
        if (!res.ok) {
          const text = await res.text();
          return {
            success: false as const,
            error: `YNAB API error ${res.status}: ${text}`,
          };
        }
        const json = (await res.json()) as {
          data: {
            budgets: Array<{
              id: string;
              name: string;
              last_modified_on: string;
            }>;
          };
        };
        return {
          success: true as const,
          budgets: json.data.budgets.map((b) => ({
            id: b.id,
            name: b.name,
            lastModified: b.last_modified_on,
          })),
        };
      } catch (e) {
        return {
          success: false as const,
          error: e instanceof Error ? e.message : "Unknown error",
        };
      }
    }),

  /** Test a specific service connection (works before activation) */
  testConnection: adminProcedure
    .input(z.object({ service: serviceEnum }))
    .mutation(async ({ ctx, input }) => {
      const client = await getClientForService(ctx.db, input.service);
      if (!client) {
        return {
          success: false,
          error: `No ${input.service} connection configured`,
        };
      }

      try {
        // getBudgetName implicitly tests the connection — no need to call both
        const budgetName = await client.getBudgetName();
        return { success: true, budgetName };
      } catch (e) {
        return {
          success: false,
          error: e instanceof Error ? e.message : "Unknown error",
        };
      }
    }),

  /** Delete a connection and clear its cache */
  deleteConnection: adminProcedure
    .input(z.object({ service: serviceEnum }))
    .mutation(async ({ ctx, input }) => {
      await cacheClear(ctx.db, input.service);
      await ctx.db
        .delete(schema.apiConnections)
        .where(eq(schema.apiConnections.service, input.service));

      // If we're deleting the active API, reset to 'none'
      const active = await getActiveBudgetApi(ctx.db);
      if (active === input.service) {
        await ctx.db
          .insert(schema.appSettings)
          .values({ key: "active_budget_api", value: "none" })
          .onConflictDoUpdate({
            target: schema.appSettings.key,
            set: { value: "none" },
          });
      }

      return { success: true };
    }),

  /** Get sync status for the active API */
  getSyncStatus: protectedProcedure.query(async ({ ctx }) => {
    const active = await getActiveBudgetApi(ctx.db);
    if (active === "none") {
      return { service: null, connected: false, lastSynced: null };
    }

    const conn = await getApiConnection(ctx.db, active);
    return {
      service: active,
      connected: !!conn,
      lastSynced: conn?.lastSyncedAt ?? null,
    };
  }),

  /**
   * Full sync for a specific service — works independently of active_budget_api.
   * Pulls accounts, categories, current month, and transactions into cache.
   */
  syncAll: syncProcedure
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

        const sinceDate = `${now.getFullYear()}-01-01`;
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
        } catch {
          // Asset pull failure shouldn't fail the sync
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
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Sync failed: ${e instanceof Error ? e.message : "Unknown error"}`,
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
        (t) => !t.deleted && t.categoryName,
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

  /** Get the current active_budget_api setting */
  getActiveBudgetApi: protectedProcedure.query(async ({ ctx }) => {
    return getActiveBudgetApi(ctx.db);
  }),

  /** Set the active_budget_api setting */
  setActiveBudgetApi: adminProcedure
    .input(z.object({ value: z.enum(["none", "ynab", "actual"]) }))
    .mutation(async ({ ctx, input }) => {
      if (input.value !== "none") {
        const conn = await getApiConnection(ctx.db, input.value);
        if (!conn) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `No ${input.value} connection configured. Save credentials first.`,
          });
        }
      }

      await ctx.db
        .insert(schema.appSettings)
        .values({ key: "active_budget_api", value: input.value })
        .onConflictDoUpdate({
          target: schema.appSettings.key,
          set: { value: input.value },
        });

      return { success: true };
    }),

  /** Set which Ledgr budget profile syncs with the budget API. */
  setLinkedProfile: adminProcedure
    .input(z.object({ service: serviceEnum, profileId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(schema.apiConnections)
        .set({ linkedProfileId: input.profileId })
        .where(eq(schema.apiConnections.service, input.service));
      return { ok: true };
    }),

  /** Set which budget column (mode) syncs with the budget API. */
  setLinkedColumn: adminProcedure
    .input(
      z.object({ service: serviceEnum, columnIndex: z.number().int().min(0) }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(schema.apiConnections)
        .set({ linkedColumnIndex: input.columnIndex })
        .where(eq(schema.apiConnections.service, input.service));
      return { ok: true };
    }),

  /** Skip an API category — hide from "not in Ledgr" list */
  skipCategory: adminProcedure
    .input(z.object({ service: serviceEnum, categoryId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const conn = await getApiConnection(ctx.db, input.service);
      if (!conn)
        throw new TRPCError({ code: "NOT_FOUND", message: "No connection" });
      const current = conn.skippedCategoryIds ?? [];
      if (current.includes(input.categoryId)) return { ok: true };
      await ctx.db
        .update(schema.apiConnections)
        .set({ skippedCategoryIds: [...current, input.categoryId] })
        .where(eq(schema.apiConnections.service, input.service));
      return { ok: true };
    }),

  /** Unskip an API category — restore to "not in Ledgr" list */
  unskipCategory: adminProcedure
    .input(z.object({ service: serviceEnum, categoryId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const conn = await getApiConnection(ctx.db, input.service);
      if (!conn)
        throw new TRPCError({ code: "NOT_FOUND", message: "No connection" });
      const current = conn.skippedCategoryIds ?? [];
      await ctx.db
        .update(schema.apiConnections)
        .set({
          skippedCategoryIds: current.filter((id) => id !== input.categoryId),
        })
        .where(eq(schema.apiConnections.service, input.service));
      return { ok: true };
    }),

  // ── Name Sync (rename Ledgr items to match API names) ──

  /** Rename a budget item's subcategory to match the API category name. */
  renameBudgetItemToApi: adminProcedure
    .input(z.object({ budgetItemId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const [item] = await ctx.db
        .select({ apiCategoryName: schema.budgetItems.apiCategoryName })
        .from(schema.budgetItems)
        .where(eq(schema.budgetItems.id, input.budgetItemId));
      if (!item?.apiCategoryName) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Item not linked to API category",
        });
      }
      await ctx.db
        .update(schema.budgetItems)
        .set({ subcategory: item.apiCategoryName })
        .where(eq(schema.budgetItems.id, input.budgetItemId));
      return { ok: true, newName: item.apiCategoryName };
    }),

  /** Rename a budget item's API category name to match the Ledgr subcategory (update stored name). */
  renameBudgetItemApiName: adminProcedure
    .input(z.object({ budgetItemId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const [item] = await ctx.db
        .select({ subcategory: schema.budgetItems.subcategory })
        .from(schema.budgetItems)
        .where(eq(schema.budgetItems.id, input.budgetItemId));
      if (!item) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Budget item not found",
        });
      }
      await ctx.db
        .update(schema.budgetItems)
        .set({ apiCategoryName: item.subcategory })
        .where(eq(schema.budgetItems.id, input.budgetItemId));
      return { ok: true, newApiName: item.subcategory };
    }),

  /** Move a budget item to the API's category group. */
  moveBudgetItemToApiGroup: adminProcedure
    .input(
      z.object({
        budgetItemId: z.number().int(),
        apiGroupName: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(schema.budgetItems)
        .set({ category: input.apiGroupName })
        .where(eq(schema.budgetItems.id, input.budgetItemId));
      return { ok: true };
    }),

  /** Rename a savings goal to match the API category name. */
  renameSavingsGoalToApi: adminProcedure
    .input(z.object({ goalId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const [goal] = await ctx.db
        .select({ apiCategoryName: schema.savingsGoals.apiCategoryName })
        .from(schema.savingsGoals)
        .where(eq(schema.savingsGoals.id, input.goalId));
      if (!goal?.apiCategoryName) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Goal not linked to API category",
        });
      }
      await ctx.db
        .update(schema.savingsGoals)
        .set({ name: goal.apiCategoryName })
        .where(eq(schema.savingsGoals.id, input.goalId));
      return { ok: true, newName: goal.apiCategoryName };
    }),

  /** Update a savings goal's stored API name to match its current Ledgr name. */
  renameSavingsGoalApiName: adminProcedure
    .input(z.object({ goalId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const [goal] = await ctx.db
        .select({ name: schema.savingsGoals.name })
        .from(schema.savingsGoals)
        .where(eq(schema.savingsGoals.id, input.goalId));
      if (!goal) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Savings goal not found",
        });
      }
      await ctx.db
        .update(schema.savingsGoals)
        .set({ apiCategoryName: goal.name })
        .where(eq(schema.savingsGoals.id, input.goalId));
      return { ok: true, newApiName: goal.name };
    }),

  /** Batch rename all drifted items in one direction. */
  syncAllNames: adminProcedure
    .input(
      z.object({
        service: serviceEnum.optional(),
        direction: z.enum(["pull", "keepLedgr"]),
        includeCategories: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      let budgetRenamed = 0;
      let savingsRenamed = 0;
      let categoriesMoved = 0;

      // Budget items with drift (name or category group)
      const allBudgetItems = await ctx.db
        .select({
          id: schema.budgetItems.id,
          category: schema.budgetItems.category,
          subcategory: schema.budgetItems.subcategory,
          apiCategoryId: schema.budgetItems.apiCategoryId,
          apiCategoryName: schema.budgetItems.apiCategoryName,
        })
        .from(schema.budgetItems)
        .where(isNotNull(schema.budgetItems.apiCategoryId));

      // Look up API category groups from cache for name + group resolution
      const apiCategoryMap = new Map<
        string,
        { name: string; groupName: string }
      >();
      if (input.direction === "pull") {
        // Use provided service or fall back to active API
        const cacheService =
          input.service ?? (await getActiveBudgetApi(ctx.db));
        if (cacheService !== "none") {
          const cached = await cacheGet<BudgetCategoryGroup[]>(
            ctx.db,
            cacheService as BudgetApiService,
            "categories",
          );
          if (cached) {
            for (const group of cached.data) {
              for (const cat of group.categories) {
                apiCategoryMap.set(cat.id, {
                  name: cat.name,
                  groupName: group.name,
                });
              }
            }
          }
        }
      }

      for (const item of allBudgetItems) {
        const updates: Record<string, string> = {};

        // For pull: use the current API name from cache (if available), not stored name
        const currentApiName =
          (item.apiCategoryId
            ? apiCategoryMap.get(item.apiCategoryId)?.name
            : null) ?? item.apiCategoryName;

        // Name drift
        if (currentApiName && item.subcategory !== currentApiName) {
          if (input.direction === "pull") {
            updates.subcategory = currentApiName;
            updates.apiCategoryName = currentApiName;
          } else {
            updates.apiCategoryName = item.subcategory;
          }
          budgetRenamed++;
        }

        // Category group drift (pull only)
        if (
          input.direction === "pull" &&
          input.includeCategories &&
          item.apiCategoryId
        ) {
          const apiCat = apiCategoryMap.get(item.apiCategoryId);
          if (apiCat && apiCat.groupName !== item.category) {
            updates.category = apiCat.groupName;
            categoriesMoved++;
          }
        }

        if (Object.keys(updates).length > 0) {
          await ctx.db
            .update(schema.budgetItems)
            .set(updates)
            .where(eq(schema.budgetItems.id, item.id));
        }
      }

      // Savings goals with drift
      const goals = await ctx.db
        .select({
          id: schema.savingsGoals.id,
          name: schema.savingsGoals.name,
          apiCategoryId: schema.savingsGoals.apiCategoryId,
          apiCategoryName: schema.savingsGoals.apiCategoryName,
        })
        .from(schema.savingsGoals)
        .where(isNotNull(schema.savingsGoals.apiCategoryId));

      for (const goal of goals) {
        const currentGoalApiName =
          (goal.apiCategoryId
            ? apiCategoryMap.get(goal.apiCategoryId)?.name
            : null) ?? goal.apiCategoryName;
        if (!currentGoalApiName || goal.name === currentGoalApiName) continue;
        if (input.direction === "pull") {
          await ctx.db
            .update(schema.savingsGoals)
            .set({
              name: currentGoalApiName,
              apiCategoryName: currentGoalApiName,
            })
            .where(eq(schema.savingsGoals.id, goal.id));
        } else {
          await ctx.db
            .update(schema.savingsGoals)
            .set({ apiCategoryName: goal.name })
            .where(eq(schema.savingsGoals.id, goal.id));
        }
        savingsRenamed++;
      }

      return { ok: true, budgetRenamed, savingsRenamed, categoriesMoved };
    }),

  // ── Account Mappings (for portfolio push + asset tracking) ──

  /** Get account mappings for a service. */
  listAccountMappings: protectedProcedure.query(async ({ ctx }) => {
    const active = await getActiveBudgetApi(ctx.db);
    if (active === "none") return { mappings: [], service: null };

    const conn = await getApiConnection(ctx.db, active);
    return {
      mappings: conn?.accountMappings ?? [],
      service: active,
    };
  }),

  /** Update account mappings for a service (works pre-activation). */
  updateAccountMappings: adminProcedure
    .input(
      z.object({
        service: serviceEnum,
        mappings: z.array(accountMappingSchema),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(schema.apiConnections)
        .set({ accountMappings: input.mappings })
        .where(eq(schema.apiConnections.service, input.service));

      return { success: true };
    }),

  /** Create a new Ledgr asset item and add a mapping to a tracking account. */
  createAssetAndMap: adminProcedure
    .input(
      z.object({
        service: serviceEnum,
        assetName: z.string().min(1),
        balance: z.number(),
        remoteAccountId: z.string().min(1),
        syncDirection: z.enum(["pull", "push", "both"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const currentYear = new Date().getFullYear();

      // Create or update the asset item
      const insertResult = await ctx.db
        .insert(schema.otherAssetItems)
        .values({
          name: input.assetName,
          year: currentYear,
          value: String(input.balance),
          note: `Created from ${input.service.toUpperCase()} tracking account`,
        })
        .onConflictDoUpdate({
          target: [schema.otherAssetItems.name, schema.otherAssetItems.year],
          set: {
            value: String(input.balance),
            note: `Created from ${input.service.toUpperCase()} tracking account`,
          },
        })
        .returning({ id: schema.otherAssetItems.id });

      const assetId = insertResult[0]?.id;
      if (!assetId) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create asset item",
        });
      }

      // Add to account mappings
      const conn = await getApiConnection(ctx.db, input.service);
      const mappings = conn?.accountMappings ?? [];
      mappings.push({
        localId: `asset:${assetId}`,
        localName: input.assetName,
        remoteAccountId: input.remoteAccountId,
        syncDirection: input.syncDirection,
        assetId,
      });
      await ctx.db
        .update(schema.apiConnections)
        .set({ accountMappings: mappings })
        .where(eq(schema.apiConnections.service, input.service));

      return { success: true };
    }),

  /** Push portfolio snapshot balances to budget API tracking accounts. */
  pushPortfolioToApi: adminProcedure
    .input(z.object({ snapshotId: z.number().int().optional() }).optional())
    .mutation(async ({ ctx, input }) => {
      const active = await getActiveBudgetApi(ctx.db);
      if (active === "none") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No budget API active",
        });
      }

      const client = await getClientForService(ctx.db, active);
      if (!client) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Budget API client not available",
        });
      }

      const conn = await getApiConnection(ctx.db, active);
      const mappings = conn?.accountMappings ?? [];
      if (mappings.length === 0) {
        return { pushed: 0, message: "No account mappings configured" };
      }

      // Get the snapshot — latest if not specified
      let snapshot;
      if (input?.snapshotId) {
        snapshot = await ctx.db
          .select()
          .from(schema.portfolioSnapshots)
          .where(eq(schema.portfolioSnapshots.id, input.snapshotId))
          .then((r) => r[0]);
      } else {
        snapshot = await ctx.db
          .select()
          .from(schema.portfolioSnapshots)
          .orderBy(sql`${schema.portfolioSnapshots.snapshotDate} DESC`)
          .limit(1)
          .then((r) => r[0]);
      }
      if (!snapshot) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No portfolio snapshot found",
        });
      }

      // Get snapshot accounts + people for owner-aware labels
      const [snapshotAccounts] = await Promise.all([
        ctx.db
          .select()
          .from(schema.portfolioAccounts)
          .where(eq(schema.portfolioAccounts.snapshotId, snapshot.id)),
      ]);
      const _pushPerfAccounts = await ctx.db
        .select()
        .from(schema.performanceAccounts);

      // Build balances keyed by performanceAccountId for ID-based resolution
      const balanceByPerfId = new Map<number, number>();
      for (const acct of snapshotAccounts) {
        if (!acct.performanceAccountId) continue;
        balanceByPerfId.set(
          acct.performanceAccountId,
          (balanceByPerfId.get(acct.performanceAccountId) ?? 0) +
            Number(acct.amount),
        );
      }

      // Get current API account balances
      const apiAccounts = await cacheGet<BudgetAccount[]>(
        ctx.db,
        active,
        "accounts",
      );
      const apiBalanceMap = new Map<string, number>();
      if (apiAccounts) {
        for (const a of apiAccounts.data) {
          apiBalanceMap.set(a.id, a.balance);
        }
      }

      // Aggregate local balances by remote account via localId (many-to-one support)
      const remoteAggregated = new Map<
        string,
        { total: number; localNames: string[] }
      >();
      for (const mapping of mappings) {
        if (
          mapping.syncDirection !== "push" &&
          mapping.syncDirection !== "both"
        )
          continue;
        // Parse localId to get performanceAccountId
        let localBalance: number | undefined;
        if (
          mapping.performanceAccountId ||
          mapping.localId?.startsWith("performance:")
        ) {
          const perfId =
            mapping.performanceAccountId ??
            parseInt(mapping.localId!.split(":")[1]!, 10);
          localBalance = balanceByPerfId.get(perfId);
        }
        if (localBalance === undefined) continue;
        const entry = remoteAggregated.get(mapping.remoteAccountId) ?? {
          total: 0,
          localNames: [],
        };
        entry.total += localBalance;
        entry.localNames.push(mapping.localName);
        remoteAggregated.set(mapping.remoteAccountId, entry);
      }

      let pushed = 0;
      for (const [remoteId, { total, localNames }] of Array.from(
        remoteAggregated.entries(),
      )) {
        const currentApiBalance = apiBalanceMap.get(remoteId) ?? 0;
        const diff = total - currentApiBalance;
        if (Math.abs(diff) < 0.01) continue;

        await client.createTransaction({
          accountId: remoteId,
          date: snapshot.snapshotDate,
          amount: diff,
          payeeName: "Portfolio Sync",
          memo: `Portfolio snapshot ${snapshot.snapshotDate} (${localNames.join(", ")})`,
          cleared: true,
          approved: true,
        });
        pushed++;
      }

      return { pushed };
    }),

  /** Pull tracking account balances from budget API into Ledgr asset values. */
  pullAssetsFromApi: adminProcedure.mutation(async ({ ctx }) => {
    const active = await getActiveBudgetApi(ctx.db);
    if (active === "none") {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "No budget API active",
      });
    }

    const conn = await getApiConnection(ctx.db, active);
    const mappings = conn?.accountMappings ?? [];
    const pullMappings = mappings.filter(
      (m) => m.syncDirection === "pull" || m.syncDirection === "both",
    );
    if (pullMappings.length === 0) {
      return { pulled: 0, message: "No pull mappings configured" };
    }

    // Get cached API accounts
    const apiAccounts = await cacheGet<BudgetAccount[]>(
      ctx.db,
      active,
      "accounts",
    );
    if (!apiAccounts) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "No cached accounts. Run Sync first.",
      });
    }

    const apiBalanceMap = new Map<string, number>();
    for (const a of apiAccounts.data) {
      apiBalanceMap.set(a.id, a.balance);
    }

    const currentYear = new Date().getFullYear();
    let pulled = 0;

    for (const mapping of pullMappings) {
      const apiBalance = apiBalanceMap.get(mapping.remoteAccountId);
      if (apiBalance === undefined) continue;

      // Resolve asset name by ID when available
      const localId = mapping.localId ?? mapping.localName; // backward compat
      let assetName = mapping.localName;
      if (mapping.assetId != null || localId.startsWith("asset:")) {
        const assetId = mapping.assetId ?? parseInt(localId.split(":")[1]!, 10);
        const assetRow = await ctx.db
          .select()
          .from(schema.otherAssetItems)
          .where(eq(schema.otherAssetItems.id, assetId))
          .then((r) => r[0]);
        if (assetRow) assetName = assetRow.name;
      }

      // Upsert into other_asset_items for the current year
      const existing = await ctx.db
        .select()
        .from(schema.otherAssetItems)
        .where(eq(schema.otherAssetItems.name, assetName))
        .then((rows) => rows.find((r) => r.year === currentYear));

      if (existing) {
        await ctx.db
          .update(schema.otherAssetItems)
          .set({
            value: String(apiBalance),
            note: `Synced from ${active.toUpperCase()}`,
          })
          .where(eq(schema.otherAssetItems.id, existing.id));
      } else {
        await ctx.db.insert(schema.otherAssetItems).values({
          name: assetName,
          year: currentYear,
          value: String(apiBalance),
          note: `Synced from ${active.toUpperCase()}`,
        });
      }
      pulled++;
    }

    return { pulled };
  }),

  /**
   * One-time migration: backfill `localId` on account mappings that only have `localName`.
   * For each mapping without `localId`:
   *   - mortgage: pattern already uses "mortgage:{id}:{type}" in localName → copy to localId
   *   - asset: match localName to other_asset_items.name → set localId = "asset:{id}"
   *   - portfolio: reverse-map display label to performanceAccountId → set localId = "performance:{id}"
   */
  migrateAccountMappingsToIds: adminProcedure.mutation(async ({ ctx }) => {
    const connections = await ctx.db.select().from(schema.apiConnections);
    const report: Array<{ service: string; mapping: string; status: string }> =
      [];

    for (const conn of connections) {
      const mappings = conn.accountMappings ?? [];
      if (mappings.length === 0) continue;

      let changed = false;
      const updated = [...mappings];

      // Load reference data for resolution
      const [allAssets, perfAccounts, allPeople, latestSnapshot] =
        await Promise.all([
          ctx.db.select().from(schema.otherAssetItems),
          ctx.db.select().from(schema.performanceAccounts),
          ctx.db.select().from(schema.people),
          ctx.db
            .select()
            .from(schema.portfolioSnapshots)
            .orderBy(sql`snapshot_date DESC`)
            .limit(1),
        ]);

      // Build label→perfId map from performanceAccounts (accountLabel is the canonical display name)
      const labelToPerfId = new Map<string, number>();
      for (const perf of perfAccounts) {
        if (perf.accountLabel && !labelToPerfId.has(perf.accountLabel)) {
          labelToPerfId.set(perf.accountLabel, perf.id);
        }
        if (perf.displayName && !labelToPerfId.has(perf.displayName)) {
          labelToPerfId.set(perf.displayName, perf.id);
        }
      }
      // Also build labels from latest snapshot (handles owner-prefixed names like "User IRA (Vanguard)")
      if (latestSnapshot[0]) {
        const snapAccts = await ctx.db
          .select()
          .from(schema.portfolioAccounts)
          .where(eq(schema.portfolioAccounts.snapshotId, latestSnapshot[0].id));
        const peopleMap = new Map(allPeople.map((p) => [p.id, p.name]));
        const perfMap = new Map(perfAccounts.map((p) => [p.id, p]));

        for (const acct of snapAccts) {
          if (!acct.performanceAccountId) continue;
          const perf = perfMap.get(acct.performanceAccountId);
          const ownerName = acct.ownerPersonId
            ? peopleMap.get(acct.ownerPersonId)
            : undefined;
          const label = accountDisplayName(
            {
              accountType: acct.accountType,
              subType: acct.subType,
              label: acct.label,
              institution: acct.institution,
              displayName: perf?.displayName,
              accountLabel: perf?.accountLabel,
            },
            ownerName ?? undefined,
          );
          if (!labelToPerfId.has(label)) {
            labelToPerfId.set(label, acct.performanceAccountId);
          }
        }
      }

      for (let i = 0; i < updated.length; i++) {
        const m = updated[i]!;
        if (m.localId) {
          report.push({
            service: conn.service,
            mapping: m.localName,
            status: "already_migrated",
          });
          continue;
        }

        // Mortgage pattern: localName = "mortgage:{id}:{type}"
        if (m.localName.match(/^mortgage:\d+:\w+$/)) {
          const mParts = m.localName.split(":");
          updated[i] = {
            ...m,
            localId: m.localName,
            loanId: Number(mParts[1]),
            loanMapType: mParts[2] as "propertyValue" | "loanBalance",
          };
          changed = true;
          report.push({
            service: conn.service,
            mapping: m.localName,
            status: "migrated_mortgage",
          });
          continue;
        }

        // Asset: match by name
        const assetMatch = allAssets.find((a) => a.name === m.localName);
        if (assetMatch) {
          updated[i] = {
            ...m,
            localId: `asset:${assetMatch.id}`,
            assetId: assetMatch.id,
          };
          changed = true;
          report.push({
            service: conn.service,
            mapping: m.localName,
            status: "migrated_asset",
          });
          continue;
        }

        // Portfolio: reverse-map label to performanceAccountId
        const perfId = labelToPerfId.get(m.localName);
        if (perfId) {
          updated[i] = {
            ...m,
            localId: `performance:${perfId}`,
            performanceAccountId: perfId,
          };
          changed = true;
          report.push({
            service: conn.service,
            mapping: m.localName,
            status: "migrated_portfolio",
          });
          continue;
        }

        report.push({
          service: conn.service,
          mapping: m.localName,
          status: "unresolved",
        });
      }

      if (changed) {
        await ctx.db
          .update(schema.apiConnections)
          .set({ accountMappings: updated })
          .where(eq(schema.apiConnections.service, conn.service));
      }
    }

    return { report };
  }),
});
