/**
 * App-level Simulation inflation overrides: pure CRUD, with no engine payload or
 * `fetchRetirementData`.
 */
import { eq } from "drizzle-orm";
import { z } from "zod/v4";
import { createTRPCRouter, scenarioProcedure } from "../../trpc";
import * as schema from "@/lib/db/schema";
import { upsertSetting } from "@/server/data/settings";

export const presetsRouter = createTRPCRouter({
  /** Persist MC stochastic inflation overrides to appSettings. */
  updateInflationOverrides: scenarioProcedure
    .input(
      // The spread of each year's inflation around the plan's own rates
      // (the rates themselves are the plan's, not the Simulation's).
      z.object({
        stdDev: z.number().min(0).max(0.1).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { db } = ctx;
      const key = "mc_inflation_overrides";
      const isEmpty = input.stdDev === undefined;
      if (isEmpty) {
        await db
          .delete(schema.appSettings)
          .where(eq(schema.appSettings.key, key));
        return { updated: true };
      }
      await upsertSetting(db, key, input);
      return { updated: true };
    }),
});
