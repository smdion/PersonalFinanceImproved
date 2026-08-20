import { createTRPCRouter } from "../../trpc";
import { paycheckProcedures } from "./paycheck";
import { taxLimitsProcedures } from "./tax-limits";
import { retirementProcedures } from "./retirement";
import { adminProcedures } from "./admin";
import { onboardingProcedures } from "./onboarding";

export const settingsRouter = createTRPCRouter({
  ...paycheckProcedures,
  ...taxLimitsProcedures,
  ...retirementProcedures,
  ...adminProcedures,
  ...onboardingProcedures,
});
