/**
 * `computeMonteCarloProjection` plus the mutations that edit its input tables
 * (`updateGlidePathAllocations`, `updateClampBounds`).
 */
import { SK_SIMULATION_CUSTOM_CLAMP_BOUNDS } from "@/lib/constants/settings-keys";
import { SIMULATION_PRESET_KEYS } from "@/lib/constants";
import { DEFAULT_SIMULATION } from "@/lib/constants";
import { z } from "zod/v4";
import {
  createTRPCRouter,
  protectedProcedure,
  scenarioProcedure,
  adminProcedure,
  expensiveRateLimitMiddleware,
} from "../../trpc";
import * as schema from "@/lib/db/schema";
import { getMonteCarloProgress } from "@/server/services/simulation/monte-carlo-worker-client";
import {
  accumulationOverrideSchema,
  decumulationOverrideSchema,
} from "./_shared";
import { decumulationDefaultsInputSchema } from "@/lib/pure/engine/types";
import { clearProjectionCache } from "@/server/services/projection/projection-cache";
import { profileSelectionSchema } from "@/lib/pure/household/profile-selection.schema";
import { upsertSetting } from "@/server/data/settings";
import { computeMonteCarloProjection } from "@/server/services/simulation/monte-carlo-projection";

export const monteCarloRouter = createTRPCRouter({
  /**
   * Runs N engine trials with returns drawn from correlated log-normal distributions
   * (asset class parameters + glide path allocations); returns percentile bands,
   * success rate and key metrics.
   */
  computeMonteCarloProjection: protectedProcedure
    .use(expensiveRateLimitMiddleware)
    .input(
      z.strictObject({
        numTrials: z
          .number()
          .int()
          .min(100)
          .max(10000)
          .default(DEFAULT_SIMULATION.numTrials),
        seed: z.number().int().optional(),
        /** Simulation preset: controls return assumptions, volatility, inflation risk, and trial count. */
        preset: z
          .enum(SIMULATION_PRESET_KEYS)
          .default(DEFAULT_SIMULATION.preset),
        /** Tax mode: 'simple' collapses to single tax-free balance (cFIREsim-comparable), 'advanced' uses full multi-account tax engine. */
        taxMode: z
          .enum(["simple", "advanced"])
          .default(DEFAULT_SIMULATION.taxMode),
        selection: profileSelectionSchema.optional(),
        /** Optional per-asset-class return/volatility overrides from the UI. */
        assetClassOverrides: z
          .array(
            z.object({
              id: z.number(),
              meanReturn: z.number().min(-0.1).max(0.3).optional(),
              stdDev: z.number().min(0).max(0.5).optional(),
            }),
          )
          .optional(),
        /** Optional salary overrides from UI (same as getProjection). */

        // --- Decumulation defaults (mirrors getProjection) ---
        decumulationDefaults: decumulationDefaultsInputSchema,

        // --- Accumulation overrides (mirrors getProjection) ---
        accumulationOverrides: accumulationOverrideSchema,

        // --- Decumulation overrides (mirrors getProjection) ---
        decumulationOverrides: decumulationOverrideSchema,

        /** Optional inflation risk: the spread of each year's inflation
         *  around the plan's own rates. */
        inflationRisk: z
          .object({ stdDev: z.number().min(0).max(0.1) })
          .optional(),
        /** Optional snapshot ID — use a historical portfolio snapshot instead of the latest. */
        snapshotId: z.number().int().optional(),
        /** Rate-Seeded scenario: seed decumulation year 1 from Initial Withdrawal Rate ×
         *  starting balance instead of the stated budget/override. Default off; see
         *  ProjectionInput.rateSeededDecumulationYear1. */
        rateSeededDecumulationYear1: z.boolean().optional(),
        /** Bypass the projection cache and force a fresh run with a new seed — the explicit "Run Monte Carlo" action, not the default query path. */
        forceRefresh: z.boolean().optional(),
        /** Read-only cache peek — never runs the (expensive) trials, just returns a cache hit or a null result. For cheap dashboard-tile display of "whatever the last real run found." */
        peekOnly: z.boolean().optional(),
        /** Optional client id (crypto.randomUUID()) to poll this run's progress under
         *  via `getMonteCarloProgress` (see monte-carlo-worker-client.ts). */
        runId: z.string().optional(),
      }),
    )
    .query(({ ctx, input }) => computeMonteCarloProjection(ctx, input)),

  /**
   * Live progress of an in-flight run with this `runId`, polled ~500ms by the client
   * (in-memory; see monte-carlo-worker-client.ts). Null when done, unknown or not started.
   */
  getMonteCarloProgress: protectedProcedure
    .input(z.object({ runId: z.string() }))
    .query(({ input }) => {
      return getMonteCarloProgress(input.runId);
    }),

  // --- Mutations for editing projection assumptions ---

  /** Replace the Custom Simulation preset's glide path (each age's mix by asset class); returns the rows written. */
  updateGlidePathAllocations: scenarioProcedure
    .input(
      z.object({
        entries: z.array(
          z.object({
            age: z.number().int(),
            allocations: z.record(z.string(), z.number()),
          }),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { db } = ctx;
      // Delete existing custom glide path and replace
      await db.delete(schema.glidePathAllocations);
      const rows: { age: number; assetClassId: number; allocation: string }[] =
        [];
      for (const entry of input.entries) {
        for (const [idStr, allocation] of Object.entries(entry.allocations)) {
          const assetClassId = parseInt(idStr, 10);
          if (!isNaN(assetClassId)) {
            rows.push({
              age: entry.age,
              assetClassId,
              allocation: String(allocation),
            });
          }
        }
      }
      if (rows.length > 0) {
        await db.insert(schema.glidePathAllocations).values(rows);
      }
      return { updated: rows.length };
    }),

  /** Save the Custom Simulation preset's bounds on a year's return, as a setting (Custom has no preset row). */
  updateClampBounds: scenarioProcedure
    .input(
      z.object({
        preset: z.enum(["custom"]),
        returnClampMin: z.number().min(-1).max(0),
        returnClampMax: z.number().min(0).max(10),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { db } = ctx;
      // Custom has no preset row, so its bounds are stored as a setting.
      const value = {
        returnClampMin: input.returnClampMin,
        returnClampMax: input.returnClampMax,
      };
      await upsertSetting(db, SK_SIMULATION_CUSTOM_CLAMP_BOUNDS, value);
      return { updated: true };
    }),

  /** Wipes every cached deterministic/MC/Coast-FIRE projection row —
   *  forces a full recompute without a deploy. Admin-only: destructive
   *  against shared cache state. */
  clearCache: adminProcedure.mutation(async ({ ctx }) => {
    const cleared = await clearProjectionCache(ctx.db);
    return { cleared };
  }),
});
