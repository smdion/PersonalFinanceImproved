/**
 * Invented households for the per-person retirement rows shape (money tag,
 * v0106-retirement-people.ts): the rows each path seeds, the rows it must
 * add, and what every reader of those rows reads, so the restore step, the
 * SQLite migrator and the PostgreSQL migrator are held to one list.
 */
import {
  settingsFor,
  type ActiveProfileRows,
} from "@/server/services/projection/engine-payload/settings-for";
import { pickProfileSettingsRow } from "@/lib/pure/household/retirement-profile";
import { getPrimaryPerson } from "@/lib/pure/household/primary-person";
import { toNumber } from "@/lib/utils/numbers";

export type Person = { id: number; name: string; is_primary_user: boolean };
export type Settings = {
  id: number;
  person_id: number;
  profile_id: number | null;
  retirement_age: number;
  end_age: number;
  salary_annual_increase: string;
  social_security_monthly: string;
  ss_start_age: number;
  rule_of_55_override: boolean;
};
export type PersonRow = {
  id: number;
  profile_id: number;
  person_id: number;
  retirement_age: number;
  end_age: number;
  social_security_monthly: string | null;
  social_security_pia: string | null;
  ss_start_age: number | null;
  rule_of_55_override: boolean | null;
  salary_annual_increase: string | null;
};

export const PEOPLE: Person[] = [
  { id: 1, name: "Invented A", is_primary_user: true },
  { id: 2, name: "Invented B", is_primary_user: false },
  { id: 3, name: "Invented C", is_primary_user: false },
];
export const PROFILES = [
  { id: 10, name: "Invented one row short" },
  { id: 11, name: "Invented no per-person rows" },
  { id: 12, name: "Invented person without settings" },
];

const settings = (
  id: number,
  person_id: number,
  profile_id: number | null,
  s: Partial<Settings> = {},
): Settings => ({
  id,
  person_id,
  profile_id,
  retirement_age: 60 + id,
  end_age: 90 + id,
  salary_annual_increase: "0.03",
  social_security_monthly: String(2000 + id * 10),
  ss_start_age: 67,
  rule_of_55_override: true,
  ...s,
});

export const SETTINGS: Settings[] = [
  // Profile 10: person 2 has settings and no per-person row.
  settings(1, 1, 10),
  settings(2, 2, 10, { ss_start_age: 70, rule_of_55_override: false }),
  // Profile 11: no per-person rows at all (a backup from before them).
  settings(3, 1, 11, { retirement_age: 55 }),
  settings(4, 2, 11, { social_security_monthly: "0" }),
  settings(5, 3, 11, { end_age: 100 }),
  // Profile 12: person 2 has neither row (left alone).
  settings(6, 1, 12),
  // No profile: never a per-person row.
  settings(7, 3, null),
];
/** Settings naming a profile that is gone: only a backup can hold it. */
export const BACKUP_ONLY_SETTINGS: Settings[] = [settings(8, 1, 99)];

export const HELD: PersonRow[] = [
  // Its own values differ from its settings row: kept as they are.
  {
    id: 1,
    profile_id: 10,
    person_id: 1,
    retirement_age: 58,
    end_age: 95,
    social_security_monthly: null,
    social_security_pia: "2100",
    ss_start_age: null,
    rule_of_55_override: null,
    salary_annual_increase: null,
  },
  {
    id: 2,
    profile_id: 12,
    person_id: 1,
    retirement_age: 62,
    end_age: 92,
    social_security_monthly: "1800",
    social_security_pia: null,
    ss_start_age: 68,
    rule_of_55_override: false,
    salary_annual_increase: null,
  },
];

/** The rows the shape adds, in order (ids from 3 on). */
export const ADDED: Omit<PersonRow, "id">[] = [2, 3, 4, 5].map((sid) => {
  const s = SETTINGS.find((x) => x.id === sid)!;
  return {
    profile_id: s.profile_id!,
    person_id: s.person_id,
    retirement_age: s.retirement_age,
    end_age: s.end_age,
    social_security_monthly: s.social_security_monthly,
    social_security_pia: null,
    ss_start_age: s.ss_start_age,
    rule_of_55_override: s.rule_of_55_override,
    salary_annual_increase: null,
  };
});

type Tables = {
  people: readonly Person[];
  retirement_settings: readonly Settings[];
  retirement_profile_people: readonly PersonRow[];
};

const num = (v: string | null) => (v == null ? null : toNumber(v));
const bool = (v: unknown) => (v == null ? null : Boolean(v));

