import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { asc, eq, sql } from "drizzle-orm";
import {
  createTRPCRouter,
  protectedProcedure,
  performanceProcedure,
} from "../../trpc";
import * as schema from "@/lib/db/schema";
import { countRows } from "@/lib/db/compat";
import { canDeletePerformanceAccount } from "@/lib/pure/household/profiles";
import { buildAccountLabel } from "@/lib/utils/format";
import {
  isRetirementParent,
  tracksCostBasis,
  accountCategoryEnum,
  parentCategoryEnum,
} from "@/lib/config/account-types";
import {
  ACCOUNT_OWNERSHIP_VALUES,
  RETIREMENT_BEHAVIOR_VALUES,
  CONTRIBUTION_SCALING_VALUES,
} from "@/lib/config/enum-values";
import {
  captureYearRollups,
  syncYearRollups,
} from "@/server/services/performance/performance-rollups";
import { zDecimal } from "@/lib/utils/zod-fields";
import { dropMappingsTo } from "@/server/data/delete-references";
import { stampPerformanceUpdated } from "@/server/services/performance/last-updated";

const performanceAccountInput = z.object({
  institution: z.string().trim().min(1),
  accountType: z.enum(accountCategoryEnum()),
  subType: z.string().nullable().optional(),
  label: z.string().trim().nullable().optional(),
  displayName: z.string().trim().nullable().optional(),
  ownerPersonId: z.number().int().nullable().optional(),
  ownershipType: z.enum(ACCOUNT_OWNERSHIP_VALUES),
  retirementBehavior: z
    .enum(RETIREMENT_BEHAVIOR_VALUES)
    .default("stops_at_owner_retirement"),
  contributionScaling: z
    .enum(CONTRIBUTION_SCALING_VALUES)
    .default("scales_with_salary"),
  allowPenalizedWithdrawals: z.boolean().default(false),
  costBasis: z.string().default("0"),
  parentCategory: z.enum(parentCategoryEnum()),
  isActive: z.boolean().default(true),
  displayOrder: z.number().int().default(0),
});

