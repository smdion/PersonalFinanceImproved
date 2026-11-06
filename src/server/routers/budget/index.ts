/** Budget router for multi-profile budget management including category items, column tiers, contribution profile linking, and budget API integration. */
import { createTRPCRouter } from "../../trpc";
import { summaryProcedures } from "./summary";
import { profileProcedures } from "./profiles";
import { itemAmountProcedures } from "./item-amounts";
import { columnProcedures } from "./columns";
import { itemProcedures } from "./items";
import { itemLinkProcedures } from "./item-links";
import { apiLinkProcedures } from "./api-links";
import { apiSyncProcedures } from "./api-sync";

export const budgetRouter = createTRPCRouter({
  ...summaryProcedures,
  ...profileProcedures,
  ...itemAmountProcedures,
  ...columnProcedures,
  ...itemProcedures,
  ...itemLinkProcedures,
  ...apiLinkProcedures,
  ...apiSyncProcedures,
});
