/** Savings router for savings goals, emergency fund calculations, planned transactions, and budget API expense integration. */

import { createTRPCRouter } from "../../trpc";
import { summaryProcedures } from "./summary";
import { plannedTransactionProcedures } from "./planned-transactions";
import { allocationOverrideProcedures } from "./allocation-overrides";
import { profileAllocationProcedures } from "./profile-allocations";
import { apiLinkProcedures } from "./api-links";
import { goalProcedures } from "./goals";
import { apiSyncProcedures } from "./api-sync";
import { reimbursementProcedures } from "./reimbursements";
import { transferProcedures } from "./transfers";
import { extraPaycheckRoutingProcedures } from "./extra-paycheck-routing";
import { historyProcedures } from "./history";

export const savingsRouter = createTRPCRouter({
  ...summaryProcedures,
  ...plannedTransactionProcedures,
  ...allocationOverrideProcedures,
  ...profileAllocationProcedures,
  ...apiLinkProcedures,
  ...goalProcedures,
  ...apiSyncProcedures,
  ...reimbursementProcedures,
  ...transferProcedures,
  ...extraPaycheckRoutingProcedures,
  ...historyProcedures,
});
