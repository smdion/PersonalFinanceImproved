/** Roth basis at the transition after a gap year's draw. Invented figures. */
import { describe, it, expect } from "vitest";
import { computeTaxBucketProjection } from "@/lib/pure/accounts/tax-bucket-projection";
import type { AccountAnalysisEntry } from "@/lib/pure/accounts/tax-bucket-analysis";
import type { EngineYearProjection } from "@/lib/pure/engine/types/index";

const now: AccountAnalysisEntry = {
  performanceAccountId: 4,
  ownerPersonId: 1,
  ownerName: "Alex",
  category: "ira",
  taxType: "taxFree",
  displayName: "Roth IRA",
  balance: 50000,
  slices: [],
  ruleOf55: null,
  rothBasisMeta: {
    year: 2026,
    contributionBasis: 20000,
    conversionBasis: 10000,
    latestConversionYear: 2025,
  } as never,
  costBasis: null,
  ageThresholdStatus: null,
};

const row = (extra: object) =>
  [2026, 2027].map(
    (year, i) =>
      ({
        phase: "accumulation",
        year,
        individualAccountBalances: [
          {
            name: "Roth IRA",
            category: "ira",
            taxType: "taxFree",
            ownerPersonId: 1,
            balance: 40000,
            contribution: 0,
            ...(i === 1 ? extra : {}),
          },
        ],
      }) as EngineYearProjection,
  );

const meta = (extra: object) =>
  computeTaxBucketProjection({
    nowEntries: [now],
    projectionByYear: row(extra),
    people: [{ id: 1, name: "Alex", birthYear: 1980 }],
  }).entries[0]!.rothBasisMeta!;

describe("Roth basis at the transition", () => {
  it("reads the engine's two figures, whatever the draw order was", () => {
    expect(
      meta({
        rothContributionBasisRemaining: 6000,
        rothConversionBasisRemaining: 7000,
      }),
    ).toMatchObject({ contributionBasis: 6000, conversionBasis: 7000 });
  });
  it("zero left is zero, not the starting basis", () => {
    expect(
      meta({
        rothContributionBasisRemaining: 0,
        rothConversionBasisRemaining: 0,
      }),
    ).toMatchObject({ contributionBasis: 0, conversionBasis: 0 });
  });
  it("a row with no tracked basis falls back to the entry", () => {
    expect(meta({})).toMatchObject({
      contributionBasis: 20000,
      conversionBasis: 10000,
    });
  });
});
