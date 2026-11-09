import { z } from "zod/v4";
import { budgetProcedure } from "../../trpc";
import {
  syncBudgetFromApi,
  syncBudgetToApi,
} from "@/server/services/sync/budget-amounts-sync";

export const apiSyncProcedures = {
  /** Pull budgeted amounts from API for all linked items (API -> Ledgr). */
  syncBudgetFromApi: budgetProcedure
    .input(z.object({}).optional())
    .mutation(({ ctx }) => syncBudgetFromApi(ctx)),

  /** Push budget amounts to API for all linked items (Ledgr -> API). */
  syncBudgetToApi: budgetProcedure
    .input(z.object({}).optional())
    .mutation(({ ctx }) => syncBudgetToApi(ctx)),
};
