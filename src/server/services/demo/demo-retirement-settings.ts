// The demo seed's retirement settings rows: the profile's household row and
// each other person's own.
import type { DemoProfile } from "@/lib/demo";
import * as schema from "@/lib/db/schema";
import type { DbOrTx } from "@/lib/db";
import { NEW_HOUSEHOLD_ROW } from "@/server/services/profiles/retirement-settings-row";
import type { RetirementSettingsInsert } from "@/server/services/profiles/retirement-settings-row";

/** A new household's rows (NEW_HOUSEHOLD_ROW), one per person the profile names. */
export async function seedRetirementSettings(
  db: DbOrTx,
  profile: DemoProfile,
  personIdByName: ReadonlyMap<string, number>,
) {
  const rs = profile.retirementSettings;
  const personId = personIdByName.get(rs.personName)!;
  await db.insert(schema.retirementSettings).values({
    personId,
    retirementAge: rs.retirementAge,
    endAge: rs.endAge,
    returnAfterRetirement: rs.returnAfterRetirement,
    annualInflation: rs.annualInflation,
    salaryAnnualIncrease: rs.salaryAnnualIncrease,
    withdrawalRate: rs.withdrawalRate,
    withdrawalStrategy: rs.withdrawalStrategy,
    socialSecurityMonthly: rs.socialSecurityMonthly,
    ssStartAge: rs.ssStartAge,
    ...NEW_HOUSEHOLD_ROW,
  } satisfies RetirementSettingsInsert);
  if (profile.perPersonRetirementSettings) {
    for (const prs of profile.perPersonRetirementSettings) {
      const prsPersonId = personIdByName.get(prs.personName);
      if (prsPersonId && prsPersonId !== personId) {
        await db.insert(schema.retirementSettings).values({
          personId: prsPersonId,
          retirementAge: prs.retirementAge ?? rs.retirementAge,
          endAge: prs.endAge ?? rs.endAge,
          returnAfterRetirement: rs.returnAfterRetirement,
          annualInflation: rs.annualInflation,
          salaryAnnualIncrease: rs.salaryAnnualIncrease,
          withdrawalRate: prs.withdrawalRate ?? rs.withdrawalRate,
          withdrawalStrategy: rs.withdrawalStrategy,
          socialSecurityMonthly: prs.socialSecurityMonthly,
          ssStartAge: prs.ssStartAge,
          ...NEW_HOUSEHOLD_ROW,
        } satisfies RetirementSettingsInsert);
      }
    }
  }
}
