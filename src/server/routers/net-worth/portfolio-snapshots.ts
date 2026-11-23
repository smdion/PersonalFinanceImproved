import { eq, desc } from "drizzle-orm";
import { z } from "zod/v4";
import { protectedProcedure, portfolioProcedure } from "../../trpc";
import * as schema from "@/lib/db/schema";
import { portfolioSnapshotInput } from "./portfolio-snapshot-input";
import { createCheckedPortfolioSnapshot } from "./snapshot-tax-types";
import { getSnapshotRows } from "@/server/data/snapshot-rows";

export const portfolioSnapshotProcedures = {
  /** Get the latest snapshot with its accounts (for pre-filling a new snapshot form). */
  getLatest: protectedProcedure.query(async ({ ctx }) => {
    const snapshots = await ctx.db
      .select()
      .from(schema.portfolioSnapshots)
      .orderBy(desc(schema.portfolioSnapshots.snapshotDate))
      .limit(1);
    const latest = snapshots[0];
    if (!latest) return null;
    const accounts = await getSnapshotRows(ctx.db, latest.id);
    return { snapshot: latest, accounts };
  }),

  /** Create a new snapshot with all its accounts in a single call. */
  create: portfolioProcedure
    .input(portfolioSnapshotInput)
    .mutation(({ ctx, input }) => createCheckedPortfolioSnapshot(ctx, input)),

  /** Delete a snapshot (cascades to its accounts). */
  delete: portfolioProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(({ ctx, input }) =>
      ctx.db
        .delete(schema.portfolioSnapshots)
        .where(eq(schema.portfolioSnapshots.id, input.id)),
    ),
};
