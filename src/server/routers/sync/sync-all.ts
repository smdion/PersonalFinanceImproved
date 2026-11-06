import { z } from "zod/v4";
import { syncProcedure, expensiveRateLimitMiddleware } from "../../trpc";
import { serviceEnum } from "./_shared";
import { syncAll } from "@/server/services/sync/sync-all";

export const syncAllProcedures = {
  /**
   * Full sync for a specific service — works independently of active_budget_api.
   * Pulls accounts, categories, current month, and transactions into cache.
   */
  syncAll: syncProcedure
    .use(expensiveRateLimitMiddleware)
    .input(z.object({ service: serviceEnum }))
    .mutation(({ ctx, input }) => syncAll(ctx, input)),
};
