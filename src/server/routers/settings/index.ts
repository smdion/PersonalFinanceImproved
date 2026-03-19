import { createTRPCRouter } from "../../trpc";
import { paycheckProcedures } from "./paycheck";
import { taxLimitsProcedures } from "./tax-limits";
import { retirementProcedures } from "./retirement";
import { mortgageProcedures } from "./mortgage";
import { adminProcedures } from "./admin";
import { onboardingProcedures } from "./onboarding";

export const settingsRouter = createTRPCRouter({
  ...paycheckProcedures,
  ...taxLimitsProcedures,
  ...retirementProcedures,
  ...mortgageProcedures,
  ...adminProcedures,
  ...onboardingProcedures,
});
