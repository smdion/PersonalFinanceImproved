/**
 * App-level Monte Carlo inflation overrides.
 *
 * Pure CRUD — no engine payload, no `fetchRetirementData`. This sub-router has
 * zero overlap with the compute endpoints (monte-carlo / scenarios / strategy /
 * stress-test), which is why it is naturally its own file.
 */
import { eq } from "drizzle-orm";
import { z } from "zod/v4";
import { createTRPCRouter, scenarioProcedure } from "../../trpc";
import * as schema from "@/lib/db/schema";

export const presetsRouter = createTRPCRouter({
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
