/**
 * `computeStrategyComparison`, `computeStrategyAnalysis` and `updateAssetClassOverrides`. Both
 * procedures build decumulation defaults via `buildDecumulationDefaults` (projection-run.ts) and
 * override only the compared variable (withdrawalStrategy + strategyParams per candidate).
 */
import { SIMULATION_PRESET_KEYS } from "@/lib/constants";
import { eq } from "drizzle-orm";
import { z } from "zod/v4";
import {
  createTRPCRouter,
  protectedProcedure,
  scenarioProcedure,
  expensiveRateLimitMiddleware,
} from "../../trpc";
import * as schema from "@/lib/db/schema";
import { profileSelectionSchema } from "@/lib/pure/household/profile-selection.schema";
import { upsertSetting } from "@/server/data/settings";
import {
  computeStrategyComparison,
  analyzeStrategy,
} from "@/server/services/projection/strategy-analysis";

export const strategyRouter = createTRPCRouter({
  /**
   * Compare all withdrawal strategies side-by-side.
   *
   * Fetches DB data once, then runs calculateProjection() for each strategy
   * varying only withdrawalStrategy + strategyParams.
   */
  computeStrategyComparison: protectedProcedure
    .input(
      z
        .strictObject({
          /** Simulation preset (the page's selector); the Default preset
           *  when absent. */
          preset: z.enum(SIMULATION_PRESET_KEYS).optional(),
          selection: profileSelectionSchema.optional(),
          snapshotId: z.number().int().optional(),
          /** Bypass the projection cache and force a fresh comparison — the explicit "Refresh" action, not the default query path. */
          forceRefresh: z.boolean().optional(),
        })
        .optional(),
    )
    .query(({ ctx, input }) => computeStrategyComparison(ctx, input)),

  /** Analyze the active strategy — run what-if MC scenarios and return ranked recommendations. */
  computeStrategyAnalysis: protectedProcedure
    .use(expensiveRateLimitMiddleware)
    .input(
      z
        .strictObject({
          /** Simulation preset (the page's selector); the Default preset
           *  when absent. */
          preset: z.enum(SIMULATION_PRESET_KEYS).optional(),
          selection: profileSelectionSchema.optional(),
          snapshotId: z.number().int().optional(),
        })
        .optional(),
    )
    .query(({ ctx, input }) => analyzeStrategy(ctx, input)),

  /** Persist MC asset class return/volatility overrides to appSettings. */
  updateAssetClassOverrides: scenarioProcedure
    .input(
      z.array(
        z.object({
          id: z.number(),
          meanReturn: z.number().optional(),
          stdDev: z.number().optional(),
        }),
      ),
    )
    .mutation(async ({ ctx, input }) => {
      const { db } = ctx;
      const key = "mc_asset_class_overrides";
      if (input.length === 0) {
        await db
          .delete(schema.appSettings)
          .where(eq(schema.appSettings.key, key));
        return { updated: true, count: 0 };
      }
      await upsertSetting(db, key, input);
      return { updated: true, count: input.length };
    }),
});
