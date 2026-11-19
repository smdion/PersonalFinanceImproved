/**
 * A person's birth year is the one in `people`: the engine gates each
 * account on its owner's, and refuses an input whose other copies of a
 * person's age disagree with it (`input-validation.ts`, `context.ts`).
 */
import { describe, expect, it } from "vitest";
import { calculateProjection } from "@/lib/pure/engine";
import type {
  EngineDecumulationYear,
  ProjectionInput,
} from "@/lib/pure/engine/types";
import { acct, household } from "../fixtures/two-person-household";

/** Ann and Bo, both 50 in 2026 (born 1976), Ann's Roth IRA all growth. */
const couple = (overrides: Partial<ProjectionInput> = {}) =>
  household(
    [
      acct("Ann Roth IRA", "ira", 400000, 1, "taxFree"),
      acct("Bo Brokerage", "brokerage", 400000, 2, "afterTax"),
    ],
    {
      asOfDate: new Date("2026-01-01"),
      currentAge: 50,
      birthYear: 1976,
      perPersonBirthYears: [1976, 1976],
      socialSecurityEntries: [1, 2].map((personId) => ({
        personId,
        personName: personId === 1 ? "Ann" : "Bo",
        birthYear: 1976,
        startAge: 70,
        annualAmount: 0,
      })),
      retirementYear: 2026,
      projectionEndYear: 2030,
      currentSalary: 0,
      annualExpenses: 40000,
      decumulationAnnualExpenses: 40000,
      ...overrides,
    },
  );

describe("one birth year per person", () => {
  it("an account's owner is gated on their age in people, whatever the account says", () => {
    const input = couple();
    const stated = {
      ...input,
      individualAccounts: input.individualAccounts.map((ia) =>
        ia.ownerPersonId === 1 ? { ...ia, ownerBirthYear: 1940 } : ia,
      ),
    };
    const first = (i: ProjectionInput) =>
      calculateProjection(i).projectionByYear.find(
        (y): y is EngineDecumulationYear => y.phase === "decumulation",
      )!;
    const roth = first(stated).individualAccountBalances.find(
      (a) => a.name === "Ann Roth IRA",
    );
    // Ann is 50: her Roth growth is locked, not qualified as at 86.
    expect(roth?.draw?.eligibilityLocked).toBe(true);
    expect(first(stated)).toEqual(first(input));
  });

  it.each([
    [
      "an owner who isn't among the people",
      { people: [{ personId: 2, birthYear: 1976, birthMonth: 1 }] },
      `Account "Ann Roth IRA" names owner 1, who isn't among the household's people`,
    ],
    [
      "a primary person who isn't among the people",
      { primaryPersonId: 3 },
      "The engine input names no primary person",
    ],
    [
      "an age that isn't the primary person's",
      { currentAge: 49 },
      "currentAge 49 disagrees with person 1's birth year 1976 (age 50)",
    ],
    [
      "per-person birth years that aren't the people's",
      { perPersonBirthYears: [1976, 1980] },
      "perPersonBirthYears 1976, 1980 disagree with the people's birth years 1976, 1976",
    ],
  ])("refuses %s", (_case, overrides, message) => {
    expect(() => calculateProjection({ ...couple(), ...overrides })).toThrow(
      message,
    );
  });
});
