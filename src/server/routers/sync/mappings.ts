/** Sync mappings router for managing account-level mappings between budget API accounts and local portfolio/asset tracking accounts. */

import { z } from "zod/v4";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { adminProcedure, createTRPCRouter, syncProcedure } from "../../trpc";
import * as schema from "@/lib/db/schema";
import { getLatestSnapshotId } from "@/server/data/latest-snapshot";
import type { AccountMapping } from "@/lib/db/schema";
import { getApiConnection } from "@/lib/budget-api";
import { requireBudgetClient } from "@/server/services/budget/budget-client";
import {
  allowedDirectionsForMapping,
  isPullMapping,
  localTargetsPulledTwice,
  mappingsWithTypedIds,
  remotesPulledTwice,
} from "@/lib/pure/sync/account-mapping";
import { clearUnmappedPulledBalances } from "@/server/services/sync/apply-pull-mapping";
import { accountMappingSchema } from "@/lib/db/shapes/json-schemas";
import { pushSnapshotToBudgetApi } from "@/server/services/sync/budget-api-push";
import { formatList } from "@/lib/utils/format";
import { serviceEnum } from "./_shared";
import { toDecimalColumn } from "@/lib/utils/math";
import { firstRow } from "@/lib/utils/first-row";

/** Why a mapping's direction isn't allowed for its target, or null when it
 *  is. Names the account by its localName, never a raw id. */
function disallowedDirectionMessage(m: AccountMapping): string | null {
  const allowed = allowedDirectionsForMapping(m);
  if (allowed.includes(m.syncDirection)) return null;
  return `${m.localName} can only be synced ${allowed.join(" or ")}, not ${m.syncDirection}`;
}

export const syncMappingsRouter = createTRPCRouter({
  /** Update account mappings for a service (works pre-activation). */
  updateAccountMappings: adminProcedure
    .input(
      z.object({
        service: serviceEnum,
        mappings: z.array(accountMappingSchema).superRefine((mappings, c) => {
          // Each target takes only some directions (a portfolio account is
          // push only, Cash/Credit Card/debts pull only).
          for (const m of mappings) {
            const message = disallowedDirectionMessage(m);
            if (message) c.addIssue({ code: "custom", message });
          }
          // One pulled balance per budget account: pulled into two places
          // (a credit card and a debt, say) it would count twice.
          for (const remote of remotesPulledTwice(mappings)) {
            const places = mappings
              .filter((m) => m.remoteAccountId === remote && isPullMapping(m))
              .map((m) => m.localName);
            c.addIssue({
              code: "custom",
              message: `One budget account is pulled into ${formatList(places)} — keep one pull mapping for it`,
            });
          }
          // One pulled balance per Ledgr row: two would overwrite each
          // other every sync, the last one silently winning.
          for (const target of localTargetsPulledTwice(mappings)) {
            const name =
              mappings.find((m) => m.localId === target)?.localName ?? target;
            c.addIssue({
              code: "custom",
              message: `${name} is pulled from more than one budget account — keep one pull mapping for it`,
            });
          }
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const before = await getApiConnection(ctx.db, input.service);
      const typed = mappingsWithTypedIds(input.mappings);
      await ctx.db
        .update(schema.apiConnections)
        .set({ accountMappings: typed })
        .where(eq(schema.apiConnections.service, input.service));
      await clearUnmappedPulledBalances(ctx.db);
      // Mapping a home's value is the choice to use it, once. After that
      // pulls leave the household's purchase/estimated setting alone.
      const hadValue = new Set(
        mappingsWithTypedIds(before?.accountMappings ?? []).flatMap((m) =>
          m.loanMapType === "propertyValue" && m.loanId != null
            ? [m.loanId]
            : [],
        ),
      );
      for (const m of typed)
        if (
          m.loanMapType === "propertyValue" &&
          m.loanId != null &&
          isPullMapping(m) &&
          !hadValue.has(m.loanId)
        )
          await ctx.db
            .update(schema.mortgageLoans)
            .set({ usePurchaseOrEstimated: "estimated" })
            .where(eq(schema.mortgageLoans.id, m.loanId));

      return { ok: true };
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
      const currentYear = ctx.scope.asOf.getFullYear();

      // Same direction rule as updateAccountMappings, checked before any write.
      const directionProblem = disallowedDirectionMessage({
        localId: "asset:0",
        localName: input.assetName,
        remoteAccountId: input.remoteAccountId,
        syncDirection: input.syncDirection,
      });
      if (directionProblem)
        throw new TRPCError({ code: "BAD_REQUEST", message: directionProblem });

      // Create or update the asset item
      const insertResult = await ctx.db
        .insert(schema.otherAssetItems)
        .values({
          name: input.assetName,
          year: currentYear,
          value: toDecimalColumn(input.balance, "a tracking account balance"),
          note: `Created from ${input.service.toUpperCase()} tracking account`,
        })
        .onConflictDoUpdate({
          target: [schema.otherAssetItems.name, schema.otherAssetItems.year],
          set: {
            value: toDecimalColumn(input.balance, "a tracking account balance"),
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

      return { ok: true };
    }),

  /**
   * Re-push an existing snapshot: deletes its snapshot:{id}-tagged transactions on mapped
   * tracking accounts, then posts fresh deltas against live balances. A non-latest
   * snapshot requires `confirmNonLatest` after warning the user.
   */
  resyncPortfolioPush: syncProcedure
    .input(
      z.object({
        snapshotId: z.number().int().positive(),
        confirmNonLatest: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const asOfDate = ctx.scope.asOf;
      const { service: active, client } = await requireBudgetClient(ctx.db);

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
        .then(firstRow);
      if (!snapshot) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Snapshot ${input.snapshotId} not found`,
        });
      }

      // A push sets an ABSOLUTE balance, so resyncing an older snapshot would
      // overwrite today's tracking balance with stale totals: only the latest
      // resyncs without an explicit confirm.
      const isLatest = (await getLatestSnapshotId(ctx.db)) === snapshot.id;
      if (!isLatest && !input.confirmNonLatest) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Resyncing a non-latest snapshot causes historical drift in budget tracking-account balances. Confirm to proceed.",
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
