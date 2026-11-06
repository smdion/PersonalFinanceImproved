/**
 * SimpleFIN router — daily linked-balance pulse (Phase 1).
 *
 * Deliberately separate from ./sync (the YNAB/Actual BudgetAPIClient
 * group): SimpleFIN is a read-only bank/brokerage balance aggregator with
 * no budget/category/transaction concepts, so it doesn't implement the
 * BudgetAPIClient interface or go through lib/budget-api/factory.ts.
 *
 * Mutations use syncProcedure (same permission domain as YNAB/Actual
 * connection management in sync/connections.ts) since they write shared
 * server-side credentials and trigger external syncs. Queries use
 * protectedProcedure — read-only, no reason to gate more tightly.
 */

import { createTRPCRouter } from "../../trpc";
import { connectionsProcedures } from "./connections";
import { accountsProcedures } from "./accounts";
import { linksProcedures } from "./links";

export const simplefinRouter = createTRPCRouter({
  ...connectionsProcedures,
  ...accountsProcedures,
  ...linksProcedures,
});
