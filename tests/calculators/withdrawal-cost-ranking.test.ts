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

  it("discretionaryWithdrawalOrder omitted defaults to roth_first (Roth basis before brokerage's 0% tier)", () => {
    const tiers = rankWithdrawalTiers(
      baseInput({
        ordinaryIncomeFloor: 0,
        rothBasisAvailable: 20000,
      }),
    );
    const rothIdx = tiers.findIndex(
      (t) => t.source === "roth" && t.costRate === 0,
    );
    const brokerageIdx = tiers.findIndex(
      (t) => t.source === "brokerage" && t.costRate === 0,
    );
    expect(rothIdx).toBeGreaterThanOrEqual(0);
    expect(brokerageIdx).toBeGreaterThanOrEqual(0);
    expect(rothIdx).toBeLessThan(brokerageIdx);
  });

  it("discretionaryWithdrawalOrder: brokerage_first ranks brokerage's 0% tier before Roth basis (R55 follow-up)", () => {
    const tiers = rankWithdrawalTiers(
      baseInput({
        ordinaryIncomeFloor: 0,
        rothBasisAvailable: 20000,
        discretionaryWithdrawalOrder: "brokerage_first",
      }),
    );
    const rothIdx = tiers.findIndex(
      (t) => t.source === "roth" && t.costRate === 0,
    );
    const brokerageIdx = tiers.findIndex(
      (t) => t.source === "brokerage" && t.costRate === 0,
    );
    expect(rothIdx).toBeGreaterThanOrEqual(0);
    expect(brokerageIdx).toBeGreaterThanOrEqual(0);
    expect(brokerageIdx).toBeLessThan(rothIdx);
  });

  it("discretionaryWithdrawalOrder: no LTCG data (no filingStatus) means nothing to reorder — brokerage_first has no effect there", () => {
    // Verified against the user's own spreadsheet: brokerage's withdrawal
    // is capped at exactly the free 0%-LTCG room, so with no LTCG data at
    // all there's no brokerage-0%-tier counterpart for Roth basis to swap
    // against — the fixed order (roth, then brokerage's flat fallback)
    // applies regardless of this setting.
    const tiers = rankWithdrawalTiers(
      baseInput({
        filingStatus: undefined,
        rothBasisAvailable: 20000,
        brokerageAvailable: 50000,
        discretionaryWithdrawalOrder: "brokerage_first",
      }),
    );
    expect(tiers[0]).toMatchObject({ source: "roth", capacity: 20000 });
  });

  it("discretionaryWithdrawalOrder does NOT affect the cost-ranked tier beyond the free 0%-LTCG zone, either direction (matches the user's spreadsheet: brokerage is capped at the free room, not preferred unconditionally)", () => {
    // ordinaryIncomeFloor high enough that most/all brokerage gains land in
    // the real-rate (non-zero) LTCG tier, not the free 0% tier.
    const inputs = {
      ordinaryIncomeFloor: 300000,
      rothBasisAvailable: 20000,
      rothAvailable: 50000,
      brokerageAvailable: 50000,
    };
    const rothFirstTiers = rankWithdrawalTiers(baseInput(inputs));
    const brokerageFirstTiers = rankWithdrawalTiers(
      baseInput({ ...inputs, discretionaryWithdrawalOrder: "brokerage_first" }),
    );
    // The priced (non-zero, non-Infinity cost) tier is identical either
    // way — only the two free tiers' relative order can differ.
    const pricedOnly = (tiers: typeof rothFirstTiers) =>
      tiers.filter((t) => t.costRate > 0 && t.costRate < Infinity);
    expect(pricedOnly(brokerageFirstTiers)).toEqual(pricedOnly(rothFirstTiers));
    // And it's genuinely cost-ranked, not brokerage-unconditionally-first:
    // a real-rate brokerage tier exists but doesn't precede every Roth tier.
    const pricedBrokerage = rothFirstTiers.find(
      (t) => t.source === "brokerage" && t.costRate > 0,
    );
    expect(pricedBrokerage).toBeDefined();
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
    // 600,000 is past the top ordinary bracket (24%) while LTCG here is
    // still 15% -- brokerage is genuinely cheaper at this income level,
    // unlike the old targetRate-driven pricing which could make Roth look
    // artificially cheap regardless of the household's real income.
    // (Deliberately NOT 613,700, the exact 15%/20% LTCG boundary -- gains
    // stack ON TOP of ordinary income, so the first dollar of gains when
    // ordinary income is exactly AT a bracket's own ceiling lands in the
    // NEXT bracket, per computeLtcgTax's `floor >= threshold` stacking
    // logic; see ltcgRateForNextDollar's docblock, tax-tables.ts.)
    const tiers = rankWithdrawalTiers(
      baseInput({
        ordinaryIncomeFloor: 600000,
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

  it("prices the brokerage tier beyond the free 0%-LTCG room at the real next bracket's rate, not 0% (boundary bug, found 2026-08-31)", () => {
    // ordinary=57000 gross, standardDeduction=32200 -> taxable=24800.
    // zeroGainsRoom = 98900 - 24800 = 74100 exactly reaches the 0% ceiling,
    // so brokerageOrdinaryIncome + zeroGainsRoom lands EXACTLY on 98900 by
    // construction -- getLtcgRate's inclusive <= would wrongly return 0%
    // for the tier that actually starts at 98901. Large brokerageAvailable
    // ensures a real "beyond the free room" slice exists to price.
    const tiers = rankWithdrawalTiers(
      baseInput({
        ordinaryIncomeFloor: 57000,
        standardDeduction: 32200,
        rothBasisAvailable: 0,
        brokerageAvailable: 1_000_000,
        magiBeforeThisDraw: 0,
      }),
    );
    const pricedBrokerage = tiers.filter(
      (t) => t.source === "brokerage" && t.costRate > 0,
    );
    expect(pricedBrokerage.length).toBeGreaterThan(0);
    // Pre-NIIT slice should be the real 15% rate, not 0%.
    expect(pricedBrokerage[0]!.costRate).toBeCloseTo(0.15, 5);
  });

  it("still prices the top LTCG bracket (20%) correctly for high-income households, not a flat 15% (guards against a wrong 'first bracket above 0%' fix)", () => {
    const tiers = rankWithdrawalTiers(
      baseInput({
        ordinaryIncomeFloor: 700000, // past the 613,700 MFJ 15%/20% boundary
        rothBasisAvailable: 0,
        magiBeforeThisDraw: 0,
      }),
    );
    const brokerageTier = tiers.find(
      (t) => t.source === "brokerage" && t.costRate > 0 && t.costRate < 0.3,
    );
    expect(brokerageTier?.costRate).toBeCloseTo(0.2, 5);
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
        ordinaryIncomeFloor: 600000, // 15% LTCG zone here (not the exact 613,700 boundary -- see the previous test's comment)
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
