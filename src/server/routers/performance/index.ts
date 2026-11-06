/** Performance router for portfolio time-weighted return tracking, snapshot ingestion, account-level performance history, and category rollup calculations. */
import { createTRPCRouter } from "../../trpc";
import { summaryProcedures } from "./summary";
import { yearRecordProcedures } from "./year-records";
import { accountProcedures } from "./accounts";
import { finalizeYearProcedures } from "./finalize-year";

export const performanceRouter = createTRPCRouter({
  ...summaryProcedures,
  ...yearRecordProcedures,
  ...accountProcedures,
  ...finalizeYearProcedures,
});
