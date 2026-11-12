/**
 * Coast FIRE Custom Age probe: "what happens if I stop at age N" for any N, where
 * `computeCoastFireSimulation` answers only the earliest passing age or "today". Its own file:
 * the result shape differs (see `CoastFireProbeResult`).
 */
import { z } from "zod/v4";
import {
  createTRPCRouter,
  protectedProcedure,
  expensiveRateLimitMiddleware,
} from "../../trpc";
import {
  accumulationOverrideSchema,
  decumulationOverrideSchema,
} from "./_shared";
import { decumulationDefaultsInputSchema } from "@/lib/pure/engine/types";
import { profileSelectionSchema } from "@/lib/pure/household/profile-selection.schema";
import { computeCoastFireProbe } from "@/server/services/projection/coast-fire-probe";

export const coastFireProbeRouter = createTRPCRouter({
  /**
   * One Simulation run with contributions and employer match zeroed from `probeAge` on,
   * via `buildCoastFireProfileSwitches` (computeCoastFireSimulation's probe mechanism).
   * Returns `CoastFireProbeResult`.
   */
  computeCoastFireProbe: protectedProcedure
    .use(expensiveRateLimitMiddleware)
    .input(
      z.strictObject({
        decumulationDefaults: decumulationDefaultsInputSchema,
        accumulationOverrides: accumulationOverrideSchema,
        decumulationOverrides: decumulationOverrideSchema,
        selection: profileSelectionSchema.optional(),
        snapshotId: z.number().int().optional(),
        /** The age to probe; validated below against the resolved engine input's
         *  currentAge/retirementAge (buildCoastFireProfileSwitches has no guard). */
        probeAge: z.number().int(),
        /** Progress-polling key — see `getSimulationProgress`'s docblock. */
        runId: z.string().optional(),
      }),
    )
    .query(({ ctx, input }) => computeCoastFireProbe(ctx, input)),
});
