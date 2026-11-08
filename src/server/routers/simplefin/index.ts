/**
 * SimpleFIN: daily linked balances (a read-only aggregator, not a budget API).
 * Setup and account controls are admin-only, like the Integrations page;
 * syncNow stays on `sync` for the header's refresh. Queries are protected.
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
