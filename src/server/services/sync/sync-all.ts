/** The full sync for one budget service (sync.syncAll): accounts, categories,
 *  the current month and transactions pulled into the cache. */
import type { Db } from "@/lib/db";
import { eq, and, like, ne } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import * as schema from "@/lib/db/schema";
import { log } from "@/lib/logger";
import {
  getClientForService,
  getActiveBudgetApi,
  getApiConnection,
  cacheGet,
  cacheSet,
  type BudgetApiService,
} from "@/lib/budget-api";
import { currentMonthKey } from "@/lib/utils/date-keys";
import { detectDrift, hasDrift } from "@/lib/budget-api/drift-detection";
import { readCachedMonthBalances } from "@/lib/budget-api/cached-month";
import { applyPullMapping } from "@/server/services/sync/apply-pull-mapping";
import { loadSavingsGoalLinks } from "@/server/data/category-links";
import { nothingChanged, userMessageFor } from "@/lib/budget-api/errors";
import { toDecimalColumn } from "@/lib/utils/math";
import { writeStamp } from "@/lib/utils/clock";

export async function syncAll(
  ctx: { db: Db; scope: { asOf: Date } },
  input: { service: BudgetApiService },
) {
  const client = await getClientForService(ctx.db, input.service);
  if (!client) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `No ${input.service} connection configured`,
    });
  }

  const service = input.service;

  try {
    // Read previous cached account list BEFORE the new fetch so we
    // can diff for drift detection.
    const cachedBefore = await cacheGet(ctx.db, service, "accounts").catch(
      () => null,
    );
    const cachedAccountsBefore = cachedBefore?.data ?? [];

    // ── Phase 1: Network fetch (no DB writes) ────────────────────
    // If anything here throws, no local state changes.
    const [accounts, categories] = await Promise.all([
      client.getAccounts(),
      client.getCategories(ctx.scope.asOf),
    ]);

    const now = new Date(); // after the fetch
    const currentMonth = currentMonthKey(now);
    const monthDetail = await client.getMonthDetail(currentMonth);

    const sinceDate = `${now.getFullYear() - 1}-01-01`;
    const transactions = await client.getTransactions(sinceDate);

    // Read once, before the transaction: the pull below writes by these
    // mappings, and a mapping edit made during the sync applies on the next.
    const conn = await getApiConnection(ctx.db, service);
    const mappings = conn?.accountMappings ?? [];
    const pullMappings = mappings.filter(
      (m) => m.syncDirection === "pull" || m.syncDirection === "both",
    );
    const { getApiAccountBalanceMapFromAccounts } =
      await import("@/server/services/sync/api-balance-resolution");
    const apiBalanceMap = getApiAccountBalanceMapFromAccounts(accounts);

    // ── Drift detection ──
    // Diff the cached account list against the new fetch (broken mappings,
    // renames, new remote accounts) for the UI's callouts.
    const driftReport = detectDrift(cachedAccountsBefore, accounts, mappings);

    // ── Phase 2: Single-transaction commit ──
    // Cache writes, lastSyncedAt and the asset-pull loop share one transaction:
    // any asset write failure rolls back the whole sync and reports failure.
    const assetsPulled = await ctx.db.transaction(async (tx) => {
      await cacheSet(tx, service, "accounts", accounts);
      await cacheSet(tx, service, "categories", categories);
      await cacheSet(tx, service, `months/${currentMonth}`, monthDetail);
      await cacheSet(tx, service, "transactions", transactions);

      await tx
        .update(schema.apiConnections)
        .set({ lastSyncedAt: writeStamp() })
        .where(eq(schema.apiConnections.service, service));

      // ── Record savings_monthly from budget category balances ─────────
      // Only runs for the active service — a non-active service's category
      // balances should not overwrite savings history.
      const activeService = await getActiveBudgetApi(tx);
      if (service === activeService) {
        // Fetch all savings goals with a primary link for THIS service.
        const activeGoalRows = await tx
          .select({ id: schema.savingsGoals.id })
          .from(schema.savingsGoals)
          .where(eq(schema.savingsGoals.isActive, true));
        const syncGoalLinks = await loadSavingsGoalLinks(
          tx,
          activeGoalRows.map((g) => g.id),
          service,
          "primary",
        );
        const linkedGoals = activeGoalRows
          .map((g) => ({
            id: g.id,
            apiCategoryId: syncGoalLinks.get(g.id)?.categoryId ?? null,
          }))
          .filter((g) => g.apiCategoryId);

        // Build categoryId → balance map from this sync's month detail.
        const catBalanceMap = new Map<string, number>(
          monthDetail.categories.map((c) => [c.id, c.balance]),
        );

        // Step 1: upsert current month balance for each linked goal.
        for (const goal of linkedGoals) {
          if (!goal.apiCategoryId) continue;
          const balance = catBalanceMap.get(goal.apiCategoryId);
          if (balance === undefined) continue;
          await tx
            .insert(schema.savingsMonthly)
            .values({
              goalId: goal.id,
              monthDate: currentMonth,
              balance: toDecimalColumn(
                balance,
                "a savings balance from the budget app",
              ),
            })
            .onConflictDoUpdate({
              target: [
                schema.savingsMonthly.goalId,
                schema.savingsMonthly.monthDate,
              ],
              // Only overwrite balance — never touch deposit_or_withdrawal or notes.
              set: {
                balance: toDecimalColumn(
                  balance,
                  "a savings balance from the budget app",
                ),
              },
            });
        }

        // Step 2: harvest prior months' cached month details into savings_monthly
        // (only rows that don't exist yet); step 3 prunes them.
        const priorMonthCaches = await tx
          .select({
            cacheKey: schema.budgetApiCache.cacheKey,
            data: schema.budgetApiCache.data,
          })
          .from(schema.budgetApiCache)
          .where(
            and(
              eq(schema.budgetApiCache.service, service),
              like(schema.budgetApiCache.cacheKey, "months/%"),
              ne(schema.budgetApiCache.cacheKey, `months/${currentMonth}`),
            ),
          );

        let harvested = false;
        for (const entry of priorMonthCaches) {
          // Cache key is "months/YYYY-MM-01" — extract the date portion.
          const monthDate = entry.cacheKey.replace("months/", "");
          const priorCatMap = readCachedMonthBalances(
            entry.cacheKey,
            entry.data,
          );
          for (const goal of linkedGoals) {
            const balance = priorCatMap.get(goal.apiCategoryId!);
            if (balance === undefined) continue;
            // Insert only — never overwrite an existing month's recorded balance.
            await tx
              .insert(schema.savingsMonthly)
              .values({
                goalId: goal.id,
                monthDate,
                balance: toDecimalColumn(
                  balance,
                  "a savings balance from the budget app",
                ),
              })
              .onConflictDoNothing();
            harvested = true;
          }
        }

        // Step 3: prune prior months' cache entries (now in savings_monthly); the
        // current month stays for budget actuals and getPreview. Callers must not
        // assume prior-month entries exist.
        if (harvested) {
          await tx
            .delete(schema.budgetApiCache)
            .where(
              and(
                eq(schema.budgetApiCache.service, service),
                like(schema.budgetApiCache.cacheKey, "months/%"),
                ne(schema.budgetApiCache.cacheKey, `months/${currentMonth}`),
              ),
            );
        }
      }

      if (pullMappings.length === 0) return 0;

      let pulled = 0;
      for (const mapping of pullMappings) {
        const apiBalance = apiBalanceMap.get(mapping.remoteAccountId);
        if (apiBalance === undefined) continue;

        const result = await applyPullMapping(tx, {
          mapping,
          apiBalance,
          service,
          pulledAt: now,
        });
        if (result.applied) pulled++;
      }
      return pulled;
    });

    return {
      ok: true,
      counts: {
        accounts: accounts.length,
        categories: categories.reduce((sum, g) => sum + g.categories.length, 0),
        transactions: transactions.length,
        assetsPulled,
      },
      // Drift report — UI renders broken mappings as
      // actionable callouts so users can fix them rather than
      // silently losing sync coverage.
      drift: hasDrift(driftReport) ? driftReport : null,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    log("error", "sync_failed", { service, error: msg });
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `Sync failed: ${userMessageFor(e) ?? msg.slice(0, 200)}`,
      // The network phase writes nothing; its transaction rolls back.
      cause: nothingChanged(e),
    });
  }
}
