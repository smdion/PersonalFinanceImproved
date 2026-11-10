import { describe, expect, it } from "vitest";
import { firstBreakEvenYear } from "@/lib/pure/retirement/conversion-break-even";

const row = (year: number, withPlan: number, without: number) => ({
  year,
  cumulativeTaxWith: withPlan,
  cumulativeTaxWithout: without,
});

describe("firstBreakEvenYear", () => {
  it("is the first year the plan's cumulative tax is below none's", () => {
    // Converting costs 10,000 up front; lower RMD tax catches up in 2031.
    expect(
      firstBreakEvenYear([
        row(2029, 10_000, 2_000),
        row(2030, 14_000, 9_000),
        row(2031, 17_000, 17_500),
        row(2032, 19_000, 26_000),
      ]),
    ).toBe(2031);
  });

  it("is null when the plan never gets below, a tie included", () => {
    expect(
      firstBreakEvenYear([row(2029, 10_000, 2_000), row(2030, 12_000, 12_000)]),
    ).toBeNull();
    expect(firstBreakEvenYear([])).toBeNull();
  });
});
