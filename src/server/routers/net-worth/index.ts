/** Net worth router that aggregates account snapshots, mortgage balances, cash, and other assets into a current and projected net worth summary, plus portfolio snapshot CRUD (including budget-API pull/push side-effects). */
import { createTRPCRouter } from "../../trpc";
import { summaryProcedures } from "./summary";
import { historyProcedures } from "./history";
import { snapshotProcedures } from "./snapshots";
import { comparisonProcedures } from "./comparison";
import { portfolioSnapshotProcedures } from "./portfolio-snapshots";
import { snapshotAccountProcedures } from "./snapshot-accounts";

export const netWorthRouter = createTRPCRouter({
  ...summaryProcedures,
  ...historyProcedures,
  ...snapshotProcedures,
  ...comparisonProcedures,
  portfolioSnapshots: createTRPCRouter({
    ...portfolioSnapshotProcedures,
    ...snapshotAccountProcedures,
  }),
});
