/** Analytics router — per-account holdings entry, allocation vs. glide-path target, drift, and blended expense ratio. */
import { z } from "zod/v4";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { createTRPCRouter, portfolioProcedure } from "../trpc";
import * as schema from "@/lib/db/schema";
import { ANALYTICS_HISTORY_SNAPSHOT_LIMIT } from "@/lib/constants";
import { FMP_SECTOR_TO_ASSET_CLASS } from "@/lib/config/fmp-sector-map";

// ---------------------------------------------------------------------------
// Shared Zod schemas
// ---------------------------------------------------------------------------

const HoldingInputSchema = z.object({
  ticker: z.string().min(1),
  name: z.string().min(1),
  weightBps: z.number().int().min(0).max(10000),
  expenseRatio: z.string().nullable().optional(),
  assetClassId: z.number().int().nullable().optional(),
  assetClassSource: z.enum(["fmp", "manual"]).default("manual"),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const analyticsRouter = createTRPCRouter({
  /**
   * Get all holdings for a given snapshot (or the latest snapshot that has holdings).
   * Only returns holdings for isActive = true performance_accounts.
   */
  getHoldings: portfolioProcedure
    .input(z.object({ snapshotId: z.number().int().optional() }))
    .query(async ({ ctx, input }) => {
      let snapshotId = input.snapshotId;

      if (snapshotId === undefined) {
        // Find the latest snapshot that has at least one holding
        const latest = await ctx.db
          .select({ snapshotId: schema.accountHoldings.snapshotId })
          .from(schema.accountHoldings)
          .orderBy(desc(schema.accountHoldings.snapshotId))
          .limit(1);
        if (latest.length === 0) return [];
        snapshotId = latest[0]!.snapshotId;
      }

      // Get active performance accounts
      const activeAccounts = await ctx.db
        .select({ id: schema.performanceAccounts.id })
        .from(schema.performanceAccounts)
        .where(eq(schema.performanceAccounts.isActive, true));
      const activeIds = activeAccounts.map((a) => a.id);
      if (activeIds.length === 0) return [];

      return ctx.db
        .select()
        .from(schema.accountHoldings)
        .where(
          and(
            eq(schema.accountHoldings.snapshotId, snapshotId),
            inArray(schema.accountHoldings.performanceAccountId, activeIds),
          ),
        )
        .orderBy(
          asc(schema.accountHoldings.performanceAccountId),
          asc(schema.accountHoldings.ticker),
        );
    }),

  /**
   * Bulk upsert holdings for one account+snapshot in a single round-trip.
   * Replaces the entire set for that account+snapshot (delete-then-insert in a transaction).
   */
  bulkUpsertHoldings: portfolioProcedure
    .input(
      z.object({
        performanceAccountId: z.number().int(),
        snapshotId: z.number().int(),
        holdings: z.array(HoldingInputSchema),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const rows = input.holdings.map((h) => ({
        performanceAccountId: input.performanceAccountId,
        snapshotId: input.snapshotId,
        ticker: h.ticker.toUpperCase(),
        name: h.name,
        weightBps: h.weightBps,
        expenseRatio: h.expenseRatio ?? null,
        assetClassId: h.assetClassId ?? null,
        assetClassSource: h.assetClassSource,
      }));

      return ctx.db.transaction(async (tx) => {
        // Delete existing holdings for this account+snapshot
        await tx
          .delete(schema.accountHoldings)
          .where(
            and(
              eq(
                schema.accountHoldings.performanceAccountId,
                input.performanceAccountId,
              ),
              eq(schema.accountHoldings.snapshotId, input.snapshotId),
            ),
          );

        if (rows.length === 0) return [];

        return tx.insert(schema.accountHoldings).values(rows).returning();
      });
    }),

  /**
   * Delete one holding by id.
   */
  deleteHolding: portfolioProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(schema.accountHoldings)
        .where(eq(schema.accountHoldings.id, input.id));
      return { success: true as const };
    }),

  /**
   * Snapshot-copy: duplicate all holdings from snapshot A to snapshot B.
   * Returns { count: 0 } (not an error) when the source snapshot has no holdings.
   */
  copyHoldingsToSnapshot: portfolioProcedure
    .input(
      z.object({
        fromSnapshotId: z.number().int(),
        toSnapshotId: z.number().int(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const source = await ctx.db
        .select()
        .from(schema.accountHoldings)
        .where(eq(schema.accountHoldings.snapshotId, input.fromSnapshotId));

      if (source.length === 0) return { count: 0 };

      const rows = source.map(({ id: _id, snapshotId: _snap, ...rest }) => ({
        ...rest,
        snapshotId: input.toSnapshotId,
      }));

      await ctx.db
        .insert(schema.accountHoldings)
        .values(rows)
        .onConflictDoNothing(); // skip duplicates if some already copied

      return { count: rows.length };
    }),

  /**
   * Fetch holdings across multiple snapshots for historical allocation/drift charts.
   * Only returns snapshots that actually have ≥1 holding.
   */
  getHoldingsHistory: portfolioProcedure
    .input(z.object({ limit: z.number().int().min(1).optional() }))
    .query(async ({ ctx, input }) => {
      const limit = input.limit ?? ANALYTICS_HISTORY_SNAPSHOT_LIMIT;

      // Find the most recent N snapshots that have holdings
      const snapshots = await ctx.db
        .selectDistinct({ snapshotId: schema.accountHoldings.snapshotId })
        .from(schema.accountHoldings)
        .orderBy(desc(schema.accountHoldings.snapshotId))
        .limit(limit);

      if (snapshots.length === 0) return [];

      const snapshotIds = snapshots.map((s) => s.snapshotId);

      // Fetch snapshot dates
      const snapshotRows = await ctx.db
        .select({
          id: schema.portfolioSnapshots.id,
          snapshotDate: schema.portfolioSnapshots.snapshotDate,
        })
        .from(schema.portfolioSnapshots)
        .where(inArray(schema.portfolioSnapshots.id, snapshotIds));

      const snapshotDateById = new Map(
        snapshotRows.map((r) => [r.id, r.snapshotDate]),
      );

      // Fetch all holdings for those snapshots
      const holdings = await ctx.db
        .select()
        .from(schema.accountHoldings)
        .where(inArray(schema.accountHoldings.snapshotId, snapshotIds))
        .orderBy(
          asc(schema.accountHoldings.snapshotId),
          asc(schema.accountHoldings.performanceAccountId),
          asc(schema.accountHoldings.ticker),
        );

      // Group holdings by snapshotId
      const grouped = new Map<number, (typeof holdings)[number][]>();
      for (const h of holdings) {
        const arr = grouped.get(h.snapshotId) ?? [];
        arr.push(h);
        grouped.set(h.snapshotId, arr);
      }

      return snapshotIds
        .map((id) => ({
          snapshotId: id,
          snapshotDate: snapshotDateById.get(id) ?? "",
          holdings: grouped.get(id) ?? [],
        }))
        .sort((a, b) => a.snapshotId - b.snapshotId); // chronological
    }),

  /**
   * FMP ticker lookup — resolves name, expense ratio, sector, and suggested asset class.
   * API key is read server-side from api_connections; never exposed to the client.
   *
   * Distinguishes error types so the UI can show the right message:
   *   no_key    — FMP connection not configured (suppress "Look up" button on the client)
   *   not_found — ticker not found in FMP
   *   rate_limit — FMP 429 (250/day free tier exhausted)
   *   error     — any other FMP or network failure
   */
  lookupTicker: portfolioProcedure
    .input(z.object({ ticker: z.string().min(1).max(20) }))
    .query(async ({ ctx, input }) => {
      // Fetch FMP API key from api_connections
      const conn = await ctx.db
        .select({ config: schema.apiConnections.config })
        .from(schema.apiConnections)
        .where(eq(schema.apiConnections.service, "fmp"))
        .limit(1);

      const apiKey = conn[0]?.config?.apiKey;
      if (!apiKey) {
        return { error: "no_key" as const };
      }

      const ticker = input.ticker.toUpperCase();

      try {
        const res = await fetch(
          `https://financialmodelingprep.com/api/v3/profile/${ticker}?apikey=${apiKey}`,
        );

        if (res.status === 429) {
          return { error: "rate_limit" as const };
        }

        if (!res.ok) {
          return { error: "error" as const };
        }

        const data = (await res.json()) as Array<{
          companyName?: string;
          sector?: string;
          expenseRatio?: number;
          price?: number;
        }>;

        if (!Array.isArray(data) || data.length === 0) {
          return { error: "not_found" as const };
        }

        const profile = data[0]!;
        const sector = profile.sector ?? undefined;
        const suggestedAssetClassName =
          sector !== undefined
            ? (FMP_SECTOR_TO_ASSET_CLASS[sector] ?? undefined)
            : undefined;

        return {
          name: profile.companyName ?? ticker,
          expenseRatio:
            profile.expenseRatio !== undefined
              ? profile.expenseRatio
              : undefined,
          sector,
          suggestedAssetClassName: suggestedAssetClassName ?? undefined,
        };
      } catch {
        return { error: "error" as const };
      }
    }),

  /**
   * Get all active performance accounts (used to build the account list on the page).
   */
  getAccounts: portfolioProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select()
      .from(schema.performanceAccounts)
      .where(eq(schema.performanceAccounts.isActive, true))
      .orderBy(
        asc(schema.performanceAccounts.displayOrder),
        asc(schema.performanceAccounts.institution),
      );
  }),

  /**
   * Get all portfolio snapshots (for the snapshot selector).
   */
  getSnapshots: portfolioProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select()
      .from(schema.portfolioSnapshots)
      .orderBy(desc(schema.portfolioSnapshots.snapshotDate));
  }),

  /**
   * Get all asset class params (for the asset class dropdown).
   */
  getAssetClasses: portfolioProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select()
      .from(schema.assetClassParams)
      .where(eq(schema.assetClassParams.isActive, true))
      .orderBy(asc(schema.assetClassParams.sortOrder));
  }),

  /**
   * Get glide path allocations for a specific age (for drift computation).
   * Returns an empty array if no glide path is configured.
   */
  getGlidePathForAge: portfolioProcedure
    .input(z.object({ age: z.number().int().min(0).max(120) }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select({
          assetClassId: schema.glidePathAllocations.assetClassId,
          allocation: schema.glidePathAllocations.allocation,
        })
        .from(schema.glidePathAllocations)
        .where(eq(schema.glidePathAllocations.age, input.age));
    }),

  /**
   * Get portfolio account balances for a given snapshot (to compute dollar values from weights).
   */
  getSnapshotBalances: portfolioProcedure
    .input(z.object({ snapshotId: z.number().int() }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select({
          performanceAccountId: schema.portfolioAccounts.performanceAccountId,
          amount: schema.portfolioAccounts.amount,
        })
        .from(schema.portfolioAccounts)
        .where(
          and(
            eq(schema.portfolioAccounts.snapshotId, input.snapshotId),
            eq(schema.portfolioAccounts.isActive, true),
          ),
        );
    }),

  /**
   * Check whether an FMP connection is configured (used to show/hide the Look up button).
   * Returns true if a key exists, false otherwise.
   */
  hasFmpKey: portfolioProcedure.query(async ({ ctx }) => {
    const conn = await ctx.db
      .select({ config: schema.apiConnections.config })
      .from(schema.apiConnections)
      .where(eq(schema.apiConnections.service, "fmp"))
      .limit(1);
    return !!conn[0]?.config?.apiKey;
  }),
});
