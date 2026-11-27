import "../../../helpers/setup-mocks";
import { describe, it, expect } from "vitest";
import { hasNegativeMatch } from "@/server/services/contributions/negative-match-notes";

const terms = {
  employerMatchType: "percent_of_contribution" as const,
  employerMatchValue: null,
  employerMatchRate: "0.5",
  employerMaxMatchPct: "0.06",
};

describe("an employer match saved below 0", () => {
  it("is found on a flat match's dollars and a percent match's rate or percent", () => {
    expect(
      hasNegativeMatch({
        ...terms,
        employerMatchType: "dollar_match",
        employerMatchValue: "-1500",
        employerMatchRate: null,
      }),
    ).toBe(true);
    expect(hasNegativeMatch({ ...terms, employerMatchRate: "-0.5" })).toBe(
      true,
    );
    expect(hasNegativeMatch({ ...terms, employerMaxMatchPct: "-0.06" })).toBe(
      true,
    );
    expect(
      hasNegativeMatch({
        ...terms,
        employerMatchValue: "-50",
        employerMatchRate: null,
      }),
    ).toBe(true);
  });

  it("isn't a match of 0 or above, or no match at all", () => {
    expect(hasNegativeMatch(terms)).toBe(false);
    expect(
      hasNegativeMatch({
        ...terms,
        employerMatchType: "fixed_annual",
        employerMatchValue: "0",
      }),
    ).toBe(false);
    expect(
      hasNegativeMatch({
        ...terms,
        employerMatchType: null,
        employerMatchValue: "-5",
      }),
    ).toBe(false);
  });
});
