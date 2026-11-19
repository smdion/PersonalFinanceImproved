import { describe, it, expect } from "vitest";
import { shortfallPartsInUnmet } from "@/lib/pure/engine/projection-year-handlers/shortfall-parts";

describe("shortfallPartsInUnmet", () => {
  it("takes each part's share from routing and its amount from the unmet need", () => {
    // Routing fell $4,406.86 short of its trial, all of it locked; the year's
    // unmet need after tax is $24,055.56, so the locked part is all of that.
    expect(
      shortfallPartsInUnmet(
        { routedUnmetNeed: 4406.86, penaltyAvoidedShortfall: 4406.86 },
        24055.56,
      ),
    ).toEqual({
      penaltyAvoidedShortfall: 24055.56,
      nonRetirementShortfall: undefined,
    });
  });

  it("keeps routing's share when only part of its shortfall is locked", () => {
    // $1,000 of $4,000 routed short is locked: a quarter of $10,000.
    expect(
      shortfallPartsInUnmet(
        { routedUnmetNeed: 4000, penaltyAvoidedShortfall: 1000 },
        10000,
      ).penaltyAvoidedShortfall,
    ).toBe(2500);
  });

  it("overlapping parts may each be the whole unmet need, never more", () => {
    const parts = shortfallPartsInUnmet(
      {
        routedUnmetNeed: 500,
        penaltyAvoidedShortfall: 500,
        nonRetirementShortfall: 500,
      },
      800,
    );
    expect(parts).toEqual({
      penaltyAvoidedShortfall: 800,
      nonRetirementShortfall: 800,
    });
  });

  it("a part routing didn't report stays absent", () => {
    expect(shortfallPartsInUnmet({}, 1200)).toEqual({
      penaltyAvoidedShortfall: undefined,
      nonRetirementShortfall: undefined,
    });
  });

  it("throws on a part with no routing shortfall to take a share of", () => {
    expect(() =>
      shortfallPartsInUnmet({ penaltyAvoidedShortfall: 10 }, 100),
    ).toThrow(/no routing shortfall/);
    expect(() =>
      shortfallPartsInUnmet(
        { routedUnmetNeed: 0, nonRetirementShortfall: 10 },
        100,
      ),
    ).toThrow(/no routing shortfall/);
  });
});
