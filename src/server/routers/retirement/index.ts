/** Retirement router for readiness analysis including savings rates, employer matches, tax bucket projections, relocation comparisons, profile-switching scenarios, and retirement-settings/scenario/override/return-rate CRUD. */
import { createTRPCRouter } from "../../trpc";
import { relocationAnalysisProcedures } from "./relocation-analysis";
import { profilePeopleProcedures } from "./profile-people";
import { settingsProcedures } from "./settings";
import { overrideProcedures } from "./overrides";
import { profileProcedures } from "./profiles";
import { returnRateProcedures } from "./return-rates";

export const retirementRouter = createTRPCRouter({
  ...relocationAnalysisProcedures,
  ...profilePeopleProcedures,
  ...settingsProcedures,
  ...overrideProcedures,
  ...profileProcedures,
  ...returnRateProcedures,
});
