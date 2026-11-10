import { eq, inArray } from "drizzle-orm";
import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, savingsProcedure } from "../../trpc";
import * as schema from "@/lib/db/schema";
import { zCalendarDate } from "@/lib/utils/zod-fields";
import type { DbOrTx } from "@/lib/db";
import { firstRow } from "@/lib/utils/first-row";

/**
 * Replaces every goal's allocation override in `months` with `allocations`
 * (one per goal). Run inside a transaction so a month is never left with
 * only some goals' overrides.
 */
async function replaceMonthOverrides(
  db: DbOrTx,
  months: string[],
  allocations: { goalId: number; amount: number }[],
): Promise<void> {
  const goalIds = allocations.map((a) => a.goalId);
  if (new Set(goalIds).size !== goalIds.length)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Each fund can appear once per month",
    });
  if (months.length === 0) return;
  await db
    .delete(schema.savingsAllocationOverrides)
    .where(inArray(schema.savingsAllocationOverrides.monthDate, months));
  const rows = months.flatMap((monthDate) =>
    allocations.map((a) => ({
      goalId: a.goalId,
      monthDate,
      amount: String(a.amount),
    })),
  );
  if (rows.length > 0)
    await db.insert(schema.savingsAllocationOverrides).values(rows);
}

export const allocationOverrideProcedures = {
  // ══ ALLOCATION OVERRIDES ══
  allocationOverrides: createTRPCRouter({
    /** Set one fund's allocation for one month; returns the row. */
    upsert: savingsProcedure
      .input(
        z.object({
          goalId: z.number().int(),
          monthDate: zCalendarDate,
          amount: z.number(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        // Upsert: insert or update on conflict
        const existing = await ctx.db
          .select()
          .from(schema.savingsAllocationOverrides)
          .where(eq(schema.savingsAllocationOverrides.goalId, input.goalId))
          .then((rows) => rows.find((r) => r.monthDate === input.monthDate));

        if (existing) {
          return ctx.db
            .update(schema.savingsAllocationOverrides)
            .set({ amount: String(input.amount) })
            .where(eq(schema.savingsAllocationOverrides.id, existing.id))
            .returning()
            .then(firstRow);
        }
        return ctx.db
          .insert(schema.savingsAllocationOverrides)
          .values({
            goalId: input.goalId,
            monthDate: input.monthDate,
            amount: String(input.amount),
          })
          .returning()
          .then(firstRow);
      }),
    /**
     * Remove one fund's allocation override for one month (no-op when there is none).
     */
    delete: savingsProcedure
      .input(z.object({ goalId: z.number().int(), monthDate: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const rows = await ctx.db
          .select()
          .from(schema.savingsAllocationOverrides)
          .where(eq(schema.savingsAllocationOverrides.goalId, input.goalId));
        const target = rows.find((r) => r.monthDate === input.monthDate);
        if (target) {
          await ctx.db
            .delete(schema.savingsAllocationOverrides)
            .where(eq(schema.savingsAllocationOverrides.id, target.id));
        }
        return { ok: true };
      }),
    /** Delete all overrides for ALL goals in one or more months. */
    deleteMonth: savingsProcedure
      .input(
        z.object({
          monthDates: z.array(zCalendarDate),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        if (input.monthDates.length === 0) return { ok: true };
        await ctx.db
          .delete(schema.savingsAllocationOverrides)
          .where(
            inArray(
              schema.savingsAllocationOverrides.monthDate,
              input.monthDates,
            ),
          );
        return { ok: true };
      }),

    /** Atomically upsert overrides for ALL goals in a single month (pool-constrained). */
    upsertMonth: savingsProcedure
      .input(
        z.object({
          monthDate: zCalendarDate,
          allocations: z.array(
            z.object({
              goalId: z.number().int(),
              amount: z.number().min(0),
            }),
          ),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await ctx.db.transaction((tx) =>
          replaceMonthOverrides(tx, [input.monthDate], input.allocations),
        );
        return { ok: true };
      }),

    /** Atomically upsert overrides for ALL goals across a month range (fill-forward). */
    upsertMonthRange: savingsProcedure
      .input(
        z.object({
          startMonth: zCalendarDate,
          endMonth: zCalendarDate.nullable(),
          monthDates: z.array(zCalendarDate),
          allocations: z.array(
            z.object({
              goalId: z.number().int(),
              amount: z.number().min(0),
            }),
          ),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const targetMonths = input.monthDates.filter(
          (md) =>
            md >= input.startMonth &&
            (input.endMonth === null || md <= input.endMonth),
        );

        await ctx.db.transaction((tx) =>
          replaceMonthOverrides(tx, targetMonths, input.allocations),
        );
        return { ok: true };
      }),
  }),
};
