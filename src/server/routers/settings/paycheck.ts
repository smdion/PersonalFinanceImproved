import { peopleProcedures } from "./people";
import { jobsProcedures } from "./jobs";
import { contributionAccountsProcedures } from "./contribution-accounts";
import { earningsProcedures } from "./earnings";
import { deductionsProcedures } from "./deductions";

export const paycheckProcedures = {
  ...peopleProcedures,
  ...jobsProcedures,
  ...contributionAccountsProcedures,
  ...earningsProcedures,
  ...deductionsProcedures,
};
