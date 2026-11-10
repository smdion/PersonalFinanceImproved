import { eq } from "drizzle-orm";
import { log } from "@/lib/logger";
import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { budgetProcedure } from "../../trpc";
import * as schema from "@/lib/db/schema";
import { canRemoveColumn } from "@/lib/pure/household/profiles";
import {
  columnLabelsSchema,
  columnMonthsSchema,
  budgetAmountsSchema,
} from "@/lib/db/shapes/json-schemas";
import { requireBudgetProfile } from "@/server/services/budget/budget-client";
import { lockedBudgetProfile } from "@/server/data/locked-budget-profile";
import type { Db, DbOrTx } from "@/lib/db";

type BudgetProfileRow = typeof schema.budgetProfiles.$inferSelect;

/** Runs a column edit in one transaction on the target profile (active if
 *  not given), read under its row lock, so column edits merge one at a time. */
async function editLockedProfile(
  db: Db,
  profileId: number | undefined,
  edit: (tx: DbOrTx, profile: BudgetProfileRow) => Promise<void>,
): Promise<{ ok: true }> {
  const target = await requireBudgetProfile(db, profileId);
  await db.transaction(async (tx) => {
    const profile = await lockedBudgetProfile(tx, target.id);
    if (!profile)
      throw new TRPCError({ code: "NOT_FOUND", message: "Profile not found" });
    await edit(tx, profile);
  });
  return { ok: true };
}

export const columnProcedures = {
  /** Add a new column (budget mode) to the target profile (active if not given). */
  addColumn: budgetProcedure
    .input(
      z.object({ label: z.string().min(1), profileId: z.number().optional() }),
    )
    .mutation(({ ctx, input }) =>
      // Atomic: the new column must land on the profile AND on every item's
      // amounts array together, or the budget is left ragged.
      editLockedProfile(ctx.db, input.profileId, async (tx, profile) => {
        const newLabels = columnLabelsSchema.parse([
          ...profile.columnLabels,
          input.label,
        ]);
        const newMonths = profile.columnMonths
          ? columnMonthsSchema.parse([...(profile.columnMonths as number[]), 0])
          : null;
        await tx
          .update(schema.budgetProfiles)
          .set({
            columnLabels: newLabels,
            columnMonths: newMonths,
          })
          .where(eq(schema.budgetProfiles.id, profile.id));

        // Add a 0 to each item's amounts array
        const items = await tx
          .select()
          .from(schema.budgetItems)
          .where(eq(schema.budgetItems.profileId, profile.id));
        for (const item of items) {
          const amounts = budgetAmountsSchema.parse([
            ...(item.amounts as number[]),
            0,
          ]);
          await tx
            .update(schema.budgetItems)
            .set({ amounts })
            .where(eq(schema.budgetItems.id, item.id));
        }
      }),
    ),

  /** Remove a column (budget mode) from the target profile (active if not given). */
  removeColumn: budgetProcedure
    .input(
      z.object({
        colIndex: z.number().int().min(0),
        profileId: z.number().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      // Atomic: drop the column from the profile AND from every item's
      // amounts array together (see addColumn).
      editLockedProfile(ctx.db, input.profileId, async (tx, profile) => {
        const colCheck = canRemoveColumn(
          profile.columnLabels.length,
          input.colIndex,
        );
        if (!colCheck.allowed)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: colCheck.reason,
          });
        const newLabels = columnLabelsSchema.parse(
          profile.columnLabels.filter(
            (_: string, i: number) => i !== input.colIndex,
          ),
        );
        const newMonths = profile.columnMonths
          ? columnMonthsSchema.parse(
              (profile.columnMonths as number[]).filter(
                (_: number, i: number) => i !== input.colIndex,
              ),
            )
          : null;
        await tx
          .update(schema.budgetProfiles)
          .set({
            columnLabels: newLabels,
            columnMonths: newMonths,
          })
          .where(eq(schema.budgetProfiles.id, profile.id));

        // Remove the column from each item's amounts array
        const items = await tx
          .select()
          .from(schema.budgetItems)
          .where(eq(schema.budgetItems.profileId, profile.id));
        for (const item of items) {
          const amounts = budgetAmountsSchema.parse(
            (item.amounts as number[]).filter(
              (_: number, i: number) => i !== input.colIndex,
            ),
          );
          await tx
            .update(schema.budgetItems)
            .set({ amounts })
            .where(eq(schema.budgetItems.id, item.id));
        }
      }),
    ),

  /** Rename a column (budget mode). */
  renameColumn: budgetProcedure
    .input(
      z.object({
        colIndex: z.number().int().min(0),
        label: z.string().trim().min(1),
        profileId: z.number().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      editLockedProfile(ctx.db, input.profileId, async (tx, profile) => {
        if (input.colIndex >= profile.columnLabels.length)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Invalid column index",
          });
        const newLabels = [...profile.columnLabels];
        newLabels[input.colIndex] = input.label;
        await tx
          .update(schema.budgetProfiles)
          .set({ columnLabels: columnLabelsSchema.parse(newLabels) })
          .where(eq(schema.budgetProfiles.id, profile.id));
      }),
    ),

  /** Update column months for weighted budget profiles. */
  updateColumnMonths: budgetProcedure
    .input(
      z.object({
        columnMonths: columnMonthsSchema,
        profileId: z.number().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      editLockedProfile(ctx.db, input.profileId, async (tx, profile) => {
        if (input.columnMonths) {
          if (input.columnMonths.length !== profile.columnLabels.length) {
            log("warn", "budget_column_mismatch", {
              field: "columnMonths",
              expected: profile.columnLabels.length,
              got: input.columnMonths.length,
            });
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "This budget's columns changed — reload and try again.",
            });
          }
          const sum = input.columnMonths.reduce((s, m) => s + m, 0);
          if (sum !== 12) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Column months must sum to 12 (got ${sum}) — the weighted annual total assumes a full year.`,
            });
          }
        }
        await tx
          .update(schema.budgetProfiles)
          .set({ columnMonths: input.columnMonths })
          .where(eq(schema.budgetProfiles.id, profile.id));
      }),
    ),
};
