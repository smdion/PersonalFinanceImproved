/* eslint-disable no-restricted-syntax -- as unknown as casts required to build minimal EngineDecumulationYear fixtures without satisfying every unrelated field of the full engine type */
import { describe, it, expect } from "vitest";
import {
  formatDiscretionaryTierBreakdown,
  formatRmdDivisorDetail,
  buildWithdrawalStrategyNarrative,
} from "@/lib/pure/report/withdrawal-strategy-narrative";
import type { EngineDecumulationYear } from "@/lib/calculators/types/engine-projection";

const noopDeflate = (v: number) => v;

function decumYear(
  overrides: Partial<EngineDecumulationYear> = {},
): EngineDecumulationYear {
  return {
    year: 2040,
    age: 65,
    phase: "decumulation",
    ...overrides,
  } as unknown as EngineDecumulationYear;
}

describe("formatDiscretionaryTierBreakdown / formatRmdDivisorDetail (moved, unchanged behavior)", () => {
  it("still formats a discretionary tier breakdown", () => {
    const result = formatDiscretionaryTierBreakdown([
      { source: "roth", costRate: 0, amount: 1000 },
    ]);
    expect(result).toContain("$1,000.00 Roth");
    expect(result).toContain("cheapest available");
  });

  it("still formats an RMD divisor detail", () => {
    const result = formatRmdDivisorDetail(
      { rmdDivisor: 25.5, priorYearEndTradBalance: 100000 },
      noopDeflate,
      2040,
    );
    expect(result).toContain("÷ 25.5");
  });
});

describe("buildWithdrawalStrategyNarrative", () => {
  it("mentions both bracket-filling and RMDs when the household has RMD years and discretionary years", () => {
    const years = [
      decumYear({
        year: 2040,
        rmdDivisor: 25.5,
        priorYearEndTradBalance: 200000,
      }),
      decumYear({
        year: 2041,
        discretionaryTierBreakdown: [
          { source: "brokerage", costRate: 0.15, amount: 5000 },
        ],
      }),
    ];
    const section = buildWithdrawalStrategyNarrative(years, noopDeflate);
    expect(section.narrative).toMatch(/tax bracket/i);
    expect(section.narrative).toMatch(/IRS requires distributions/i);
    expect(section.highlights.length).toBeGreaterThan(0);
  });

  it("does not mention RMDs for a pre-RMD-age household (no RMD years at all)", () => {
    const years = [decumYear({ year: 2040 })];
    const section = buildWithdrawalStrategyNarrative(years, noopDeflate);
    expect(section.narrative).not.toMatch(
      /required minimum distribution|IRS requires/i,
    );
  });

  it("includes an RMD highlight only for the first year with real divisor detail, not every year", () => {
    const years = [
      decumYear({ year: 2040 }), // no RMD fields
      decumYear({
        year: 2041,
        rmdDivisor: 25.5,
        priorYearEndTradBalance: 200000,
      }),
      decumYear({
        year: 2042,
        rmdDivisor: 24.6,
        priorYearEndTradBalance: 190000,
      }),
    ];
    const section = buildWithdrawalStrategyNarrative(years, noopDeflate);
    const rmdHighlights = section.highlights.filter((h) =>
      /Required Minimum/.test(h.detail),
    );
    expect(rmdHighlights).toHaveLength(1);
    expect(rmdHighlights[0]!.year).toBe(2041);
  });

  it("produces no highlights and a generic narrative for a household with neither RMDs nor discretionary withdrawals", () => {
    const years = [decumYear({ year: 2040 })];
    const section = buildWithdrawalStrategyNarrative(years, noopDeflate);
    expect(section.highlights).toHaveLength(0);
    expect(section.narrative.length).toBeGreaterThan(0);
  });
});
