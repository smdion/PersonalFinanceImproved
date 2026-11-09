import { z } from "zod/v4";
import { savingsProcedure } from "../../trpc";
import { pushContributionsToApi } from "@/server/services/sync/savings-goal-push";

export const apiSyncProcedures = {
  /**
   * Push goal targets for linked funds (optionally one `goalId`): sinking funds as a
   * "monthly" goal, the emergency fund as a "target-balance" amount (its type/cadence is
   * set once in YNAB). Every target is read before the first write.
   */
  pushContributionsToApi: savingsProcedure
    .input(z.object({ goalId: z.number().int().optional() }).optional())
    .mutation(({ ctx, input }) => pushContributionsToApi(ctx, input)),
};
