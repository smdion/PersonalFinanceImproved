import "../../routers/setup-mocks";
import { describe, it, expect } from "vitest";
import { ageStepAt } from "@/server/retirement/payload/profile-switches";
import type { ProfileSwitch } from "@/lib/calculators/types";

// Relocation's move-year switch: the relocation profile as capped by the
// move year's ages (its latest age step by then).
const step = (year: number, rate: number) =>
  ({ year, contributionRate: rate }) as ProfileSwitch;

describe("ageStepAt", () => {
  const steps = [step(2040, 0.2), step(2050, 0.25)];

  it("takes the latest step by the year, starting at the year", () => {
    expect(ageStepAt(steps, 2045)).toMatchObject({
      year: 2045,
      contributionRate: 0.2,
    });
    expect(ageStepAt(steps, 2050)).toMatchObject({
      year: 2050,
      contributionRate: 0.25,
    });
  });

  it("none before the first step (today's caps apply)", () => {
    expect(ageStepAt(steps, 2039)).toBeUndefined();
    expect(ageStepAt([], 2045)).toBeUndefined();
  });
});
