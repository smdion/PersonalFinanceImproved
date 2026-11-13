/** A year's extra payday: the limit room an account's check past its covered ones may take is the
 *  person's, over all their rows in the group (the cap pass's figures). */
import { describe, expect, it } from "vitest";
import { extraCheckFields } from "@/lib/pure/contributions/extra-check-room";
import type { CappedContribution } from "@/lib/pure/contributions/contribution-caps";

const basis = { periodsPerYear: 26, salaryDivisor: 26, paydays: 27 };
const cap = (cappedAnnual: number): CappedContribution => ({
  group: "401k",
  annual: cappedAnnual,
  regularAnnual: cappedAnnual,
  bonusAnnual: 0,
  cappedAnnual,
  overBy: 0,
  limit: 24_500,
  maxEmployee: 24_500,
  reason: null,
});
const row = (cappedAnnual: number, othersInGroup: number) => ({
  capPassed: true as const,
  contributionMethod: "percent_of_salary" as const,
  cap: cap(cappedAnnual),
  othersInGroup,
});

describe("extraCheckFields", () => {
  it("an earlier employer's money this year leaves no room: 24,500 − 12,000 − 12,500 = 0", () => {
    expect(extraCheckFields(row(12_500, 12_000), basis)).toEqual({
      coveredChecks: 26,
      extraCheckLimit: { group: "401k", room: 0 },
    });
  });

  it("with no other rows: the person's most less this row's capped money", () => {
    expect(extraCheckFields(row(12_500, 0), basis)).toEqual({
      coveredChecks: 26,
      extraCheckLimit: { group: "401k", room: 12_000 },
    });
  });

  it("a year with no payday past the covered ones: no fields", () => {
    expect(extraCheckFields(row(12_500, 0), { ...basis, paydays: 26 })).toEqual(
      {},
    );
  });
});
