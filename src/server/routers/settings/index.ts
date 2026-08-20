import { createTRPCRouter } from "../../trpc";
import { paycheckProcedures } from "./paycheck";
import { taxLimitsProcedures } from "./tax-limits";
import { adminProcedures } from "./admin";
import { onboardingProcedures } from "./onboarding";

export const settingsRouter = createTRPCRouter({
  ...paycheckProcedures,
  ...taxLimitsProcedures,
  ...adminProcedures,
  ...onboardingProcedures,
});
