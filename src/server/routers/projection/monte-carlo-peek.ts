// The dashboard tile's read of the last Simulation: only what it shows (the
// full result is 367 KB). Calls computeMonteCarloProjection with peekOnly (a
// cache read, never trials), so the two can't compute a figure differently.
import { z } from "zod/v4";
import type { inferRouterInputs } from "@trpc/server";
import {
  createCallerFactory,
  createTRPCRouter,
  internalCtx,
  protectedProcedure,
} from "../../trpc";
import { simulationDollars } from "@/lib/pure/simulation/dollars";
import { monteCarloRouter } from "./monte-carlo";

type ProjectionInput = inferRouterInputs<
  typeof monteCarloRouter
>["computeMonteCarloProjection"];
/** The full query's input, less what a peek decides for itself. */
type PeekInput = Omit<ProjectionInput, "peekOnly" | "forceRefresh" | "runId">;

const callMonteCarlo = createCallerFactory(monteCarloRouter);

export const monteCarloPeekRouter = createTRPCRouter({
  /** The cached Simulation's success rate, today's bands and run time. */
  peekMonteCarloSummary: protectedProcedure
    // Checked by computeMonteCarloProjection's own input schema below.
    .input(z.custom<PeekInput>((v) => typeof v === "object" && v !== null))
    .query(async ({ ctx, input }) => {
      const full = await callMonteCarlo(
        internalCtx(ctx),
      ).computeMonteCarloProjection({ ...input, peekOnly: true });
      return {
        result: full.result
          ? {
              successRate: full.result.successRate,
              // Today's dollars, from the Simulation's own per-trial deflation.
              todayBands: simulationDollars(
                full.result,
                "real",
              ).percentileBands.map(({ age, year, p25, p50, p75 }) => ({
                age,
                year,
                p25,
                p50,
                p75,
              })),
            }
          : null,
        computedAt: full.simulationInputs?.computedAt ?? null,
      };
    }),
});
