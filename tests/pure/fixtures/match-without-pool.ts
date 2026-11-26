/**
 * A 401(k) match where no one holds a 401(k): Ann, 50 in 2026, holds only a
 * $200,000 IRA, with or without a contribution spec paying it.
 */
import type { ProjectionInput } from "@/lib/pure/engine/types";
import { acct, household } from "./two-person-household";
import {
  makeAccumulationDefaults,
  makeContributionSpec,
  paysInto,
} from "./engine-fixtures";
import { withAccountId } from "./engine-input";

export const matchWithoutPool = (specs: boolean): ProjectionInput =>
  household([acct("Ann IRA", "ira", 200000, 1)], {
    currentAge: 50,
    birthYear: 1976,
    perPersonBirthYears: [1976],
    socialSecurityEntries: undefined,
    retirementYear: 2036,
    projectionEndYear: 2030,
    currentSalary: 100000,
    employerMatchRateByCategory: {
      "401k": 0.04,
      "403b": 0,
      hsa: 0,
      ira: 0,
      brokerage: 0,
    },
    accumulationDefaults: makeAccumulationDefaults({ contributionRate: 0.1 }),
    ...(specs
      ? {
          contributionSpecs: [
            makeContributionSpec({
              category: "ira",
              name: "Ann IRA",
              taxTreatment: "pre_tax",
              contributionAccountId: 1,
              account: paysInto(withAccountId(acct("Ann IRA", "ira", 0, 1))),
            }),
          ],
        }
      : {}),
  });
