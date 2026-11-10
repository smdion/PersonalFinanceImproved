/**
 * One person's retirement settings in the active profile: their own
 * per-person row, the profile's household values where a field is empty.
 */
import { toNumber } from "@/lib/utils/numbers";
import type * as schema from "@/lib/db/schema";
import { calendarYear } from "@/lib/utils/date";
import type { fetchRetirementData } from "./load";

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
 * A person's settings, each looked up once: their per-person row's field,
 * or the profile's household value where it is null or they have no row
 * (every person with a settings row in a profile has a per-person row).
 */
export function settingsFor(personId: number, profile: ActiveProfileRows) {
  const { activeProfileId, settings } = profile;
  const pp = profile.profilePeople.find((r) => r.personId === personId);
  // Only this profile's row: another profile's values never stand in.
  // With no profile at all (null), every row has a null profile id.
  const rs = profile.retSettings.find(
    (s) => s.personId === personId && s.profileId === activeProfileId,
  );
  // With no profile there are no per-person rows: the settings row holds them.
  const ps = activeProfileId === null ? rs : pp;
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
    socialSecurityMonthly:
      ps?.socialSecurityMonthly ?? settings.socialSecurityMonthly,
    // PIA is per person with no household value. null is "not opted in".
    socialSecurityPia: pp?.socialSecurityPia ?? null,
    ssStartAge: ps?.ssStartAge ?? settings.ssStartAge,
    ruleOf55Override: ps?.ruleOf55Override ?? settings.ruleOf55Override,
  };
}

/**
 * Each person's retirement settings in the active profile (per-person
 * age display and editing), with the what-if retirement age applied.
 */
export function perPersonSettingsFor(
  people: Awaited<ReturnType<typeof fetchRetirementData>>["people"],
  activeProfileRows: ActiveProfileRows,
  opts: { retirementAgeDelta?: number },
) {
  const perPersonSettings = people.map((p) => {
    const own = settingsFor(p.id, activeProfileRows);
    return {
      personId: p.id,
      name: p.name,
      birthYear: calendarYear(p.dateOfBirth),
      retirementAge: own.retirementAge + (opts.retirementAgeDelta ?? 0),
      endAge: own.endAge,
      // The effective raise rate: the per-person control edits it directly.
      salaryAnnualIncrease: String(own.salaryAnnualIncrease),
      socialSecurityMonthly: own.socialSecurityMonthly,
      socialSecurityPia: own.socialSecurityPia,
      ssStartAge: own.ssStartAge,
      ruleOf55Override: own.ruleOf55Override,
    };
  });

  return { perPersonSettings };
}
