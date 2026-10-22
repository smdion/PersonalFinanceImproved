/** Missing and inconsistent basis. Invented figures only. */
import { describe, it, expect } from "vitest";
import {
  findBasisGaps,
  findMissingCostBasis,
  missingCostBasisWarning,
} from "@/lib/pure/basis-consistency";

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

describe("findMissingCostBasis", () => {
  const acct = (category: string, balance: number, costBasis: number) => ({
    category,
    balance,
    costBasis,
  });

  it("flags a brokerage holding money with no basis", () => {
    const a = acct("brokerage", 25000, 0);
    expect(findMissingCostBasis([a])).toEqual([a]);
  });

  it("leaves alone a brokerage with basis, an empty one, and non-brokerage accounts", () => {
    expect(
      findMissingCostBasis([
        acct("brokerage", 25000, 1),
        acct("brokerage", 0, 0),
        acct("brokerage", 0.4, 0),
        acct("401k", 90000, 0),
        acct("hsa", 5000, 0),
      ]),
    ).toEqual([]);
  });

  it("names the account and where to fix it", () => {
    const w = missingCostBasisWarning("Joint Brokerage");
    expect(w).toContain("Joint Brokerage has no cost basis entered");
    expect(w).toContain("Basis columns");
  });
});
