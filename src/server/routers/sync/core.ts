/** Sync core router handling full data synchronization, sync preview generation, and expense comparison between budget API and local data. */

import { createTRPCRouter } from "../../trpc";
import { syncAllProcedures } from "./sync-all";
import { previewProcedures } from "./preview";
import { expenseComparisonProcedures } from "./expense-comparison";

export const syncCoreRouter = createTRPCRouter({
  ...syncAllProcedures,
  ...previewProcedures,
  ...expenseComparisonProcedures,
});
