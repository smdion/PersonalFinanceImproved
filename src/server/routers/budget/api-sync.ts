import { eq } from "drizzle-orm";
import { log } from "@/lib/logger";
import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { budgetProcedure } from "../../trpc";
import * as schema from "@/lib/db/schema";
import { budgetAmountsSchema } from "@/lib/db/shapes/json-schemas";
import {
  loadBudgetItemLinks,
  setBudgetItemLink,
} from "@/server/data/category-links";
import { resolveLinkedBudgetItemAmounts } from "@/server/services/budget/linked-items";
import {
  cacheGet,
  refreshCategoryCache,
  BudgetApiError,
} from "@/lib/budget-api";
import {
  requireActiveBudgetApi,
  requireBudgetClient,
} from "@/server/services/budget/budget-client";
import { WriteStopped, nothingChanged } from "@/lib/budget-api/errors";
import type { BudgetMonthDetail, PreparedGoalWrite } from "@/lib/budget-api";
import { currentMonthKey } from "@/lib/utils/date-keys";
import { resolveProfileSelection } from "@/server/services/profile-selection";
import { writeStamp } from "@/lib/utils/clock";

export const apiSyncProcedures = {
  /** Pull budgeted amounts from API for all linked items (API -> Ledgr). */
  syncBudgetFromApi: budgetProcedure
    .input(z.object({}).optional())
    .mutation(async ({ ctx }) => {
      const active = await requireActiveBudgetApi(ctx.db);

      // Get current month detail from cache
      const now = ctx.scope.asOf;
      const currentMonth = currentMonthKey(now);
      const monthCache = await cacheGet<BudgetMonthDetail>(
        ctx.db,
        active,
        `months/${currentMonth}`,
      );
      if (!monthCache) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No cached month data. Run Sync first.",
        });
      }

      const apiCategories = new Map(
        monthCache.data.categories.map((c) => [c.id, c]),
      );

      // Use linked profile from apiConnections (consistent with sync.ts orchestrator),
      // falling back to active profile if no linked profile is configured.
      const [conn] = await ctx.db
        .select({
          linkedProfileId: schema.apiConnections.linkedProfileId,
          linkedColumnIndex: schema.apiConnections.linkedColumnIndex,
        })
        .from(schema.apiConnections)
        .where(eq(schema.apiConnections.service, active));
      const allProfiles = await ctx.db.select().from(schema.budgetProfiles);
      const profile = conn?.linkedProfileId
        ? allProfiles.find((p) => p.id === conn.linkedProfileId)
        : allProfiles.find((p) => p.isActive);
      if (!profile)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No linked or active budget profile",
        });
      // Same connection-configured column the preview (sync/preview.ts) and
      // syncBudgetToApi use — a client-sent column would write a number into
      // a column the user never saw in the preview.
      const colIndex = conn?.linkedColumnIndex ?? 0;

      const itemRows = await ctx.db
        .select()
        .from(schema.budgetItems)
        .where(eq(schema.budgetItems.profileId, profile.id));
      const itemLinks = await loadBudgetItemLinks(
        ctx.db,
        itemRows.map((i) => i.id),
        active,
      );
      const items = itemRows.map((i) => {
        const link = itemLinks.get(i.id);
        return {
          ...i,
          apiCategoryId: link?.categoryId ?? null,
          apiCategoryName: link?.categoryName ?? null,
          apiSyncDirection: link?.syncDirection ?? "pull",
        };
      });

      let updated = 0;
      for (const item of items) {
        if (!item.apiCategoryId) continue;
        if (
          item.apiSyncDirection !== "pull" &&
          item.apiSyncDirection !== "both"
        )
          continue;

        const apiCat = apiCategories.get(item.apiCategoryId);
        if (!apiCat) continue;

        // A category with no goal has nothing to pull — writing 0 would
        // wipe the item's amount.
        if (apiCat.goalTarget == null) continue;

        const amounts = budgetAmountsSchema.parse(item.amounts);
        // An item with no amount columns has nowhere to write (index -1).
        if (amounts.length === 0) continue;
        amounts[Math.min(colIndex, amounts.length - 1)] = apiCat.goalTarget;

        await ctx.db
          .update(schema.budgetItems)
          .set({ amounts })
          .where(eq(schema.budgetItems.id, item.id));
        await setBudgetItemLink(ctx.db, {
          budgetItemId: item.id,
          service: active,
          categoryId: item.apiCategoryId,
          categoryName: item.apiCategoryName,
          syncDirection: item.apiSyncDirection,
          lastSyncedAt: writeStamp(),
        });
        updated++;
      }

      return { updated };
    }),

  /** Push budget amounts to API for all linked items (Ledgr -> API). */
  syncBudgetToApi: budgetProcedure
    .input(z.object({}).optional())
    .mutation(async ({ ctx }) => {
      const { service: active, client } = await requireBudgetClient(ctx.db);

      // Use linked profile from apiConnections (consistent with sync.ts orchestrator)
      const [conn] = await ctx.db
        .select({
          linkedProfileId: schema.apiConnections.linkedProfileId,
          linkedColumnIndex: schema.apiConnections.linkedColumnIndex,
        })
        .from(schema.apiConnections)
        .where(eq(schema.apiConnections.service, active));
      const allProfiles = await ctx.db.select().from(schema.budgetProfiles);
      const profile = conn?.linkedProfileId
        ? allProfiles.find((p) => p.id === conn.linkedProfileId)
        : allProfiles.find((p) => p.isActive);
      if (!profile)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No linked or active budget profile",
        });
      // The connection's column, the same one getPreview's `ledgrAmount` uses
      // (sync/preview.ts), so the push matches what the preview showed.
      const colIndex = conn?.linkedColumnIndex ?? 0;

      const pushItemRows = await ctx.db
        .select()
        .from(schema.budgetItems)
        .where(eq(schema.budgetItems.profileId, profile.id));
      const pushItemLinks = await loadBudgetItemLinks(
        ctx.db,
        pushItemRows.map((i) => i.id),
        active,
      );
      const items = pushItemRows.map((i) => {
        const link = pushItemLinks.get(i.id);
        return {
          ...i,
          apiCategoryId: link?.categoryId ?? null,
          apiCategoryName: link?.categoryName ?? null,
          apiSyncDirection: link?.syncDirection ?? "pull",
        };
      });

      const numColumns = profile.columnLabels.length;
      const activeProfiles = await resolveProfileSelection(ctx.scope);
      // Contribution-linked items freeze `amounts` on edit (see
      // resolveLinkedBudgetItemAmounts docblock) — pushing raw `amounts`
      // would push the stale value instead of the profile's live one.
      const resolvedItems = await resolveLinkedBudgetItemAmounts(
        ctx,
        items,
        numColumns,
        activeProfiles,
      );

      // Items the provider can't write ("unsupported") or whose target has
      // another shape ("conflict", see BudgetAPIClient.prepareGoalWrite):
      // counted per item, so "nothing to push" stays distinguishable.
      let skippedUnsupported = 0;
      // Every read before the first write: a read that fails stops the push
      // with nothing written.
      const prepared: {
        item: (typeof resolvedItems)[number];
        write: PreparedGoalWrite;
      }[] = [];
      for (const item of resolvedItems) {
        if (!item.apiCategoryId) continue;
        if (
          item.apiSyncDirection !== "push" &&
          item.apiSyncDirection !== "both"
        )
          continue;

        const amount = item.amounts[Math.min(colIndex, numColumns - 1)] ?? 0;

        // Push as a goal target (plan-level, not month-specific)
        try {
          prepared.push({
            item,
            write: await client.prepareGoalWrite(
              item.apiCategoryId,
              "monthly",
              amount,
            ),
          });
        } catch (err) {
          if (
            err instanceof BudgetApiError &&
            (err.code === "unsupported" || err.code === "conflict")
          ) {
            skippedUnsupported++;
            continue;
          }
          throw nothingChanged(err);
        }
      }

      let pushed = 0;
      let writeError: unknown;
      try {
        for (const { item, write } of prepared) {
          await write.apply();
          pushed++;
          await setBudgetItemLink(ctx.db, {
            budgetItemId: item.id,
            service: active,
            categoryId: item.apiCategoryId!,
            categoryName: item.apiCategoryName,
            syncDirection: item.apiSyncDirection,
            lastSyncedAt: writeStamp(),
          });
        }
      } catch (err) {
        writeError = err;
      }

      // Push writes to the budget app, not budget_api_cache: refresh it so
      // previews show what was just pushed, not pre-push diffs.
      if (pushed > 0) {
        try {
          await refreshCategoryCache(ctx, active, client);
        } catch (err) {
          // Pushes already succeeded remotely — a stale cache must not turn
          // a successful push into a client-visible failure.
          log("error", "post_push_cache_refresh_failed", {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      if (writeError !== undefined)
        // Some targets may already be written: say how many.
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Pushed ${pushed} of ${prepared.length} budget targets, then failed: ${writeError instanceof Error ? writeError.message : String(writeError)}`,
          cause: new WriteStopped(
            `Pushed ${pushed} of ${prepared.length} budget targets`,
            `Pushed ${pushed} of ${prepared.length} budget targets before it stopped.`,
            writeError,
          ),
        });

      return { pushed, skippedUnsupported, service: active };
    }),
};
