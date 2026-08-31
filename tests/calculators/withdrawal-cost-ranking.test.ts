import { describe, it, expect } from "vitest";
import {
  rankWithdrawalTiers,
  deriveBasisRankingInputs,
  type RankWithdrawalTiersInput,
} from "@/lib/calculators/engine/withdrawal-cost-ranking";
import type { RothBasisState } from "@/lib/pure/roth-basis-tracking";

function rothState(
  contributionBasis: number,
  conversionBasis = 0,
): RothBasisState {
  return {
    contributionBasis,
    conversionBasis,
    latestConversionYear: null,
    sourceYear: null,
    isSeeded: false,
    stale: false,
  };
}

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
    ordinaryIncomeFloor: 150000, // in the 12% bracket
    taxBrackets: MFJ_BRACKETS,
    ltcgBrackets: undefined, // use hardcoded 2026 defaults
    rothBasisAvailable: 0,
    rothAvailable: 50000,
    brokerageAvailable: 50000,
    brokerageBasisRatio: 0,
    hsaAvailable: 10000,
    magiBeforeThisDraw: 0,
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
    // ordinaryIncomeFloor 0 -> full 0%-LTCG room available
    const tiers = rankWithdrawalTiers(
      baseInput({ ordinaryIncomeFloor: 0, rothBasisAvailable: 0 }),
    );
    const brokerageTier = tiers.find((t) => t.source === "brokerage");
    expect(brokerageTier?.costRate).toBe(0);
  });

  // Roth/HSA growth rate is now priced off ordinaryIncomeFloor directly
  // (marginalRateAtIncome), not marginalRateAboveTarget(targetRate, ...)
  // (advisor review, 2026-08-29 -- targetRate assumed Phase 1 always
  // filled Traditional up to the bracket-filling cap, which isn't true
  // when Traditional simply ran out below it; pricing off the target
  // instead of the household's REAL income level systematically
  // overpriced Roth/HSA whenever the two diverge).
  it("Roth growth is priced at the bracket ordinaryIncomeFloor ACTUALLY sits in", () => {
    // 150,000 sits in the 12% bracket (96,950 <= 150,000 < 206,700) --
    // marginalRateAtIncome must return 0.12 regardless of any
    // bracket-filling target elsewhere in the system.
    const tiers = rankWithdrawalTiers(
      baseInput({
        ordinaryIncomeFloor: 150000,
        rothBasisAvailable: 0,
        brokerageAvailable: 0,
        hsaAvailable: 0,
      }),
    );
    const rothTier = tiers.find((t) => t.source === "roth");
    expect(rothTier?.costRate).toBeCloseTo(0.12, 5);
  });

  it("no free tiers ⇒ Roth growth (12%) ranks BEFORE 15% LTCG brokerage when it's genuinely cheaper", () => {
    const tiers = rankWithdrawalTiers(
      baseInput({ rothBasisAvailable: 0, magiBeforeThisDraw: 0 }),
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

  it("brokerage ranks before Roth once income is high enough that Roth's real bracket rate exceeds LTCG", () => {
    // 613,700 is past the top ordinary bracket (24%) while LTCG here is
    // still 15% -- brokerage is genuinely cheaper at this income level,
    // unlike the old targetRate-driven pricing which could make Roth look
    // artificially cheap regardless of the household's real income.
    const tiers = rankWithdrawalTiers(
      baseInput({
        ordinaryIncomeFloor: 613700,
        rothBasisAvailable: 0,
        magiBeforeThisDraw: 0,
      }),
    );
    const rothIdx = tiers.findIndex((t) => t.source === "roth");
    const brokerageIdx = tiers.findIndex((t) => t.source === "brokerage");
    expect(tiers.find((t) => t.source === "roth")?.costRate).toBeCloseTo(
      0.24,
      5,
    );
    expect(tiers.find((t) => t.source === "brokerage")?.costRate).toBeCloseTo(
      0.15,
      5,
    );
    expect(brokerageIdx).toBeLessThan(rothIdx);
  });

  it("NIIT adds exactly 3.8% to brokerage's rate once MAGI is above the filing-status threshold", () => {
    const withoutNiit = rankWithdrawalTiers(
      baseInput({ ordinaryIncomeFloor: 250000, magiBeforeThisDraw: 0 }),
    );
    const withNiit = rankWithdrawalTiers(
      baseInput({
        ordinaryIncomeFloor: 250000,
        magiBeforeThisDraw: 300000, // above MFJ's $250k NIIT threshold
      }),
    );
    const brokerageRateWithout = withoutNiit.find(
      (t) => t.source === "brokerage" && t.costRate > 0,
    )?.costRate;
    const brokerageRateWith = withNiit.find(
      (t) => t.source === "brokerage" && t.costRate > 0,
    )?.costRate;
    expect(brokerageRateWithout).toBeCloseTo(0.15, 5);
    expect(brokerageRateWith).toBeCloseTo(0.188, 5);
  });

  // NIIT threshold split (advisor review, 2026-08-29): a household whose
  // MAGI is BELOW the threshold, but whose brokerage tier's own gains
  // would push it OVER, must get NIIT priced only on the portion past the
  // threshold -- not 0%/full-rate on the whole tier (the old all-or-
  // nothing cliff, which mis-ranked exactly at the boundary where the
  // ranking is supposed to earn its keep).
  it("splits the brokerage tier at the NIIT threshold crossing instead of pricing the whole tier at one rate", () => {
    // MFJ NIIT threshold is $250,000. magiBeforeThisDraw=245,000 leaves
    // only $5,000 of headroom before NIIT kicks in -- with a much larger
    // brokerage balance available, most of the tier should land in a
    // post-NIIT sub-tier while a small pre-NIIT sub-tier stays NIIT-free.
    const tiers = rankWithdrawalTiers(
      baseInput({
        ordinaryIncomeFloor: 613700, // 15% LTCG zone here
        rothAvailable: 0,
        rothBasisAvailable: 0,
        brokerageAvailable: 100000,
        brokerageBasisRatio: 0,
        magiBeforeThisDraw: 245000,
        hsaAvailable: 0,
      }),
    );
    const brokerageTiers = tiers.filter((t) => t.source === "brokerage");
    // Two distinct brokerage sub-tiers: one at the bare LTCG rate (pre-NIIT),
    // one at LTCG + 3.8% (post-NIIT).
    expect(brokerageTiers.length).toBe(2);
    const preNiit = brokerageTiers.find((t) => t.capacity < 100000)!;
    const postNiit = brokerageTiers.find((t) => t.costRate > preNiit.costRate)!;
    expect(preNiit.capacity).toBeCloseTo(5000, 2); // exactly the $5k MAGI headroom
    expect(preNiit.costRate).toBeCloseTo(0.15, 5);
    expect(postNiit.costRate).toBeCloseTo(0.188, 5);
    expect(preNiit.capacity + postNiit.capacity).toBeCloseTo(100000, 2);
  });

  // HSA is no longer hardcoded last (advisor review, 2026-08-29) -- once
  // its balance reaches this ranking it's ordinarily already the
  // penalty-free portion (excluded upstream when still locked, per
  // withdrawal-eligibility.ts's computeHsaAccess/subtractExcluded), so it
  // competes on real cost like Roth growth instead of an assumed-worst
  // rate that made it lose to genuinely-more-expensive sources too.
  it("HSA competes on ordinary rate alongside Roth growth, ranking BEFORE a more expensive brokerage tier", () => {
    const tiers = rankWithdrawalTiers(
      baseInput({ rothBasisAvailable: 0, magiBeforeThisDraw: 0 }),
    );
    const hsaTier = tiers.find((t) => t.source === "hsa")!;
    const rothGrowthTier = tiers.find(
      (t) => t.source === "roth" && t.costRate > 0,
    )!;
    // Same ordinary-rate formula as Roth growth -- ties, not "always worse."
    expect(hsaTier.costRate).toBeCloseTo(rothGrowthTier.costRate, 5);
    const hsaIdx = tiers.findIndex((t) => t.source === "hsa");
    const brokerageIdx = tiers.findIndex((t) => t.source === "brokerage");
    // At this income level (12% ordinary vs 15% LTCG) HSA is genuinely
    // cheaper than brokerage, so it must rank before it -- not last
    // purely by construction.
    expect(hsaIdx).toBeLessThan(brokerageIdx);
  });

  it("no filingStatus ⇒ Roth and HSA tie at the ordinary rate, both ranked before brokerage's flat fallback", () => {
    const tiers = rankWithdrawalTiers(
      baseInput({ filingStatus: undefined, rothBasisAvailable: 0 }),
    );
    const sources = tiers.map((t) => t.source);
    expect(sources.indexOf("roth")).toBeLessThan(sources.indexOf("brokerage"));
    expect(sources.indexOf("hsa")).toBeLessThan(sources.indexOf("brokerage"));
    const rothTier = tiers.find((t) => t.source === "roth")!;
    const hsaTier = tiers.find((t) => t.source === "hsa")!;
    expect(hsaTier.costRate).toBeCloseTo(rothTier.costRate, 5);
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

  // Regression, 2026-08-30: ordinaryIncomeFloor was fed straight into the
  // LTCG lookup with no standard-deduction subtraction — real household
  // numbers (see live projection debugging session), $120,100 gross
  // Traditional withdrawal, MFJ $32,200 standard deduction, $98,900
  // 0%-LTCG ceiling. Pre-fix: zero 0%-LTCG room (120,100 already exceeds
  // 98,900 on its own). Post-fix: ~$11,000 of real room.
  it("standardDeduction converts gross ordinaryIncomeFloor to taxable income before the LTCG lookup", () => {
    const withoutDeduction = rankWithdrawalTiers(
      baseInput({
        ordinaryIncomeFloor: 120100,
        rothBasisAvailable: 0,
        brokerageAvailable: 50000,
        brokerageBasisRatio: 0,
      }),
    );
    const zeroTierWithout = withoutDeduction.find(
      (t) => t.source === "brokerage" && t.costRate === 0,
    );
    expect(zeroTierWithout).toBeUndefined();

    const withDeduction = rankWithdrawalTiers(
      baseInput({
        ordinaryIncomeFloor: 120100,
        standardDeduction: 32200,
        rothBasisAvailable: 0,
        brokerageAvailable: 50000,
        brokerageBasisRatio: 0,
      }),
    );
    const zeroTierWith = withDeduction.find(
      (t) => t.source === "brokerage" && t.costRate === 0,
    );
    expect(zeroTierWith?.capacity).toBe(11000);
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

// Advisor review, 2026-08-29 (finding #7): a Portfolio-parented Roth
// account's basis is unconditionally excluded from the routable pool
// (R49), but deriveBasisRankingInputs used to sum indBasis across every
// tracked account regardless -- overstating rothBasisAvailable exactly for
// a household whose basis happens to sit in an excluded account.
describe("deriveBasisRankingInputs", () => {
  const balances = { afterTax: 0, afterTaxBasis: 0 };

  it("sums basis across all tracked Roth accounts when no indAccts/indKey given (legacy behavior, no individual-account tracking)", () => {
    const indBasis = new Map([
      ["a", rothState(10000)],
      ["b", rothState(5000, 2000)],
    ]);
    const result = deriveBasisRankingInputs({ balances, indBasis });
    expect(result.rothBasisAvailable).toBe(17000);
  });

  it("excludes a Portfolio-parented Roth account's basis from the routable total", () => {
    const indAccts = [
      {
        name: "Retirement Roth",
        category: "roth401k",
        taxType: "taxFree",
        parentCategory: "Retirement",
      },
      {
        name: "Brokerage-parked Roth",
        category: "roth401k",
        taxType: "taxFree",
        parentCategory: "Portfolio",
      },
    ];
    const indKey = (ia: { name: string }) => ia.name;
    const indBasis = new Map([
      ["Retirement Roth", rothState(10000)],
      // All the household's basis happens to sit in the excluded account.
      ["Brokerage-parked Roth", rothState(40000)],
    ]);
    const result = deriveBasisRankingInputs({
      balances,
      indBasis,
      indAccts,
      indKey,
    });
    // Only the Retirement-parented account's basis counts -- the
    // Portfolio-parented $40,000 is structurally unreachable by routing.
    expect(result.rothBasisAvailable).toBe(10000);
  });

  it("excludes non-Roth accounts from the basis total even when indAccts/indKey are given", () => {
    const indAccts = [
      {
        name: "Traditional 401k",
        category: "trad401k",
        taxType: "preTax",
        parentCategory: "Retirement",
      },
    ];
    const indKey = (ia: { name: string }) => ia.name;
    // A traditional account has no Roth "basis" concept -- even if a
    // caller mistakenly seeded an indBasis entry for it, it must not leak
    // into rothBasisAvailable.
    const indBasis = new Map([["Traditional 401k", rothState(9999)]]);
    const result = deriveBasisRankingInputs({
      balances,
      indBasis,
      indAccts,
      indKey,
    });
    expect(result.rothBasisAvailable).toBe(0);
  });

  it("regression guard: without indAccts/indKey, the excluded account's basis wrongly leaks back in", () => {
    // Same setup as the Portfolio-parented test above, but calling the
    // legacy (no exclusion awareness) code path -- proves the fix above
    // actually changes behavior rather than being a no-op.
    const indBasis = new Map([
      ["Retirement Roth", rothState(10000)],
      ["Brokerage-parked Roth", rothState(40000)],
    ]);
    const result = deriveBasisRankingInputs({ balances, indBasis });
    expect(result.rothBasisAvailable).toBe(50000);
  });
});