/** Rows as drizzle gives them to the readers (camelCase, booleans). */
const settingsRow = (s: Settings) =>
  ({
    personId: s.person_id,
    profileId: s.profile_id,
    retirementAge: s.retirement_age,
    endAge: s.end_age,
    salaryAnnualIncrease: s.salary_annual_increase,
    socialSecurityMonthly: s.social_security_monthly,
    ssStartAge: s.ss_start_age,
    ruleOf55Override: Boolean(s.rule_of_55_override),
    // eslint-disable-next-line no-restricted-syntax -- invented rows hold only the fields the readers read
  }) as unknown as ActiveProfileRows["settings"];
const personRow = (r: PersonRow) =>
  ({
    profileId: r.profile_id,
    personId: r.person_id,
    retirementAge: r.retirement_age,
    endAge: r.end_age,
    socialSecurityMonthly: r.social_security_monthly,
    socialSecurityPia: r.social_security_pia,
    ssStartAge: r.ss_start_age,
    ruleOf55Override: bool(r.rule_of_55_override),
    // eslint-disable-next-line no-restricted-syntax -- invented rows hold only the fields the readers read
  }) as unknown as ActiveProfileRows["profilePeople"][number];

/** The planned retirement age services/profiles/retirement-year.ts reads
 *  for a person under a profile (its per-person row, else its settings
 *  row, else none). */
function plannedAge(t: Tables, profileId: number, personId: number) {
  return (
    t.retirement_profile_people.find(
      (r) => r.profile_id === profileId && r.person_id === personId,
    )?.retirement_age ??
    t.retirement_settings.find(
      (r) => r.person_id === personId && r.profile_id === profileId,
    )?.retirement_age ??
    null
  );
}

/** settingsFor as it read before the money tag: a person's settings row
 *  stood in for a missing per-person row (`pp ?? rs`). Frozen here so the
 *  tests compare the old read of the old rows with today's of the new. */
export function settingsBeforeTag(
  personId: number,
  profile: ActiveProfileRows,
): ReturnType<typeof settingsFor> {
  const { activeProfileId, settings } = profile;
  const pp = profile.profilePeople.find((r) => r.personId === personId);
  const rs = profile.retSettings.find(
    (s) => s.personId === personId && s.profileId === activeProfileId,
  );
  const ps = pp ?? rs;
  const ownRaiseRate = rs ? toNumber(rs.salaryAnnualIncrease) : NaN;
  return {
    retirementAge: ps?.retirementAge ?? settings.retirementAge,
    endAge: ps?.endAge ?? settings.endAge,
    salaryAnnualIncrease: Number.isFinite(ownRaiseRate)
      ? ownRaiseRate
      : profile.primaryRaiseRate,
    socialSecurityMonthly:
      ps?.socialSecurityMonthly ?? settings.socialSecurityMonthly,
    socialSecurityPia: pp?.socialSecurityPia ?? null,
    ssStartAge: ps?.ssStartAge ?? settings.ssStartAge,
    ruleOf55Override: ps?.ruleOf55Override ?? settings.ruleOf55Override,
  };
}

/**
 * What every reader of these rows reads, for each profile with a household
 * row and each person: the engine's per-person settings (settingsFor) and
 * the planned retirement age. Numbers compared as numbers, so PostgreSQL's
 * "2010.00" reads as SQLite's 2010.
 */
export function reads(t: Tables, read = settingsFor) {
  const people = t.people.map((p) => ({
    id: p.id,
    isPrimaryUser: Boolean(p.is_primary_user),
  }));
  const primary = getPrimaryPerson(people);
  const rs = t.retirement_settings.map(settingsRow);
  return PROFILES.flatMap((profile) => {
    const household = pickProfileSettingsRow(rs, profile.id, primary!.id);
    if (!household) return [];
    const rows: ActiveProfileRows = {
      activeProfileId: profile.id,
      profilePeople: t.retirement_profile_people
        .filter((r) => r.profile_id === profile.id)
        .map(personRow),
      retSettings: rs,
      settings: household,
      primaryRaiseRate: toNumber(household.salaryAnnualIncrease),
    };
    return t.people.map((p) => {
      const own = read(p.id, rows);
      return {
        profile: profile.id,
        person: p.id,
        ...own,
        socialSecurityMonthly: num(own.socialSecurityMonthly),
        socialSecurityPia: num(own.socialSecurityPia),
        ruleOf55Override: bool(own.ruleOf55Override),
        plannedAge: plannedAge(t, profile.id, p.id),
      };
    });
  });
}
