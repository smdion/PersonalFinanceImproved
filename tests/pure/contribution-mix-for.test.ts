/** Which paycheck setup splits a person's deposits. Invented figures only. */
import { describe, it, expect } from "vitest";
import {
  mixFor,
  type AccountContributionMix,
} from "@/lib/pure/flow-suggestions";

const m = (employer: number, employeePreTax: number) => ({
  employeePreTax,
  employeeRoth: 0,
  employeeOther: 0,
  employer,
  employerRoth: 0,
});

const mix = new Map<number, AccountContributionMix>([
  [
    1,
    {
      ...m(3000, 9000),
      remainingThisYear: 0, // mixFor reads the split only
      perContribution: 0,
      byPerson: new Map([
        [10, m(1000, 6000)],
        [20, m(2000, 3000)],
      ]),
    },
  ],
]);

describe("mixFor", () => {
  it("uses each person's own setup on an account two paychecks feed", () => {
    expect(mixFor(mix, 1, 20)).toEqual(m(2000, 3000));
  });
  it("uses the account total for a row covering everyone", () => {
    expect(mixFor(mix, 1, null)).toMatchObject(m(3000, 9000));
  });
  it("gives no setup to a person whose paycheck doesn't feed the account", () => {
    expect(mixFor(mix, 1, 30)).toBeNull();
    expect(mixFor(mix, 2, 10)).toBeNull();
  });
});
