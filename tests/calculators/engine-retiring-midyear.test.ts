/**
 * B1a — retirementAge === currentAge fixture test.
 *
 * THIS TEST IS INTENTIONALLY RED until B1b (the engine fix) lands.
 *
 * Guards against the year-0 decumulation bug: when retirementAge === currentAge
 * AND firstYearFraction < 1 (retiring mid-calendar-year), the engine
 * incorrectly starts decumulation at y=0 instead of treating it as a final
 * partial accumulation year.
 *
 * See tests/fixtures/profiles/retiring-midyear.ts for full calculation trail
 * and option-b semantics rationale.
 */
import { describe, it, expect } from "vitest";
import { calculateProjection } from "@/lib/calculators/engine";
import {
  makeRetiringMidyearInput,
  RETIRING_MIDYEAR_AS_OF,
} from "../fixtures/profiles/retiring-midyear";

describe("engine: retirementAge === currentAge (B1a)", () => {
  it("year-0 is an accumulation year, not decumulation", () => {
    // Wall clock: 2026-04-14 → firstYearFraction = 9/12 = 0.75
    // currentAge = 65, retirementAge = 65
    // Bug: isAccumulation = (65 < 65) = false → y=0 runs as decumulation
    // Fix: when retirementAge === currentAge && firstYearFraction < 1,
    //      treat y=0 as a final partial accumulation year.
    const input = makeRetiringMidyearInput();
    const result = calculateProjection(input);

    const year0 = result.projectionByYear[0];
    expect(year0).toBeDefined();

    // PRIMARY ASSERTION — this is what makes the test red against the current engine.
    // The engine currently returns "decumulation" here.
    expect(year0!.phase).toBe("accumulation");
  });

  it("first decumulation year starts at age 66 (next calendar year after retirement)", () => {
    const input = makeRetiringMidyearInput();
    const result = calculateProjection(input);

    const firstDecumYear = result.projectionByYear.find(
      (y) => y.phase === "decumulation",
    );
    expect(firstDecumYear).toBeDefined();

    // With the fix, decumulation should begin at y=1 (age 66), NOT y=0 (age 65).
    // Currently the engine produces age=65 as the first decumulation year.
    expect(firstDecumYear!.age).toBe(66);
  });

  it("year-0 accumulation year is pro-rated by firstYearFraction (0.75)", () => {
    const input = makeRetiringMidyearInput();
    const result = calculateProjection(input);

    const year0 = result.projectionByYear[0];
    // Only meaningful after the fix — prior to fix, year0 is decumulation.
    // Accumulation year carries proRateFraction for the partial first year.
    if (year0?.phase === "accumulation") {
      // firstYearFraction = 9/12 = 0.75
      expect(year0.proRateFraction).toBeCloseTo(0.75, 5);
    } else {
      // Red path: year0 is decumulation — the primary assertion above already
      // fails. Duplicate the phase assertion so the failure is explicit here too.
      expect(year0?.phase).toBe("accumulation");
    }
  });

  it("total projection spans the expected number of years", () => {
    // currentAge=65, projectionEndAge=90 → 25 years (indices 0..24)
    const input = makeRetiringMidyearInput();
    const result = calculateProjection(input);
    expect(result.projectionByYear.length).toBe(25);
  });

  it("asOfDate round-trip: fixture uses 2026-04-14 wall clock", () => {
    // Sanity: confirm the fixture date drives the expected firstYearFraction.
    // month=3 (April), day=14 (≤15) → monthsRemaining = 12-3 = 9 → fraction = 0.75
    expect(RETIRING_MIDYEAR_AS_OF.getMonth()).toBe(3); // April
    expect(RETIRING_MIDYEAR_AS_OF.getDate()).toBe(14);
  });
});
