import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { eq, asc } from "drizzle-orm";
import {
  createTRPCRouter,
  protectedProcedure,
  adminProcedure,
} from "../../trpc";
import * as schema from "@/lib/db/schema";
import { materializeExtraPaycheckSavings } from "@/server/services/budget/extra-paycheck-materializer";
import { materializeBudgetIncomeAdjustments } from "@/server/services/budget/budget-income-materializer";
import { zCalendarDate } from "@/lib/utils/zod-fields";
import { firstRow } from "@/lib/utils/first-row";

// A job is purely identity/lifecycle now — payPeriod/payWeek/anchorPayDate/
// w4*/bonus-date/bonus-inclusion-flags/budgetPeriodsPerMonth all moved to
// the Salary Profile entry's complete 16-field shape (see salaryEntrySchema
// in json-schemas.ts) and no longer exist as `jobs` columns at all. Salary/
// bonus amounts were already off this table (see resolveCompensation's
// docblock in lib/pure/household/compensation.ts).
const jobInput = z
  .object({
    personId: z.number().int(),
    employerName: z.string().trim().min(1),
    title: z.string().trim().nullable().optional(),
    startDate: zCalendarDate,
    endDate: zCalendarDate.nullable().optional(),
  })
  .refine((data) => !data.endDate || data.endDate >= data.startDate, {
    message: "End date must be on or after start date",
    path: ["endDate"],
  });

// A job carries no salary of its own — creating one establishes no
// compensation at all until a Salary Profile gives it a complete entry
// (see resolveCompensation's docblock in lib/pure/household/compensation.ts).
const jobCreateInput = z.object(jobInput.shape);

export const jobsProcedures = {
  jobs: createTRPCRouter({
    list: protectedProcedure.query(({ ctx }) =>
      ctx.db
        .select()
        .from(schema.jobs)
        .orderBy(asc(schema.jobs.personId), asc(schema.jobs.startDate)),
    ),
    create: adminProcedure
      .input(jobCreateInput)
      .mutation(async ({ ctx, input: jobData }) => {
        const result = await ctx.db
          .insert(schema.jobs)
          .values(jobData)
          .returning()
          .then(firstRow);
        await materializeExtraPaycheckSavings(ctx.db, ctx.scope.asOf);
        await materializeBudgetIncomeAdjustments(ctx.db, ctx.scope.asOf);
        return result;
      }),
    update: adminProcedure
      .input(z.object({ id: z.number().int() }).extend(jobInput.shape))
      .mutation(async ({ ctx, input: { id, ...data } }) => {
        const result = await ctx.db
          .update(schema.jobs)
          .set(data)
          .where(eq(schema.jobs.id, id))
          .returning()
          .then(firstRow);
        await materializeExtraPaycheckSavings(ctx.db, ctx.scope.asOf);
        await materializeBudgetIncomeAdjustments(ctx.db, ctx.scope.asOf);
        return result;
      }),
    delete: adminProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(async ({ ctx, input }) => {
        const existing = await ctx.db
          .select({ isSpeculative: schema.jobs.isSpeculative })
          .from(schema.jobs)
          .where(eq(schema.jobs.id, input.id));
        if (existing[0]?.isSpeculative) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Cannot delete the speculative job — it's a permanent peg for Salary Profile what-if scenarios.",
          });
        }
        await ctx.db.delete(schema.jobs).where(eq(schema.jobs.id, input.id));
        await materializeExtraPaycheckSavings(ctx.db, ctx.scope.asOf);
        await materializeBudgetIncomeAdjustments(ctx.db, ctx.scope.asOf);
        return { ok: true };
      }),
  }),
};
