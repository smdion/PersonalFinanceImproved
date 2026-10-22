/** Tax Buckets "at retirement": a brokerage's cost basis is the engine's
 *  own per-account figure. Invented figures only. */
import { describe, it, expect } from "vitest";
import { computeTaxBucketProjection } from "@/lib/pure/tax-bucket-projection";
import type { AccountAnalysisEntry } from "@/lib/pure/tax-bucket-analysis";
import type { EngineYearProjection } from "@/lib/calculators/types/engine-projection";

const now: AccountAnalysisEntry = {
  performanceAccountId: 4,
  ownerPersonId: 1,
  ownerName: "Alex",
  category: "brokerage",
  taxType: "afterTax",
  displayName: "Retirement Brokerage",
  balance: 20000,
  slices: [],
  ruleOf55: null,
  rothBasisMeta: null,
  costBasis: 10000,
  ageThresholdStatus: null,
};

/** Two accumulation years; $3k contributed each year. */
function years(costBasis?: number): EngineYearProjection[] {
  return [2026, 2027].map(
    (year, i) =>
      ({
        phase: "accumulation",
        year,
        individualAccountBalances: [
          {
            name: "Retirement Brokerage",
            category: "brokerage",
            taxType: "afterTax",
            ownerPersonId: 1,
            balance: 26000 + i * 4000,
            contribution: 3000,
            ...(i === 1 && costBasis != null ? { costBasis } : {}),
          },
        ],
      }) as EngineYearProjection,
  );
}

const project = (rows: EngineYearProjection[]) =>
  computeTaxBucketProjection({
    nowEntries: [now],
    projectionByYear: rows,
    people: [{ id: 1, name: "Alex", birthYear: 1980 }],
  }).entries[0]!;

describe("computeTaxBucketProjection — brokerage cost basis", () => {
  it("reads the engine's per-account basis at the transition", () => {
    // The engine moved basis differently than "start + contributions"
    // (e.g. a lump sum): its figure wins.
    const entry = project(years(21000));
    expect(entry.costBasis).toBe(21000);
    expect(entry.balance).toBe(30000);
  });

  it("falls back to start + contributions when the row has no basis", () => {
    expect(project(years()).costBasis).toBe(16000);
  });
});
