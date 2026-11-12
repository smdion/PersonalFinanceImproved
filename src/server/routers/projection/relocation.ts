/**
 * Engine-backed relocation projection (current vs relocation budget, earliest safe move
 * year, year-by-year rows, optional blended run switching at moveYear), plus CRUD for
 * the Tools page's saved relocation scenarios, and the Relocation tool's analysis.
 */
import { z } from "zod/v4";
import { zMoneyNumber, zYear } from "@/lib/utils/zod-fields";
import { eq, desc } from "drizzle-orm";
import {
  createTRPCRouter,
  protectedProcedure,
  adminProcedure,
} from "../../trpc";
import * as schema from "@/lib/db/schema";
import { relocationScenarioParamsSchema } from "@/lib/db/shapes/json-schemas";
import { firstRow } from "@/lib/utils/first-row";
import { writeStamp } from "@/lib/utils/clock";
import { computeRelocationFiProjection } from "@/server/services/projection/relocation-projection";
import { relocationAnalysisProcedures } from "./relocation-analysis";

export const relocationProjectionRouter = createTRPCRouter({
  ...relocationAnalysisProcedures,
  /**
   * Runs the full projection engine for current vs relocation scenarios to find the earliest
   * year the user can move and still retire at retirementAge; returns comparison rows and,
   * with moveYear, a blended projection switching paths at that year.
   */
  computeRelocationFiProjection: protectedProcedure
    .input(
      z.object({
        currentProfileId: z.number().int(),
        currentBudgetColumn: z.number().int().min(0),
        currentExpenseOverride: zMoneyNumber.min(0).nullable().default(null),
        currentContributionProfileId: z.number().int().nullable().default(null),
        relocationProfileId: z.number().int(),
        relocationBudgetColumn: z.number().int().min(0),
        relocationExpenseOverride: zMoneyNumber.min(0).nullable().default(null),
        relocationContributionProfileId: z
          .number()
          .int()
          .nullable()
          .default(null),
        // One Salary Profile for both scenarios; null: the active one.
        salaryProfileId: z.number().int().nullable().default(null),
        yearAdjustments: z
          .array(
            z.object({
              year: zYear,
              monthlyExpenses: zMoneyNumber.min(0),
            }),
          )
          .default([]),
        largePurchases: z
          .array(
            z.object({
              purchaseYear: zYear,
              purchasePrice: zMoneyNumber.min(0),
              downPaymentPercent: z
                .number()
                .min(0)
                .max(1)
                .nullable()
                .default(null),
              loanRate: z.number().min(0).nullable().default(null),
              loanTermYears: z.number().int().min(0).nullable().default(null),
              ongoingMonthlyCost: zMoneyNumber.min(0).nullable().default(null),
              saleProceeds: zMoneyNumber.min(0).nullable().default(null),
            }),
          )
          .default([]),
        moveYear: zYear.nullable().default(null),
      }),
    )
    .query(({ ctx, input }) => computeRelocationFiProjection(ctx, input)),

  relocationScenarios: createTRPCRouter({
    /** The Relocation tool's saved comparisons, newest first. */
    list: protectedProcedure.query(({ ctx }) =>
      ctx.db
        .select()
        .from(schema.relocationScenarios)
        .orderBy(desc(schema.relocationScenarios.updatedAt)),
    ),
    /** Save a Relocation comparison: a new one, or the one `id` names; returns the row. */
    save: adminProcedure
      .input(
        z.object({
          id: z.number().int().optional(),
          name: z.string().min(1),
          params: relocationScenarioParamsSchema,
        }),
      )
      .mutation(async ({ ctx, input }) => {
        if (input.id) {
          return ctx.db
            .update(schema.relocationScenarios)
            .set({
              name: input.name,
              params: input.params,
              updatedAt: writeStamp(),
            })
            .where(eq(schema.relocationScenarios.id, input.id))
            .returning()
            .then(firstRow);
        }
        return ctx.db
          .insert(schema.relocationScenarios)
          .values({ name: input.name, params: input.params })
          .returning()
          .then(firstRow);
      }),
    delete: adminProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(({ ctx, input }) =>
        ctx.db
          .delete(schema.relocationScenarios)
          .where(eq(schema.relocationScenarios.id, input.id)),
      ),
  }),
});
