import { eq, inArray } from "drizzle-orm";
import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, savingsProcedure } from "../../trpc";
import * as schema from "@/lib/db/schema";
import { zCalendarDate } from "@/lib/utils/zod-fields";

export const transferProcedures = {
  // ══ TRANSFERS (paired planned transactions) ══
  transfers: createTRPCRouter({
    /**
     * A transfer between two funds: a withdrawal and a deposit written together under one pair id.
     * Refused within one fund. Returns both legs.
     */
    create: savingsProcedure
      .input(
        z.object({
          fromGoalId: z.number().int(),
          toGoalId: z.number().int(),
          transactionDate: zCalendarDate,
          amount: z.number().positive(),
          description: z.string().min(1),
          isRecurring: z.boolean().default(false),
          recurrenceMonths: z.number().int().min(1).nullable().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        if (input.fromGoalId === input.toGoalId)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "A transfer can't go to the fund it comes from",
          });
        const found = await ctx.db
          .select({ id: schema.savingsGoals.id })
          .from(schema.savingsGoals)
          .where(
            inArray(schema.savingsGoals.id, [input.fromGoalId, input.toGoalId]),
          );
        if (found.length !== 2)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "One of those funds no longer exists",
          });
        const pairId = `xfer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const base = {
          transactionDate: input.transactionDate,
          description: input.description,
          isRecurring: input.isRecurring,
          recurrenceMonths: input.recurrenceMonths ?? null,
          transferPairId: pairId,
        };
        // Both legs or neither.
        return ctx.db.transaction(async (tx) => {
          const [withdrawal] = await tx
            .insert(schema.savingsPlannedTransactions)
            .values({
              ...base,
              goalId: input.fromGoalId,
              amount: String(-input.amount),
            })
            .returning();
          const [deposit] = await tx
            .insert(schema.savingsPlannedTransactions)
            .values({
              ...base,
              goalId: input.toGoalId,
              amount: String(input.amount),
            })
            .returning();
          return { pairId, withdrawal, deposit };
        });
      }),
    delete: savingsProcedure
      .input(z.object({ transferPairId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        await ctx.db
          .delete(schema.savingsPlannedTransactions)
          .where(
            eq(
              schema.savingsPlannedTransactions.transferPairId,
              input.transferPairId,
            ),
          );
        return { ok: true };
      }),
  }),
};
