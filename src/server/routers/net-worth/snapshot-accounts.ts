import { eq } from "drizzle-orm";
import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { portfolioProcedure } from "../../trpc";
import * as schema from "@/lib/db/schema";
import { getLatestSnapshotId } from "@/server/data/snapshots";
import { refreshSnapshotYearDerivatives } from "@/server/services/net-worth/snapshot-derivatives";
import { invalidateYearEndCache } from "@/server/services/net-worth/year-end-history";
import { zDecimal } from "@/lib/utils/zod-fields";
import {
  accountCategoryEnum,
  parentCategoryEnum,
} from "@/lib/config/account-types";
import { PORTFOLIO_TAX_TYPE_VALUES } from "@/lib/config/enum-values";

const snapshotAccountInput = z.object({
  snapshotId: z.number().int(),
  institution: z.string().trim().min(1),
  taxType: z.enum(PORTFOLIO_TAX_TYPE_VALUES),
  amount: zDecimal,
  accountType: z.enum(accountCategoryEnum()),
  subType: z.string().nullable().optional(),
  label: z.string().trim().nullable().optional(),
  parentCategory: z.enum(parentCategoryEnum()).default("Retirement"),
  ownerPersonId: z.number().int().nullable().optional(),
  performanceAccountId: z.number().int().nullable().optional(),
});

export const snapshotAccountProcedures = {
  /**
   * Update one portfolio account row. Metadata edits apply to any snapshot; an `amount`
   * edit only to the latest, re-deriving that year's ending balances + rollups. Older
   * balances are fixed by delete-and-recreate.
   */
  updateAccount: portfolioProcedure
    .input(
      z.object({
        id: z.number().int(),
        ownerPersonId: z.number().int().nullable().optional(),
        isActive: z.boolean().optional(),
        label: z.string().trim().nullable().optional(),
        taxType: z.enum(PORTFOLIO_TAX_TYPE_VALUES).optional(),
        /** Corrected balance. Latest snapshot only. Triggers the
         *  performance recompute + budget-API resync. */
        amount: zDecimal.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const metaUpdates: Record<string, unknown> = {};
      if (input.ownerPersonId !== undefined)
        metaUpdates.ownerPersonId = input.ownerPersonId;
      if (input.isActive !== undefined) metaUpdates.isActive = input.isActive;
      if (input.label !== undefined) metaUpdates.label = input.label || null;
      if (input.taxType !== undefined) metaUpdates.taxType = input.taxType;

      // ── Metadata-only edit: unchanged fast path ──────────────────────
      if (input.amount === undefined) {
        if (Object.keys(metaUpdates).length > 0) {
          await ctx.db
            .update(schema.portfolioAccounts)
            .set(metaUpdates)
            .where(eq(schema.portfolioAccounts.id, input.id));
        }
        return { amountEdited: false as const };
      }

      // ── Balance edit ───────────────────────────────────────────────
      const [row] = await ctx.db
        .select()
        .from(schema.portfolioAccounts)
        .where(eq(schema.portfolioAccounts.id, input.id));
      if (!row) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "That account row no longer exists.",
        });
      }
      const [snap] = await ctx.db
        .select()
        .from(schema.portfolioSnapshots)
        .where(eq(schema.portfolioSnapshots.id, row.snapshotId));
      if (!snap) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "That snapshot no longer exists.",
        });
      }

      if ((await getLatestSnapshotId(ctx.db)) !== snap.id) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Balances can only be edited on the most recent snapshot. " +
            "For an older one, delete it and create a new snapshot.",
        });
      }

      // Write the balance (+ metadata), then re-derive ending balances + rollups
      // from the full row set, as `create` does. A finalized year's Performance
      // figures stay settled.
      const performance = await ctx.db.transaction(async (tx) => {
        await tx
          .update(schema.portfolioAccounts)
          .set({ ...metaUpdates, amount: input.amount })
          .where(eq(schema.portfolioAccounts.id, input.id));

        const allRows = await tx
          .select({
            performanceAccountId: schema.portfolioAccounts.performanceAccountId,
            amount: schema.portfolioAccounts.amount,
          })
          .from(schema.portfolioAccounts)
          .where(eq(schema.portfolioAccounts.snapshotId, snap.id));

        return refreshSnapshotYearDerivatives(tx, snap.snapshotDate, allRows);
      });
      invalidateYearEndCache();

      // No budget-API resync here (slow, rate-limited, non-atomic per edit): the
      // client marks the snapshot dirty and fires one `sync.resyncPortfolioPush`
      // when the user finishes, with a "not synced" banner as the backstop.
      return { amountEdited: true as const, performance };
    }),

  /** Create a new sub-account row in the latest snapshot. */
  createAccount: portfolioProcedure
    .input(snapshotAccountInput)
    .mutation(async ({ ctx, input }) => {
      // Defensive: AddSubAccountForm never sends a performanceAccountId, but a
      // closed account must not get a new balance row out-of-band; an explicit add
      // fails loudly.
      const [snap] = await ctx.db
        .select()
        .from(schema.portfolioSnapshots)
        .where(eq(schema.portfolioSnapshots.id, input.snapshotId));
      if (!snap)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "That snapshot no longer exists.",
        });
      // Same rule as updateAccount: an older snapshot is history.
      if ((await getLatestSnapshotId(ctx.db)) !== snap.id)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Accounts can only be added to the most recent snapshot.",
        });

      // A row linked to a master takes the master's parent category, as
      // every other write does, so Net Worth and Performance group it
      // the same way.
      let parentCategory: string = input.parentCategory;
      if (input.performanceAccountId != null) {
        const [master] = await ctx.db
          .select({
            isActive: schema.performanceAccounts.isActive,
            parentCategory: schema.performanceAccounts.parentCategory,
          })
          .from(schema.performanceAccounts)
          .where(eq(schema.performanceAccounts.id, input.performanceAccountId))
          .limit(1);
        // Defensive (AddSubAccountForm sends no performanceAccountId): a closed
        // account can't get a new balance row; an explicit add fails loudly.
        if (master && !master.isActive) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Cannot add a balance row for a closed account. Reopen the account first.",
          });
        }
        if (master) parentCategory = master.parentCategory;
      }
      const row = await ctx.db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(schema.portfolioAccounts)
          .values({
            snapshotId: input.snapshotId,
            institution: input.institution,
            taxType: input.taxType,
            amount: input.amount,
            accountType: input.accountType,
            subType: input.subType ?? null,
            label: input.label ?? null,
            parentCategory,
            ownerPersonId: input.ownerPersonId ?? null,
            performanceAccountId: input.performanceAccountId ?? null,
            isActive: true,
          })
          .returning();
        // The year's ending balances follow the snapshot, same shared
        // path as create/updateAccount.
        const allRows = await tx
          .select({
            performanceAccountId: schema.portfolioAccounts.performanceAccountId,
            amount: schema.portfolioAccounts.amount,
          })
          .from(schema.portfolioAccounts)
          .where(eq(schema.portfolioAccounts.snapshotId, snap.id));
        await refreshSnapshotYearDerivatives(tx, snap.snapshotDate, allRows);
        return inserted!;
      });
      invalidateYearEndCache();
      return row;
    }),
};
