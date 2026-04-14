/**
 * User-defined Monte Carlo simulation presets + app-level MC inflation overrides.
 *
 * Pure CRUD — no engine payload, no `fetchRetirementData`. This sub-router has
 * zero overlap with the compute endpoints (monte-carlo / scenarios / strategy /
 * stress-test), which is why the advisor called it out as naturally its own
 * file in the v0.5.2 family split.
 *
 * Extracted from the old monolith `projection.ts` in PR 2b of the refactor.
 * Pure relocation — no logic changes.
 */
import { eq, asc } from "drizzle-orm";
import { z } from "zod/v4";
import {
  createTRPCRouter,
  protectedProcedure,
  scenarioProcedure,
} from "../../trpc";
import * as schema from "@/lib/db/schema";
import { toNumber } from "@/server/helpers";

export const presetsRouter = createTRPCRouter({
  listPresets: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select()
      .from(schema.mcUserPresets)
      .orderBy(asc(schema.mcUserPresets.id));
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      simulations: r.simulations,
      returnMean: toNumber(r.returnMean),
      returnStdDev: toNumber(r.returnStdDev),
      inflationMean: toNumber(r.inflationMean),
      inflationStdDev: toNumber(r.inflationStdDev),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }),

  /** Create a new user Monte Carlo simulation preset. */
  createPreset: scenarioProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100).trim(),
        simulations: z.number().int().min(100).max(100000).default(1000),
        returnMean: z.number(),
        returnStdDev: z.number().min(0),
        inflationMean: z.number(),
        inflationStdDev: z.number().min(0),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .insert(schema.mcUserPresets)
        .values({
          name: input.name,
          simulations: input.simulations,
          returnMean: String(input.returnMean),
          returnStdDev: String(input.returnStdDev),
          inflationMean: String(input.inflationMean),
          inflationStdDev: String(input.inflationStdDev),
        })
        .returning();
      return {
        id: row!.id,
        name: row!.name,
        simulations: row!.simulations,
        returnMean: toNumber(row!.returnMean),
        returnStdDev: toNumber(row!.returnStdDev),
        inflationMean: toNumber(row!.inflationMean),
        inflationStdDev: toNumber(row!.inflationStdDev),
        createdAt: row!.createdAt,
        updatedAt: row!.updatedAt,
      };
    }),

  /** Update an existing user Monte Carlo simulation preset. */
  updatePreset: scenarioProcedure
    .input(
      z.object({
        id: z.number().int(),
        name: z.string().min(1).max(100).trim().optional(),
        simulations: z.number().int().min(100).max(100000).optional(),
        returnMean: z.number().optional(),
        returnStdDev: z.number().min(0).optional(),
        inflationMean: z.number().optional(),
        inflationStdDev: z.number().min(0).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...fields } = input;
      const setValues: Record<string, unknown> = {};
      if (fields.name !== undefined) setValues.name = fields.name;
      if (fields.simulations !== undefined)
        setValues.simulations = fields.simulations;
      if (fields.returnMean !== undefined)
        setValues.returnMean = String(fields.returnMean);
      if (fields.returnStdDev !== undefined)
        setValues.returnStdDev = String(fields.returnStdDev);
      if (fields.inflationMean !== undefined)
        setValues.inflationMean = String(fields.inflationMean);
      if (fields.inflationStdDev !== undefined)
        setValues.inflationStdDev = String(fields.inflationStdDev);
      await ctx.db
        .update(schema.mcUserPresets)
        .set(setValues)
        .where(eq(schema.mcUserPresets.id, id));
      return { updated: true };
    }),

  /** Delete a user Monte Carlo simulation preset. */
  deletePreset: scenarioProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(schema.mcUserPresets)
        .where(eq(schema.mcUserPresets.id, input.id));
      return { deleted: true };
    }),

  /** Persist MC stochastic inflation overrides to appSettings. */
  updateInflationOverrides: scenarioProcedure
    .input(
      z.object({
        meanRate: z.number().optional(),
        stdDev: z.number().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { db } = ctx;
      const key = "mc_inflation_overrides";
      const isEmpty =
        input.meanRate === undefined && input.stdDev === undefined;
      if (isEmpty) {
        await db
          .delete(schema.appSettings)
          .where(eq(schema.appSettings.key, key));
        return { updated: true };
      }
      await db
        .insert(schema.appSettings)
        .values({ key, value: input })
        .onConflictDoUpdate({
          target: schema.appSettings.key,
          set: { value: input },
        });
      return { updated: true };
    }),
});
