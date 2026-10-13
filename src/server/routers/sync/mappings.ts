/** Sync mappings router for managing account-level mappings between budget API accounts and local portfolio/asset tracking accounts. */

import { z } from "zod/v4";
import { eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, syncProcedure } from "../../trpc";
import * as schema from "@/lib/db/schema";
import {
  getClientForService,
  getActiveBudgetApi,
  getApiConnection,
} from "@/lib/budget-api";
import { mappingsWithTypedIds } from "@/lib/utils/account-mapping";
import { accountMappingSchema } from "@/lib/db/json-schemas";
import { pushSnapshotToBudgetApi } from "@/server/helpers/budget-api-push";
import { serviceEnum } from "./_shared";

export const syncMappingsRouter = createTRPCRouter({
  /** Update account mappings for a service (works pre-activation). */
  updateAccountMappings: syncProcedure
    .input(
      z.object({
        service: serviceEnum,
        mappings: z.array(accountMappingSchema),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(schema.apiConnections)
        .set({ accountMappings: mappingsWithTypedIds(input.mappings) })
        .where(eq(schema.apiConnections.service, input.service));

      return { success: true };
    }),

  /** Create a new Ledgr asset item and add a mapping to a tracking account. */
  createAssetAndMap: syncProcedure
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

  /**
   * Re-push an existing snapshot to the budget API. Deletes any previously
   * posted snapshot:{id}-tagged transactions on currently-mapped tracking
   * accounts, then recomputes deltas against live YNAB balances and posts
   * fresh tagged transactions.
   *
   * Resyncing a non-latest snapshot causes historical drift (later snapshot
   * deltas were computed against the old state). Pass `confirmNonLatest`
   * after warning the user.
   */
  resyncPortfolioPush: syncProcedure
    .input(
      z.object({
        snapshotId: z.number().int().positive(),
        confirmNonLatest: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const asOfDate = new Date();
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
        return {
          posted: 0,
          skipped: 0,
          cleaned: 0,
          message: "No account mappings configured",
        };
      }

      const snapshot = await ctx.db
        .select()
        .from(schema.portfolioSnapshots)
        .where(eq(schema.portfolioSnapshots.id, input.snapshotId))
        .then((r) => r[0]);
      if (!snapshot) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Snapshot ${input.snapshotId} not found`,
        });
      }

      // Block resync of non-latest snapshots unless explicitly confirmed:
      // each push targets an ABSOLUTE balance (`group.total - currentRemote`,
      // read live), so resyncing an OLDER snapshot sets the tracking
      // account to that old snapshot's totals *as of now* — clobbering the
      // current balance with a stale one. Editing/resyncing the latest
      // snapshot is the one safe case (nothing is after it).
      const latest = await ctx.db
        .select({ id: schema.portfolioSnapshots.id })
        .from(schema.portfolioSnapshots)
        .orderBy(sql`${schema.portfolioSnapshots.snapshotDate} DESC`)
        .limit(1)
        .then((r) => r[0]);
      const isLatest = latest?.id === snapshot.id;
      if (!isLatest && !input.confirmNonLatest) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Resyncing a non-latest snapshot causes historical drift in YNAB tracking-account balances. Confirm to proceed.",
        });
      }

      const result = await pushSnapshotToBudgetApi({
        db: ctx.db,
        snapshotId: snapshot.id,
        snapshotDate: snapshot.snapshotDate,
        mappings,
        client,
        mode: "resync",
        asOfDate,
      });

      return {
        posted: result.groupsPosted,
        skipped: result.groupsSkipped,
        cleaned: result.groupsCleaned,
      };
    }),
});
