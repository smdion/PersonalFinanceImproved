/** Sync mappings router for managing account-level mappings between budget API accounts and local portfolio/asset tracking accounts. */

import { z } from "zod/v4";
import { eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  createTRPCRouter,
  protectedProcedure,
  syncProcedure,
} from "../../trpc";
import * as schema from "@/lib/db/schema";
import {
  getClientForService,
  getActiveBudgetApi,
  getApiConnection,
} from "@/lib/budget-api";
import { accountDisplayName } from "@/lib/utils/format";
import { accountMappingSchema } from "@/lib/db/json-schemas";
import { getApiAccountBalanceMap } from "@/server/helpers/api-balance-resolution";
import { pushSnapshotToBudgetApi } from "@/server/helpers/budget-api-push";
import { serviceEnum } from "./_shared";

export const syncMappingsRouter = createTRPCRouter({
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
        .set({ accountMappings: input.mappings })
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

  /** Push portfolio snapshot balances to budget API tracking accounts. */
  pushPortfolioToApi: syncProcedure
    .input(z.object({ snapshotId: z.number().int().optional() }).optional())
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

      const result = await pushSnapshotToBudgetApi({
        db: ctx.db,
        snapshotId: snapshot.id,
        snapshotDate: snapshot.snapshotDate,
        mappings,
        client,
        mode: "create",
        asOfDate,
      });

      return {
        pushed: result.groupsPosted,
        skipped: result.groupsSkipped,
      };
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
  resyncSnapshot: syncProcedure
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
      // YNAB tracking-account deltas are cumulative, so resyncing an older
      // snapshot leaves later snapshots in an inconsistent state.
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

  /** Pull tracking account balances from budget API into Ledgr asset values. */
  pullAssetsFromApi: syncProcedure.mutation(async ({ ctx }) => {
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

    // Get cached API account balances
    const apiBalanceMap = await getApiAccountBalanceMap(ctx.db, active);
    if (!apiBalanceMap) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "No cached accounts. Run Sync first.",
      });
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
  migrateAccountMappingsToIds: syncProcedure.mutation(async ({ ctx }) => {
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

  /** Pull portfolio balances from budget API tracking accounts into the latest snapshot. */
  pullPortfolioFromApi: syncProcedure
    .input(z.object({ snapshotId: z.number().int().optional() }).optional())
    .mutation(async ({ ctx, input }) => {
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
        (m) =>
          m.performanceAccountId != null &&
          (m.syncDirection === "pull" || m.syncDirection === "both"),
      );
      if (pullMappings.length === 0) {
        return { pulled: 0, message: "No portfolio pull mappings configured" };
      }

      const apiBalanceMap = await getApiAccountBalanceMap(ctx.db, active);
      if (!apiBalanceMap) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No cached accounts. Run Sync first.",
        });
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

      // Get all snapshot accounts for this snapshot
      const snapshotAccounts = await ctx.db
        .select()
        .from(schema.portfolioAccounts)
        .where(eq(schema.portfolioAccounts.snapshotId, snapshot.id));

      let pulled = 0;
      for (const mapping of pullMappings) {
        const apiBalance = apiBalanceMap.get(mapping.remoteAccountId);
        if (apiBalance === undefined) continue;

        // Find all rows in this snapshot matching the performanceAccountId
        const matchingRows = snapshotAccounts.filter(
          (a) => a.performanceAccountId === mapping.performanceAccountId,
        );
        if (matchingRows.length === 0) continue;

        // Calculate current total for this performanceAccountId
        const currentTotal = matchingRows.reduce(
          (s, a) => s + Number(a.amount),
          0,
        );

        if (matchingRows.length === 1) {
          // Single row — set directly
          await ctx.db
            .update(schema.portfolioAccounts)
            .set({ amount: String(apiBalance) })
            .where(eq(schema.portfolioAccounts.id, matchingRows[0]!.id));
        } else {
          // Multiple rows — scale proportionally to preserve sub-account ratios
          const ratio = currentTotal > 0 ? apiBalance / currentTotal : 0;
          for (const row of matchingRows) {
            const scaled = Number(row.amount) * ratio;
            await ctx.db
              .update(schema.portfolioAccounts)
              .set({ amount: String(Math.round(scaled * 100) / 100) })
              .where(eq(schema.portfolioAccounts.id, row.id));
          }
        }
        pulled++;
      }

      return { pulled, snapshotId: snapshot.id };
    }),
});
