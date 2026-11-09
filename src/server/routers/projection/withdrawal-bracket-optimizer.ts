/**
 * Multi-year withdrawal-policy optimizer endpoint: a synchronous, uncached query
 * over the same `fetchRetirementData` / `buildEnginePayload` input as Coast FIRE.
 */
import { z } from "zod/v4";
import { createTRPCRouter, protectedProcedure } from "../../trpc";
import { optimizeRothBracketTarget } from "@/lib/pure/retirement/withdrawal-bracket-optimizer";
import { prepareProjectionRun } from "@/server/services/projection/projection-run";
import {
  accumulationOverrideSchema,
  decumulationOverrideSchema,
} from "./_shared";
import { prepareEngineInput } from "./engine-input";
import { decumulationDefaultsInputSchema } from "@/lib/pure/engine/types";
import { profileSelectionSchema } from "@/lib/pure/household/profile-selection.schema";

export const withdrawalBracketOptimizerRouter = createTRPCRouter({
  /**
   * Finds the `rothBracketTarget` minimizing lifetime tax (plus a penalty for unconverted
   * Traditional money) while still funding spending, against the requested profile's data.
   * See `optimizeRothBracketTarget` for the scoring.
   */
  computeWithdrawalBracketOptimizer: protectedProcedure
    .input(
      z.strictObject({
        // Mirrors computeCoastFire's input subset that affects the engine.
        decumulationDefaults: decumulationDefaultsInputSchema,
        accumulationOverrides: accumulationOverrideSchema,
        decumulationOverrides: decumulationOverrideSchema,
        selection: profileSelectionSchema.optional(),
        snapshotId: z.number().int().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { payload } = await prepareProjectionRun(ctx, {
        selection: input.selection,
        snapshotId: input.snapshotId,
      });
      if (!payload) return { result: null };
      if (payload.notConfigured)
        return { result: null, notConfigured: payload.notConfigured };

      const engineInput = await prepareEngineInput(ctx.db, payload, input);

      return { result: optimizeRothBracketTarget(engineInput) };
    }),
});
