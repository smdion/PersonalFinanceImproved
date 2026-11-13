import "../../../../routers/setup-mocks";
import { describe, it, expect } from "vitest";
import {
  settingsFor,
  perPersonSettingsFor,
  type ActiveProfileRows,
} from "@/server/services/projection/engine-payload/settings-for";
import { buildSocialSecurityEntries } from "@/lib/pure/retirement/social-security-entries";

// An invented household: profile 1 is active, profile 2 is another one.
// Each person's settings come from their own profile-people row in the
// active profile, or the profile's household row where a field is empty.
type Rows = ActiveProfileRows;
type SettingsRow = Rows["settings"];
type ProfilePersonRow = Rows["profilePeople"][number];

const household = {
  personId: 1,
  profileId: 1,
  retirementAge: 65,
  endAge: 95,
  salaryAnnualIncrease: "0.03",
  withdrawalRate: "0.04",
  socialSecurityMonthly: "2000",
  ssStartAge: 67,
  ruleOf55Override: false,
} as SettingsRow;

const settingsRow = (over: Partial<SettingsRow>) =>
  ({ ...household, ...over }) as SettingsRow;
const profilePerson = (over: Partial<ProfilePersonRow>) =>
  ({
    profileId: 1,
    personId: 2,
    retirementAge: 60,
    endAge: 90,
    socialSecurityMonthly: "1500",
    socialSecurityPia: "1800",
    ssStartAge: 70,
    ruleOf55Override: true,
    salaryAnnualIncrease: "0.09",
    ...over,
  }) as ProfilePersonRow;

const rows = (over: Partial<Rows> = {}): Rows => ({
  activeProfileId: 1,
  profilePeople: [],
  retSettings: [household],
  settings: household,
  primaryRaiseRate: 0.03,
  ...over,
});

const householdValues = {
  retirementAge: 65,
  endAge: 95,
  salaryAnnualIncrease: 0.03,
  socialSecurityMonthly: "2000",
  socialSecurityPia: null,
  ssStartAge: 67,
  ruleOf55Override: false,
};

describe("settingsFor", () => {
  it("a person with no rows reads the profile's household values", () => {
    expect(settingsFor(2, rows())).toEqual(householdValues);
  });

  const ownSettings = (profileId: number | null) =>
    settingsRow({
      personId: 2,
      profileId,
      retirementAge: 62,
      endAge: 92,
      salaryAnnualIncrease: "0.05",
      socialSecurityMonthly: "1200",
      ssStartAge: 68,
      ruleOf55Override: true,
    });

  it("with no profile, a retirement_settings row: its values, and no PIA", () => {
    const own = ownSettings(null);
    const noProfile = { ...household, profileId: null };
    expect(
      settingsFor(
        2,
        rows({
          activeProfileId: null,
          retSettings: [noProfile, own],
          settings: noProfile,
        }),
      ),
    ).toEqual({
      retirementAge: 62,
      endAge: 92,
      salaryAnnualIncrease: 0.05,
      socialSecurityMonthly: "1200",
      socialSecurityPia: null,
      ssStartAge: 68,
      ruleOf55Override: true,
    });
  });

  it("in a profile, ages come from the profile-people row, never the settings row", () => {
    // The money migration gives every such settings row its profile-people row.
    const own = ownSettings(1);
    expect(settingsFor(2, rows({ retSettings: [household, own] }))).toEqual({
      ...householdValues,
      salaryAnnualIncrease: 0.05,
    });
  });

  it("a profile-people row only: its values, the raise rate falls back", () => {
    expect(
      settingsFor(2, rows({ profilePeople: [profilePerson({})] })),
    ).toEqual({
      retirementAge: 60,
      endAge: 90,
      // The profile-people column is never read for the raise rate.
      salaryAnnualIncrease: 0.03,
      socialSecurityMonthly: "1500",
      socialSecurityPia: "1800",
      ssStartAge: 70,
      ruleOf55Override: true,
    });
  });

  it("a profile-people row's empty field reads the household value", () => {
    const pp = profilePerson({ ssStartAge: null, ruleOf55Override: null });
    const own = settingsFor(2, rows({ profilePeople: [pp] }));
    expect(own.ssStartAge).toBe(67);
    expect(own.ruleOf55Override).toBe(false);
  });

  it("an explicit 0 raise rate stays 0", () => {
    const own = settingsRow({ personId: 2, salaryAnnualIncrease: "0" });
    expect(
      settingsFor(2, rows({ retSettings: [household, own] }))
        .salaryAnnualIncrease,
    ).toBe(0);
  });

  it("another profile's row never stands in", () => {
    const other = settingsRow({
      personId: 2,
      profileId: 2,
      retirementAge: 55,
      salaryAnnualIncrease: "0.07",
    });
    expect(settingsFor(2, rows({ retSettings: [household, other] }))).toEqual(
      householdValues,
    );
  });
});

describe("perPersonSettingsFor", () => {
  it("a January 1 birth claims on the prior year's FRA, in its own birth year", () => {
    // PIA 2,000 a month claimed at 67 (804 months): born 1960-01-01, FRA
    // is 66y 10m (20 CFR 404.102), so 2 months of credits at 2/3% each
    // (20 CFR 404.313): 2,026.67, not 1960's FRA of 67 and 2,000.
    const people = [
      { id: 1, name: "Avery", dateOfBirth: "1960-01-01" },
    ] as Parameters<typeof perPersonSettingsFor>[0];
    const [avery] = perPersonSettingsFor(
      people,
      rows({}),
      {},
    ).perPersonSettings;
    expect(avery).toMatchObject({ birthYear: 1960, dateOfBirth: "1960-01-01" });
    const [entry] = buildSocialSecurityEntries(
      [{ ...avery!, socialSecurityPia: "2000", ssStartAge: 67 }],
      "Single",
    );
    expect(entry!.birthYear).toBe(1960);
    expect(entry!.annualAmount / 12).toBeCloseTo(2_026.67, 2);
  });

  it("adds the what-if retirement age and shows the raise rate as text", () => {
    const people = [
      { id: 1, name: "Avery", dateOfBirth: "1980-04-02" },
      { id: 2, name: "Blake", dateOfBirth: "1982-09-15" },
    ] as Parameters<typeof perPersonSettingsFor>[0];
    const { perPersonSettings } = perPersonSettingsFor(
      people,
      rows({ profilePeople: [profilePerson({})] }),
      { retirementAgeDelta: 2 },
    );
    expect(perPersonSettings).toEqual([
      {
        personId: 1,
        name: "Avery",
        birthYear: 1980,
        dateOfBirth: "1980-04-02",
        retirementAge: 67,
        endAge: 95,
        salaryAnnualIncrease: "0.03",
        socialSecurityMonthly: "2000",
        socialSecurityPia: null,
        ssStartAge: 67,
        ruleOf55Override: false,
      },
      {
        personId: 2,
        name: "Blake",
        birthYear: 1982,
        dateOfBirth: "1982-09-15",
        retirementAge: 62,
        endAge: 90,
        salaryAnnualIncrease: "0.03",
        socialSecurityMonthly: "1500",
        socialSecurityPia: "1800",
        ssStartAge: 70,
        ruleOf55Override: true,
      },
    ]);
  });
});
