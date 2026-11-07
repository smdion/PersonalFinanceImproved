import "../../../../routers/setup-mocks";
import { describe, it, expect } from "vitest";
import {
  settingsFor,
  perPersonSettingsFor,
  type ActiveProfileRows,
} from "@/server/services/projection/engine-payload/settings-for";

// An invented household: profile 1 is active, profile 2 is another one.
// Each person's settings come from their own rows in the active profile,
// or the profile's household row where they have none (a restored older
// backup can lack a person's row).
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
  withdrawalRate: "0.04",
  socialSecurityMonthly: "2000",
  socialSecurityPia: null,
  ssStartAge: 67,
  ruleOf55Override: false,
};

describe("settingsFor", () => {
  it("a person with no rows reads the profile's household values", () => {
    expect(settingsFor(2, rows())).toEqual(householdValues);
  });

  it("a retirement_settings row only: its values, and no PIA", () => {
    const own = settingsRow({
      personId: 2,
      retirementAge: 62,
      endAge: 92,
      salaryAnnualIncrease: "0.05",
      withdrawalRate: "0.035",
      socialSecurityMonthly: "1200",
      ssStartAge: 68,
      ruleOf55Override: true,
    });
    expect(settingsFor(2, rows({ retSettings: [household, own] }))).toEqual({
      retirementAge: 62,
      endAge: 92,
      salaryAnnualIncrease: 0.05,
      withdrawalRate: "0.035",
      socialSecurityMonthly: "1200",
      socialSecurityPia: null,
      ssStartAge: 68,
      ruleOf55Override: true,
    });
  });

  it("a profile-people row only: its values, the raise and withdrawal rates fall back", () => {
    expect(
      settingsFor(2, rows({ profilePeople: [profilePerson({})] })),
    ).toEqual({
      retirementAge: 60,
      endAge: 90,
      // The profile-people column is never read for the raise rate.
      salaryAnnualIncrease: 0.03,
      withdrawalRate: "0.04",
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
      withdrawalRate: "0.05",
    });
    expect(settingsFor(2, rows({ retSettings: [household, other] }))).toEqual(
      householdValues,
    );
  });
});

describe("perPersonSettingsFor", () => {
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
        retirementAge: 67,
        endAge: 95,
        salaryAnnualIncrease: "0.03",
        withdrawalRate: "0.04",
        socialSecurityMonthly: "2000",
        socialSecurityPia: null,
        ssStartAge: 67,
        ruleOf55Override: false,
      },
      {
        personId: 2,
        name: "Blake",
        birthYear: 1982,
        retirementAge: 62,
        endAge: 90,
        salaryAnnualIncrease: "0.03",
        withdrawalRate: "0.04",
        socialSecurityMonthly: "1500",
        socialSecurityPia: "1800",
        ssStartAge: 70,
        ruleOf55Override: true,
      },
    ]);
  });
});
