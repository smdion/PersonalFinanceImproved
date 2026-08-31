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
    config: {},
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

describe("formatDiscretionaryTierBreakdown — 'why this rate' explanations (found live, 2026-08-31: a household asked why Roth showed as cheaper than Brokerage)", () => {
  it("explains a $0-cost Roth entry as either tax-free basis OR 0%-bracket growth, not a flat claim of either", () => {
    const result = formatDiscretionaryTierBreakdown([
      { source: "roth", costRate: 0, amount: 1000 },
    ])!;
    expect(result).toMatch(/already-taxed Roth contributions/i);
    expect(result).toMatch(/Roth growth taxed at your current 0% bracket/i);
  });

  it("explains a $0-cost Brokerage entry as the 0% capital-gains room, not ambiguous like Roth", () => {
    const result = formatDiscretionaryTierBreakdown([
      { source: "brokerage", costRate: 0, amount: 1000 },
    ])!;
    expect(result).toMatch(/0% capital-gains bracket/i);
  });

  it("explains a nonzero Roth entry as growth taxed at the ordinary rate, distinct from tax-free contributions", () => {
    const result = formatDiscretionaryTierBreakdown([
      { source: "roth", costRate: 0.12, amount: 1000 },
    ])!;
    expect(result).toMatch(
      /Roth growth taxed at your 12\.0% ordinary income rate/i,
    );
    expect(result).toMatch(/not your tax-free contributions/i);
  });

  it("explains a nonzero HSA entry as a non-medical withdrawal taxed at the ordinary rate", () => {
    const result = formatDiscretionaryTierBreakdown([
      { source: "hsa", costRate: 0.22, amount: 1000 },
    ])!;
    expect(result).toMatch(/22\.0% ordinary income rate/i);
    expect(result).toMatch(/non-medical HSA withdrawal/i);
  });

  it("labels a real LTCG-bracket rate as the capital-gains rate, not generic 'marginal tax'", () => {
    const result = formatDiscretionaryTierBreakdown([
      { source: "brokerage", costRate: 0.2, amount: 1000 },
    ])!;
    expect(result).toMatch(/20\.0% long-term capital-gains rate/i);
  });

  it("labels an LTCG-plus-NIIT rate as including the Medicare surtax", () => {
    const result = formatDiscretionaryTierBreakdown([
      { source: "brokerage", costRate: 0.15 + 0.038, amount: 1000 },
    ])!;
    expect(result).toMatch(/Medicare surtax/i);
    expect(result).toMatch(/18\.8%/);
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

  it("names the actual configured bracket-fill rate and explains why that rate, not just 'your target bracket'", () => {
    const years = [
      decumYear({ year: 2040, config: { rothBracketTarget: 0.22 } }),
    ];
    const section = buildWithdrawalStrategyNarrative(years, noopDeflate);
    expect(section.narrative).toMatch(/22% tax bracket/);
    expect(section.narrative).toMatch(/Required Minimum Distribution/i);
    expect(section.narrative).toMatch(/avoids paying a higher rate today/i);
  });

  it("omits the bracket-rate explanation when no bracket target is configured for any year", () => {
    const years = [decumYear({ year: 2040, config: {} })];
    const section = buildWithdrawalStrategyNarrative(years, noopDeflate);
    expect(section.narrative).not.toMatch(/tax bracket before drawing/i);
  });

  it("uses the first year that has a configured bracket target, even if earlier years don't", () => {
    const years = [
      decumYear({ year: 2040, config: {} }),
      decumYear({ year: 2041, config: { rothBracketTarget: 0.12 } }),
    ];
    const section = buildWithdrawalStrategyNarrative(years, noopDeflate);
    expect(section.narrative).toMatch(/12% tax bracket/);
  });
});
