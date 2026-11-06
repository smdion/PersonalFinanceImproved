/**
 * One person's retirement settings in the active profile: their own row,
 * or the profile's household values where they have none.
 */
import { toNumber } from "@/lib/utils/numbers";
import type * as schema from "@/lib/db/schema";

type SettingsRow = typeof schema.retirementSettings.$inferSelect;
type ProfilePersonRow = typeof schema.retirementProfilePeople.$inferSelect;

/** The active profile's rows, and what a person with no row reads. */
export type ActiveProfileRows = {
  activeProfileId: SettingsRow["profileId"];
  /** The active profile's `retirement_profile_people` rows. */
  profilePeople: ProfilePersonRow[];
  retSettings: SettingsRow[];
  /** The active profile's household row (pickProfileSettingsRow). */
  settings: SettingsRow;
  /** The primary person's raise rate, from `settings`. */
  primaryRaiseRate: number;
};

/**
 * A person's settings, each looked up once. A person with no row in the
 * active profile reads the profile's values (a restored older backup can
 * lack one), so a page renders instead of blanking.
 */
export function settingsFor(personId: number, profile: ActiveProfileRows) {
  const { activeProfileId, settings } = profile;
  const pp = profile.profilePeople.find((r) => r.personId === personId);
  // Only this profile's row: another profile's values never stand in.
  // With no profile at all (null), every row has a null profile id.
  const rs = profile.retSettings.find(
    (s) => s.personId === personId && s.profileId === activeProfileId,
  );
  const ps = pp ?? rs;
  // The raise rate's live source is retirement_settings (the column on
  // retirement_profile_people is never read). No row there: the primary's
  // rate; an explicit 0 is a real rate (a cap, a freeze) and is kept.
  const ownRaiseRate = rs ? toNumber(rs.salaryAnnualIncrease) : NaN;
  return {
    retirementAge: ps?.retirementAge ?? settings.retirementAge,
    endAge: ps?.endAge ?? settings.endAge,
    salaryAnnualIncrease: Number.isFinite(ownRaiseRate)
      ? ownRaiseRate
      : profile.primaryRaiseRate,
    // Dead: no client reads it. From this person's own retirement_settings
    // row: rows can disagree on it, so another source would move a value.
    withdrawalRate: rs?.withdrawalRate ?? settings.withdrawalRate,
    socialSecurityMonthly:
      ps?.socialSecurityMonthly ?? settings.socialSecurityMonthly,
    // PIA is per person with no household value; only the
    // retirement_profile_people row has it. null is "not opted in".
    socialSecurityPia: pp?.socialSecurityPia ?? null,
    ssStartAge: ps?.ssStartAge ?? settings.ssStartAge,
    ruleOf55Override: ps?.ruleOf55Override ?? settings.ruleOf55Override,
  };
}