export const accountProcedures = {
  updateCostBasis: performanceProcedure
    .input(
      z.object({
        performanceAccountId: z.number().int(),
        costBasis: zDecimal,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(schema.performanceAccounts)
        .set({ costBasis: input.costBasis })
        .where(eq(schema.performanceAccounts.id, input.performanceAccountId));
      return { ok: true };
    }),

  // ---------------------------------------------------------------------------
  // Performance account CRUD — mutations are performanceProcedure
  // ---------------------------------------------------------------------------

  performanceAccounts: createTRPCRouter({
    /** Every performance account, in display order. */
    list: protectedProcedure.query(({ ctx }) =>
      ctx.db
        .select()
        .from(schema.performanceAccounts)
        .orderBy(
          asc(schema.performanceAccounts.displayOrder),
          asc(schema.performanceAccounts.id),
        ),
    ),
    /**
     * Add a performance account, its label built from owner, type and institution; returns it.
     */
    create: performanceProcedure
      .input(performanceAccountInput)
      .mutation(async ({ ctx, input }) => {
        // Resolve owner name for programmatic label
        // Joint accounts always get "Joint" prefix; individual accounts get person name.
        let ownerName: string | null =
          input.ownershipType === "joint" ? "Joint" : null;
        if (input.ownershipType !== "joint" && input.ownerPersonId) {
          const [person] = await ctx.db
            .select({ name: schema.people.name })
            .from(schema.people)
            .where(eq(schema.people.id, input.ownerPersonId));
          ownerName = person?.name ?? null;
        }
        const accountLabel = buildAccountLabel({
          ownerName,
          accountType: input.accountType,
          subType: input.subType ?? null,
          label: input.label ?? null,
          institution: input.institution,
        });
        const [created] = await ctx.db
          .insert(schema.performanceAccounts)
          .values({
            ...input,
            accountLabel,
            ownerPersonId: input.ownerPersonId ?? null,
            subType: input.subType ?? null,
            label: input.label ?? null,
          })
          .returning();
        return created;
      }),
    /**
     * Save an account; its label, owner and category carry to its year rows and linked accounts,
     * year totals follow, and an ineligible one is cleared as the unspent-RMD account.
     */
    update: performanceProcedure
      .input(
        z
          .object({ id: z.number().int() })
          .extend(performanceAccountInput.shape)
          // Not sent = keep it. Cost basis has its own editor
          // (updateCostBasis); a card save that leaves it out used to
          // default it to 0 and wipe a brokerage's basis.
          .extend({ costBasis: zDecimal.optional() }),
      )
      .mutation(async ({ ctx, input: { id, ...data } }) => {
        // Resolve owner name for programmatic label
        // Joint accounts always get "Joint" prefix; individual accounts get person name.
        let ownerName: string | null =
          data.ownershipType === "joint" ? "Joint" : null;
        if (data.ownershipType !== "joint" && data.ownerPersonId) {
          const [person] = await ctx.db
            .select({ name: schema.people.name })
            .from(schema.people)
            .where(eq(schema.people.id, data.ownerPersonId));
          ownerName = person?.name ?? null;
        }
        const accountLabel = buildAccountLabel({
          ownerName,
          accountType: data.accountType,
          subType: data.subType ?? null,
          label: data.label ?? null,
          institution: data.institution,
        });
        // Wrap entire cascade in a transaction for atomicity
        return await ctx.db.transaction(async (tx) => {
          // Each year this account has rows in, as it stands before the
          // change (its type decides which rollup category it counts in).
          const affectedYears = await tx
            .selectDistinct({ year: schema.accountPerformance.year })
            .from(schema.accountPerformance)
            .where(eq(schema.accountPerformance.performanceAccountId, id))
            .orderBy(schema.accountPerformance.year);
          const before = [];
          // One at a time on the transaction's connection, years ascending
          // (each capture takes its year's lock).
          for (const { year } of affectedYears)
            before.push(await captureYearRollups(tx, year));

          // 1. Update the master record
          const [updated] = await tx
            .update(schema.performanceAccounts)
            .set({
              ...data,
              accountLabel,
              ownerPersonId: data.ownerPersonId ?? null,
              subType: data.subType ?? null,
              label: data.label ?? null,
            })
            .where(eq(schema.performanceAccounts.id, id))
            .returning();
          if (!updated) return null;

          // 2. Cascade denormalized fields to accountPerformance rows
          await tx
            .update(schema.accountPerformance)
            .set({
              institution: updated.institution,
              accountLabel: updated.accountLabel,
              ownerPersonId: updated.ownerPersonId,
              parentCategory: updated.parentCategory,
            })
            .where(eq(schema.accountPerformance.performanceAccountId, id));

          // 3. Cascade parentCategory to linked contributionAccounts
          await tx
            .update(schema.contributionAccounts)
            .set({ parentCategory: updated.parentCategory })
            .where(eq(schema.contributionAccounts.performanceAccountId, id));

          // 4. Cascade parentCategory to linked portfolioAccounts
          await tx
            .update(schema.portfolioAccounts)
            .set({ parentCategory: updated.parentCategory })
            .where(eq(schema.portfolioAccounts.performanceAccountId, id));

          // 5. An account that stops being an active Retirement brokerage
          // stops being the unspent-RMD account in every Retirement Profile
          // (left set, the old pick would quietly return if it changed back).
          if (
            !updated.isActive ||
            !tracksCostBasis(updated.accountType) ||
            !isRetirementParent(updated.parentCategory)
          )
            await tx
              .update(schema.retirementSettings)
              .set({ rmdExcessTargetPerformanceAccountId: null })
              .where(
                eq(
                  schema.retirementSettings.rmdExcessTargetPerformanceAccountId,
                  id,
                ),
              );

          // 6. Keep every affected year's rollups in step (a type change
          // moves the account's figures between categories)
          for (const b of before) await syncYearRollups(tx, b);

          // 7. Stamp performance_last_updated for cache invalidation
          await stampPerformanceUpdated(tx);

          return updated;
        });
      }),
    /**
     * Refused while it has year rows or holding periods; linked contribution and snapshot accounts
     * are unlinked, and its budget-API mappings dropped.
     */
    delete: performanceProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(async ({ ctx, input }) => {
        // Pre-check: accountPerformance FK is RESTRICT — validate before hitting DB error
        const perfCountRows = await ctx.db
          .select({ count: sql<number>`count(*)` })
          .from(schema.accountPerformance)
          .where(eq(schema.accountPerformance.performanceAccountId, input.id));
        const perfCount = countRows(perfCountRows);
        // holding_periods FK is RESTRICT as well.
        const periodCountRows = await ctx.db
          .select({ count: sql<number>`count(*)` })
          .from(schema.holdingPeriods)
          .where(eq(schema.holdingPeriods.performanceAccountId, input.id));
        const deleteCheck = canDeletePerformanceAccount(
          perfCount,
          countRows(periodCountRows),
        );
        if (!deleteCheck.allowed) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: deleteCheck.reason!,
          });
        }

        // contributionAccounts and portfolioAccounts use SET NULL — they'll
        // be unlinked; its budget-API mappings live in JSON and go here.
        await ctx.db.transaction(async (tx) => {
          await dropMappingsTo(tx, { performanceAccountId: input.id });
          await tx
            .delete(schema.performanceAccounts)
            .where(eq(schema.performanceAccounts.id, input.id));
        });
        return { ok: true };
      }),
  }),
};
