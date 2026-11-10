/**
 * A "Changes by year" row naming a profile that is gone keeps its absent
 * state and says so (owner FQ6).
 */
import { describe, expect, it } from "vitest";
import { missingSwitchProfileWarnings } from "@/lib/pure/retirement/missing-switch-profiles";

const contribution = new Map([[3, {}]]);
const salary = new Map([[5, {}]]);

describe("missingSwitchProfileWarnings", () => {
  it("is quiet when every named profile exists, or the row names none", () => {
    expect(
      missingSwitchProfileWarnings(
        [
          {
            projectionYear: 2030,
            contributionProfileId: 3,
            salaryProfileId: 5,
          },
          {
            projectionYear: 2031,
            contributionProfileId: null,
            salaryProfileId: null,
          },
        ],
        contribution,
        salary,
      ),
    ).toEqual([]);
  });

  it("names the year and the kind of each profile that is gone", () => {
    expect(
      missingSwitchProfileWarnings(
        [
          {
            projectionYear: 2032,
            contributionProfileId: 9,
            salaryProfileId: 5,
          },
          {
            projectionYear: 2035,
            contributionProfileId: 9,
            salaryProfileId: 8,
          },
        ],
        contribution,
        salary,
      ),
    ).toEqual([
      "The 2032 row in Changes by year names a Contribution Profile that no longer exists, so that part of it changes nothing. Pick another profile or delete the row.",
      "The 2035 row in Changes by year names a Contribution Profile that no longer exists, so that part of it changes nothing. Pick another profile or delete the row.",
      "The 2035 row in Changes by year names a Salary Profile that no longer exists, so that part of it changes nothing. Pick another profile or delete the row.",
    ]);
  });
});
