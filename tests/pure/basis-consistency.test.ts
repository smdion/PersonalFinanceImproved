/** Roth conversion basis consistency across years. Invented figures only. */
import { describe, it, expect } from "vitest";
import { findBasisGaps } from "@/lib/pure/basis-consistency";

const row = (
  year: number,
  conversionBasis: number,
  latestConversionYear: number | null,
  ownerPersonId = 1,
) => ({
  performanceAccountId: 3,
  ownerPersonId,
  year,
  conversionBasis,
  latestConversionYear,
});

describe("findBasisGaps", () => {
  it("flags a year short of a conversion a later row dates to it", () => {
    expect(
      findBasisGaps([
        row(2024, 0, null),
        row(2025, 0, null),
        row(2026, 500, 2025),
      ]),
    ).toEqual([
      {
        performanceAccountId: 3,
        ownerPersonId: 1,
        year: 2025,
        recorded: 0,
        expected: 500,
        fromYear: 2026,
      },
    ]);
  });

  it("accepts consistent history, later withdrawals, and other people's rows", () => {
    expect(
      findBasisGaps([
        row(2025, 500, 2025),
        row(2026, 400, 2025), // reduced by a withdrawal later
        row(2025, 0, null, 2),
        row(2026, 0, null, 2),
      ]),
    ).toEqual([]);
  });
});
