import { eq, desc } from "drizzle-orm";
import { z } from "zod/v4";
import { protectedProcedure, portfolioProcedure } from "../../trpc";
import * as schema from "@/lib/db/schema";
import { zCalendarDate, zDecimal } from "@/lib/utils/zod-fields";
import {
  accountCategoryEnum,
  parentCategoryEnum,
} from "@/lib/config/account-types";
import { PORTFOLIO_TAX_TYPE_VALUES } from "@/lib/config/enum-values";
import { createPortfolioSnapshot } from "@/server/services/net-worth/snapshot-write";

const portfolioSnapshotInput = z.object({
  snapshotDate: zCalendarDate,
  notes: z.string().nullable().optional(),
  accounts: z.array(
    z.object({
      institution: z.string().trim().min(1),
      taxType: z.enum(PORTFOLIO_TAX_TYPE_VALUES),
      accountType: z.enum(accountCategoryEnum()),
      subType: z.string().nullable().optional(),
      label: z.string().trim().nullable().optional(),
      parentCategory: z.enum(parentCategoryEnum()).default("Retirement"),
      amount: zDecimal,
      ownerPersonId: z.number().int().nullable(),
      performanceAccountId: z.number().int().nullable().optional(),
    }),
  ),
});

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
    const accounts = await ctx.db
      .select()
      .from(schema.portfolioAccounts)
      .where(eq(schema.portfolioAccounts.snapshotId, latest.id));
    return { snapshot: latest, accounts };
  }),

  /** Create a new snapshot with all its accounts in a single call. */
  create: portfolioProcedure
    .input(portfolioSnapshotInput)
    .mutation(({ ctx, input }) => createPortfolioSnapshot(ctx, input)),

  /** Delete a snapshot (cascades to its accounts). */
  delete: portfolioProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(({ ctx, input }) =>
      ctx.db
        .delete(schema.portfolioSnapshots)
        .where(eq(schema.portfolioSnapshots.id, input.id)),
    ),
};
