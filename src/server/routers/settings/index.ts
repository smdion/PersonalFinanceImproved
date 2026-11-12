import { createTRPCRouter } from "../../trpc";
import { taxLimitsProcedures } from "./tax-limits";
import { adminProcedures } from "./admin";
import { onboardingProcedures } from "./onboarding";
import { taxDataSyncProcedures } from "./tax-data-sync";

export const settingsRouter = createTRPCRouter({
  ...taxLimitsProcedures,
  ...adminProcedures,
  ...onboardingProcedures,
  ...taxDataSyncProcedures,
});
