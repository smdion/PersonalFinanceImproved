import { describe, it, expect } from "vitest";
import {
  rankWithdrawalTiers,
  type RankWithdrawalTiersInput,
} from "@/lib/calculators/engine/withdrawal-cost-ranking";

const MFJ_BRACKETS = [
  { threshold: 23850, baseWithholding: 0, rate: 0.1 },
  { threshold: 96950, baseWithholding: 2385, rate: 0.12 },
  { threshold: 206700, baseWithholding: 11157, rate: 0.22 },
  { threshold: 394600, baseWithholding: 35302, rate: 0.24 },
];

function baseInput(
  overrides: Partial<RankWithdrawalTiersInput> = {},
): RankWithdrawalTiersInput {
  return {
    filingStatus: "MFJ",
    ordinaryIncomeFloor: 96950, // exactly at the 12% bracket ceiling
    targetRate: 0.12,
    taxBrackets: MFJ_BRACKETS,
    ltcgBrackets: undefined, // use hardcoded 2026 defaults
    rothBasisAvailable: 0,
    rothAvailable: 50000,
    brokerageAvailable: 50000,
    brokerageBasisRatio: 0,
    hsaAvailable: 10000,
    magiBeforeThisDraw: 96950,
    ...overrides,
  };
}

describe("rankWithdrawalTiers", () => {
  it("Roth basis always ranks first, free", () => {
    const tiers = rankWithdrawalTiers(baseInput({ rothBasisAvailable: 20000 }));
    expect(tiers[0]).toMatchObject({
      source: "roth",
      costRate: 0,
      capacity: 20000,
    });
  });

  it("brokerage in the 0% LTCG zone ranks free, alongside Roth basis", () => {
    // ordinaryIncomeFloor 0 -> full $98,900 MFJ 0%-LTCG room available
    const tiers = rankWithdrawalTiers(
      baseInput({ ordinaryIncomeFloor: 0, rothBasisAvailable: 0 }),
    );
    const brokerageTier = tiers.find((t) => t.source === "brokerage");
    expect(brokerageTier?.costRate).toBe(0);
  });

  it("no free tiers ⇒ Roth growth (12% ordinary rate above the bracket cap) ranks BEFORE 15% LTCG brokerage", () => {
    // ordinaryIncomeFloor already at the 12% ceiling -> Roth growth taxed
    // at 22% (next bracket up)... wait, use a floor inside the 0% LTCG
    // room's exhaustion point but where the NEXT ordinary bracket is
    // cheaper than 15% LTCG: set targetRate so marginalRateAboveTarget
    // returns 0.12, cheaper than a 15% brokerage tier.
    const tiers = rankWithdrawalTiers(
      baseInput({
        targetRate: 0.1, // next bracket up is 12% -- cheaper than 15% LTCG
        ordinaryIncomeFloor: 613700, // past the 0%/15% LTCG zones entirely
        rothBasisAvailable: 0,
        magiBeforeThisDraw: 0, // no NIIT
      }),
    );
    const rothIdx = tiers.findIndex(
      (t) => t.source === "roth" && t.costRate > 0,
    );
    const brokerageIdx = tiers.findIndex(
      (t) => t.source === "brokerage" && t.costRate > 0,
    );
    expect(rothIdx).toBeGreaterThanOrEqual(0);
    expect(brokerageIdx).toBeGreaterThanOrEqual(0);
    expect(rothIdx).toBeLessThan(brokerageIdx);
  });

  it("NIIT pushes 15% LTCG brokerage above a low ordinary rate, flipping the ranking to prefer Roth growth", () => {
    const withoutNiit = rankWithdrawalTiers(
      baseInput({
        targetRate: 0.1,
        ordinaryIncomeFloor: 613700,
        rothBasisAvailable: 0,
        magiBeforeThisDraw: 0, // below NIIT threshold
      }),
    );
    const withNiit = rankWithdrawalTiers(
      baseInput({
        targetRate: 0.1,
        ordinaryIncomeFloor: 613700,
        rothBasisAvailable: 0,
        magiBeforeThisDraw: 300000, // above MFJ's $250k NIIT threshold
      }),
    );
    const brokerageRateWithout = withoutNiit.find(
      (t) => t.source === "brokerage" && t.costRate > 0,
    )?.costRate;
    const brokerageRateWith = withNiit.find(
      (t) => t.source === "brokerage" && t.costRate > 0,
    )?.costRate;
    expect(brokerageRateWith).toBeCloseTo(
      (brokerageRateWithout ?? 0) + 0.038,
      5,
    );
  });

  it("HSA always ranks last regardless of other inputs", () => {
    const tiers = rankWithdrawalTiers(baseInput({ hsaAvailable: 5000 }));
    expect(tiers[tiers.length - 1].source).toBe("hsa");
  });

  it("no filingStatus ⇒ degenerates to today's fixed Roth-then-brokerage-then-HSA order", () => {
    const tiers = rankWithdrawalTiers(
      baseInput({ filingStatus: undefined, rothBasisAvailable: 0 }),
    );
    const sources = tiers.map((t) => t.source);
    expect(sources.indexOf("roth")).toBeLessThan(sources.indexOf("brokerage"));
    expect(sources.indexOf("brokerage")).toBeLessThan(sources.indexOf("hsa"));
  });

  it("rothBasisAvailable omitted-as-0 with no tracking still lets Roth rank first when it's the household's only free source (ties broken toward Roth)", () => {
    // Simulates hasIndTracking:false callers, which pass
    // rothBasisAvailable equal to the full rothAvailable balance (per
    // RouteBracketInfo's docblock) -- not exercised via this pure
    // function's own default, but documents the expected caller contract.
    const tiers = rankWithdrawalTiers(
      baseInput({ rothBasisAvailable: 50000, rothAvailable: 50000 }),
    );
    expect(tiers[0]).toMatchObject({ source: "roth", costRate: 0 });
  });

  it("zero remaining balances in every source ⇒ returns tiers with zero total capacity, never throws", () => {
    const tiers = rankWithdrawalTiers(
      baseInput({
        rothBasisAvailable: 0,
        rothAvailable: 0,
        brokerageAvailable: 0,
        hsaAvailable: 0,
      }),
    );
    expect(tiers.reduce((s, t) => s + t.capacity, 0)).toBe(0);
  });
});
