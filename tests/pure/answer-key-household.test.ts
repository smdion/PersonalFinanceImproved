/**
 * Answer key, household: a year's return, linked returns, rollups, a
 * fund's total return, the matched mix and fund cost (`.scratch/docs/
 * drafts/answer-key.md` § Household math; rulings in `reviews/2026-11-01/
 * rebuild/household-verdicts.md`, worked cases in `reviews/2026-11-01/
 * specs/household-math.md` §§ 3, 11, 12). Ids are the spec's own,
 * prefixed `household/`; the bracketed part is the docs/CALCULATIONS.md
 * row.
 *
 * Every figure is worked by hand, never read from `src/`:
 * - Gain `G = E − B − C + D − R + F` (DESIGN § ESPP Accounting 6; spec
 *   S28) and Return % `G / (B + (C + R − D − F) / 2)` (DESIGN § Return %;
 *   S34): Simple Dietz, the midpoint case of Modified Dietz (Wikipedia,
 *   "Modified Dietz method" and "Simple Dietz method"; GIPS Q&A, Cash
 *   Flows Q6). A zero denominator is no figure (S40).
 * - Linking `Π(1 + r) − 1`, annualized `(Π(1 + r))^(1/n) − 1` (GIPS
 *   "geometrically link"; S48).
 * - A rollup applies the same formula to the summed rows; a transfer
 *   between two accounts in it nets to 0 (S45, S46).
 * - Total return links `(P_t + D_t) / P_(t−1)`, each price adjusted for
 *   splits (Wikipedia, "Total return"; S146).
 * - The matched mix compounds each month's weighted index returns:
 *   entered weights are fixed (rebalanced monthly), observed ones drift;
 *   accounts weigh by beginning balance (DESIGN § Holding history; S147,
 *   S148).
 * - Fund cost = Σ value × expense ratio, blended = cost ÷ value (DESIGN
 *   § Current glide path; S150).
 * - The income-multiple checkpoints, the savings-rate target and the debt
 *   line: their sources at the end of the file.
 *
 * Inputs are invented. Percent figures are fractions, held to half of
 * 0.01% (the key shows two places).
 */
import { describe, expect, it } from "vitest";
import { cents, xfail } from "../fixtures/answer-key";
import {
  aggregateAccountsByYear,
  chainReturns,
  computeReturn,
} from "@/lib/pure/performance";
import { totalReturnSeries } from "@/lib/pure/total-return";
import { blendedCost, type EffectiveFacts } from "@/lib/pure/fund-facts";
import {
  matchedMixLevels,
  type MatchedMixInput,
} from "@/lib/pure/contributions/matched-mix";
import type { CompositionBucket } from "@/lib/config/enum-values";
import {
  FIDELITY_CHECKPOINTS,
  MONEY_GUY_CHECKPOINTS,
} from "@/lib/config/milestones";
import { isHighInterestDebt } from "@/lib/config/debts";
import {
  incomeMultipleTarget,
  meetsRateTarget,
} from "@/lib/pure/milestones.shared";

/** Half of 0.01%: a percent figure shown to two places. */
const PCT = 0.00005;
const pct = (actual: number | null, expected: number) => {
  expect(actual, "a return, not null").not.toBeNull();
  cents(actual!, expected, PCT);
};

describe("household: a year's return (Simple Dietz)", () => {
  // computeReturn(B, C, G, D, F, R). Each G is worked from S28.
  it("household/C28 [HH-07] B 100,000, E 110,000: 10.00%", () => {
    // G = 110,000 − 100,000 = 10,000; denominator 100,000.
    pct(computeReturn(100_000, 0, 10_000, 0), 0.1);
  });

  it("household/C29 [HH-07] B 100,000, C 12,000, E 120,000: 7.55%", () => {
    // G = 120,000 − 100,000 − 12,000 = 8,000; 100,000 + 12,000/2 =
    // 106,000; 8,000 / 106,000 = 7.5472%.
    pct(computeReturn(100_000, 12_000, 8_000, 0), 8_000 / 106_000);
  });

  it("household/C30 [HH-07] B 100,000, D 5,000, E 100,000: 5.13%", () => {
    // G = 100,000 − 100,000 + 5,000 = 5,000; 100,000 − 5,000/2 = 97,500;
    // 5,000 / 97,500 = 5.1282%.
    pct(computeReturn(100_000, 0, 5_000, 5_000), 5_000 / 97_500);
  });

  it("household/C31 [HH-07] B 100,000, F 1,000, E 109,000: 10.05%, gross of fees", () => {
    // G = 109,000 − 100,000 + 1,000 = 10,000; 100,000 − 1,000/2 = 99,500;
    // 10,000 / 99,500 = 10.0503% (S39: fees are a flow, so gross of them).
    pct(computeReturn(100_000, 0, 10_000, 0, 1_000), 10_000 / 99_500);
  });

  it("household/C32 [HH-07] B 0, C 12,000, E 12,500: 8.33%", () => {
    // G = 12,500 − 12,000 = 500; 0 + 12,000/2 = 6,000; 500 / 6,000.
    pct(computeReturn(0, 12_000, 500, 0), 500 / 6_000);
  });

  it("household/C33 [HH-07] B 0, E 0: no figure", () => {
    // Denominator 0: no capital at risk, no return (S40).
    expect(computeReturn(0, 0, 0, 0)).toBeNull();
  });

  it("household/C34 [HH-07] B 1,000, D 2,000, E 0: no figure", () => {
    // G = 0 − 1,000 + 2,000 = 1,000; denominator 1,000 − 2,000/2 = 0.
    expect(computeReturn(1_000, 0, 1_000, 2_000)).toBeNull();
  });

  it("household/C36 [HH-07] B 100, E 100: 0.00%, a figure", () => {
    // G 0 over a denominator of 100: a true zero, not "no figure" (S40).
    expect(computeReturn(100, 0, 0, 0)).toBe(0);
  });

  it("household/C37 [HH-07] B 100, 50 in midway, E 300: 120.00%", () => {
    // G = 300 − 100 − 50 = 150; 100 + 50/2 = 125; 150 / 125 = 120%, the
    // same in both Dietz forms for a midpoint flow (Wikipedia, "Modified
    // Dietz method", worked example).
    pct(computeReturn(100, 50, 150, 0), 1.2);
  });

  xfail({
    id: "household/C35 [HH-07]",
    todo: 'v0.11 Household math "Decided (H4, H5, H7)" (decision H4)',
    // B 1,000, D 5,000, E 0: G = 0 − 1,000 + 5,000 = 4,000 over
    // 1,000 − 5,000/2 = −1,500: −266.67%. Decision H4 keeps the figure,
    // with a note on screen ("large withdrawals make this % unreliable",
    // not a function output), and leaves the year out of linked returns.
    // Linked between 10% and 20%: 1.10 × 1.20 − 1 = 32.00% over 2 years.
    // Today the year links in: 1.10 × (1 − 2.6667) × 1.20 − 1 = −320.00%
    // over 3.
    run: () => {
      const r = computeReturn(1_000, 0, 4_000, 5_000)!;
      const chain = chainReturns([0.1, r, 0.2]);
      return {
        returnPct: r,
        linked: chain.cumulativeReturn!,
        years: chain.yearsIncluded,
      };
    },
    expected: { returnPct: -4_000 / 1_500, linked: 0.32, years: 2 },
    today: { returnPct: -4_000 / 1_500, linked: -3.2, years: 3 },
    tolerance: PCT,
  });
});

describe("household: transfers and rollups", () => {
  const row = (
    performanceAccountId: number,
    v: { B: number; C?: number; R?: number; G: number; E: number },
  ) => ({
    performanceAccountId,
    year: 2025,
    beginningBalance: String(v.B),
    totalContributions: String(v.C ?? 0),
    yearlyGainLoss: String(v.G),
    endingBalance: String(v.E),
    employerContributions: "0",
    distributions: "0",
    fees: "0",
    rollovers: String(v.R ?? 0),
  });
  // X: G = 30,000 − 50,000 − 6,000 + 30,000 = 4,000. Y: G = 52,000 −
  // 20,000 − 30,000 = 2,000.
  const X = row(1, { B: 50_000, C: 6_000, R: -30_000, G: 4_000, E: 30_000 });
  const Y = row(2, { B: 20_000, R: 30_000, G: 2_000, E: 52_000 });
  const returnOf = (rows: (typeof X)[], ids: number[]) =>
    aggregateAccountsByYear(rows, new Set(ids), { start: 2025, end: 2025 })[0]!;

  it("household/C42 [HH-09] X: B 50,000, C 6,000, R −30,000, E 30,000: 10.53%", () => {
    // 4,000 / (50,000 + (6,000 − 30,000)/2) = 4,000 / 38,000 = 10.5263%.
    pct(returnOf([X, Y], [1]).returnPct, 4_000 / 38_000);
  });

  it("household/C43 [HH-09] Y: B 20,000, R +30,000, E 52,000: 5.71%", () => {
    // 2,000 / (20,000 + 30,000/2) = 2,000 / 35,000 = 5.7143%.
    pct(returnOf([X, Y], [2]).returnPct, 2_000 / 35_000);
  });

  it("household/C44 [HH-09] X and Y rolled up: R nets to 0, 8.22%", () => {
    // Summed: B 70,000, C 6,000, R −30,000 + 30,000 = 0, G 6,000;
    // 6,000 / (70,000 + 6,000/2) = 6,000 / 73,000 = 8.2192% (S45, S46).
    const r = returnOf([X, Y], [1, 2]);
    expect(r.rollovers).toBe(0);
    expect(r.gainLoss).toBe(6_000);
    pct(r.returnPct, 6_000 / 73_000);
  });
});

describe("household: linked returns", () => {
  it("household/C45 [HH-08] 10%, −5%, 20%: linked 25.40%, annualized 7.84%", () => {
    // 1.10 × 0.95 × 1.20 = 1.254; 1.254^(1/3) − 1 = 7.8365%.
    const r = chainReturns([0.1, -0.05, 0.2]);
    pct(r.cumulativeReturn, 0.254);
    pct(r.annualizedReturn, 0.078365);
  });

  it("household/C46 [HH-08] one year at 7%: annualized 7.00%", () => {
    const r = chainReturns([0.07]);
    pct(r.cumulativeReturn, 0.07);
    pct(r.annualizedReturn, 0.07);
  });

  it("household/C47 [HH-08] 10%, −100%, 20%: −100% linked and annualized", () => {
    // 1.10 × 0 × 1.20 = 0: everything lost; 0^(1/3) − 1 = −100%.
    const r = chainReturns([0.1, -1, 0.2]);
    pct(r.cumulativeReturn, -1);
    pct(r.annualizedReturn, -1);
  });
});

describe("household: a fund's total return", () => {
  const day = (date: string, close: number, divCash = 0, splitFactor = 1) => ({
    date,
    close,
    divCash,
    splitFactor,
  });
  const growth = (
    series: ReturnType<typeof totalReturnSeries>,
    from: string,
    to: string,
  ) => series.get(to)!.adjClose / series.get(from)!.adjClose - 1;

  it("household/C140 [HH-14] close 100 → 102 with a 1 dividend: +3.00%", () => {
    // (102 + 1) / 100 = 1.03.
    const s = totalReturnSeries([
      day("2025-03-03", 100),
      day("2025-03-04", 102, 1),
    ]);
    pct(growth(s, "2025-03-03", "2025-03-04"), 0.03);
  });

  it("household/C141 [HH-14] a 2:1 split, close 100 → 51: +2.00%, not −49%", () => {
    // Split-adjusted: 51 × 2 / 100 = 1.02.
    const s = totalReturnSeries([
      day("2025-03-03", 100),
      day("2025-03-04", 51, 0, 2),
    ]);
    pct(growth(s, "2025-03-03", "2025-03-04"), 0.02);
  });

  it("household/C142 [HH-14] C140 then C141: +5.06%", () => {
    // The split day halves 102 × 1.02 = 104.04 to 52.02: 1.03 × 1.02 =
    // 1.0506.
    const s = totalReturnSeries([
      day("2025-03-03", 100),
      day("2025-03-04", 102, 1),
      day("2025-03-05", 52.02, 0, 2),
    ]);
    pct(growth(s, "2025-03-03", "2025-03-05"), 0.0506);
  });
});

describe("household: the matched mix", () => {
  const facts = (bucket: CompositionBucket): EffectiveFacts => ({
    expenseRatio: null,
    composition: {
      buckets: {
        us_equity: 0,
        intl_equity: 0,
        us_bond: 0,
        intl_bond: 0,
        tips: 0,
        cash: 0,
        other: 0,
        [bucket]: 1,
      },
      coverage: 1,
      asOf: "2025-01-01",
      fromUser: false,
    },
    stale: false,
  });
  /** Month-end closes from 100 in December 2019, then each month's return. */
  const closes = (...returns: number[]) => {
    const m = new Map([["2019-12", 100]]);
    let p = 100;
    returns.forEach((r, k) => {
      p *= 1 + r;
      m.set(`2020-${String(k + 1).padStart(2, "0")}`, p);
    });
    return m;
  };
  const prices = (
    p: Partial<Record<CompositionBucket, Map<string, number>>>,
  ): MatchedMixInput["proxyPrices"] => ({
    us_equity: p.us_equity ?? null,
    intl_equity: p.intl_equity ?? null,
    us_bond: p.us_bond ?? null,
    intl_bond: null,
    tips: null,
    cash: null,
    other: null,
  });
  const period = (account: number, weights: Record<number, number>) => ({
    id: account,
    performanceAccountId: account,
    subKey: null,
    start: "2020-01-01",
    end: null,
    basis: "user" as const,
    weights,
  });
  const base: MatchedMixInput = {
    years: [2020],
    accountValues: new Map([[2020, new Map([[1, 100_000]])]]),
    periods: [],
    observedDaily: new Map(),
    splits: new Map(),
    observedDailyByPart: new Map(),
    partSnapshots: new Map(),
    facts: new Map([
      [10, facts("us_equity")],
      [20, facts("us_bond")],
      [30, facts("intl_equity")],
    ]),
    proxyPrices: prices({}),
  };
  // Stocks +2% then +1%; bonds −1% then +3% (invented months).
  const twoMonths = prices({
    us_equity: closes(0.02, 0.01),
    us_bond: closes(-0.01, 0.03),
  });
  const growthTo = (r: ReturnType<typeof matchedMixLevels>, month: string) =>
    r.prices.get(month)! / 100 - 1;

  it("household/C143 [HH-13] a fixed 60/40, rebalanced: 2.61%", () => {
    // Month 1: 0.6 × 2% + 0.4 × −1% = 0.8%; month 2: 0.6 × 1% + 0.4 × 3%
    // = 1.8%; 1.008 × 1.018 − 1 = 2.6144%.
    const r = matchedMixLevels({
      ...base,
      periods: [period(1, { 10: 0.6, 20: 0.4 })],
      proxyPrices: twoMonths,
    });
    pct(growthTo(r, "2020-02"), 0.026144);
  });

  it("household/C144 [HH-13] the same 60/40, drifting: 2.60%", () => {
    // After month 1 the 60 is 61.2 and the 40 is 39.6 (of 100.8): month 2
    // earns (61.2 × 1% + 39.6 × 3%) / 100.8 = 1.7857%; overall
    // (61.2 × 1.01 + 39.6 × 1.03) / 100 − 1 = 102.6 / 100 − 1 = 2.60%.
    // The drifted shares are the observed holdings on each month's first
    // day, as a daily feed gives them.
    const r = matchedMixLevels({
      ...base,
      observedDaily: new Map([
        [
          1,
          [
            { day: "2020-01-02", weights: { 10: 0.6, 20: 0.4 } },
            {
              day: "2020-02-03",
              weights: { 10: 61.2 / 100.8, 20: 39.6 / 100.8 },
            },
          ],
        ],
      ]),
      proxyPrices: twoMonths,
    });
    pct(growthTo(r, "2020-02"), 0.026);
  });

  it("household/C145 [HH-13] accounts of 300,000 at 5% and 100,000 at 9%: 6.00%", () => {
    // Weighted by beginning balance: 0.75 × 5% + 0.25 × 9% = 6.00% (S148).
    const r = matchedMixLevels({
      ...base,
      accountValues: new Map([
        [
          2020,
          new Map([
            [1, 300_000],
            [2, 100_000],
          ]),
        ],
      ]),
      periods: [period(1, { 10: 1 }), period(2, { 30: 1 })],
      proxyPrices: prices({
        us_equity: closes(0.05),
        intl_equity: closes(0.09),
      }),
    });
    pct(growthTo(r, "2020-01"), 0.06);
  });
});

describe("household: fund cost", () => {
  it("household/C148 [HH-15] 100,000 at 0.04% and 50,000 at 0.75%: 415 a year, 0.2767%", () => {
    // 100,000 × 0.0004 = 40; 50,000 × 0.0075 = 375; 415 / 150,000 =
    // 0.27667%.
    const holding = (value: number, er: number) => ({
      value,
      facts: {
        expenseRatio: { value: er, asOf: "2025-01-01", fromUser: false },
        composition: null,
        stale: false,
      },
    });
    const b = blendedCost([holding(100_000, 0.0004), holding(50_000, 0.0075)]);
    cents(b.yearlyCost, 415);
    expect(b.expenseRatio).not.toBeNull();
    cents(b.expenseRatio!, 415 / 150_000, 0.000005);
    expect(b.coveredShare).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Checkpoints, the savings-rate target and the debt line (plan commit 22).
// Fidelity, "How much do I need to retire?": 1× by 30, 3× by 40, 6× by
// 50, 8× by 60, 10× by 67 (S123). Money Guy, "Net worth by age, 2025
// edition" and "targets and benchmarks": 1×, 3×, 6.5×, 13.7×, 20× by 30,
// 40, 50, 60, 65 (S125; verdict G6, fetched twice). Money Guy's
// high-interest line by age (moneyguy.com/?p=26978): car loans over 10% /
// 9% / 8% in the 20s / 30s / 40s, and any car loan at 50+ (verdict G8).
// ---------------------------------------------------------------------------

/** v0.11.x.md § Household math, the Money Guy item (G6, G8). */
const MONEY_GUY_ITEM =
  'v0.11 Household math "Money Guy target at 50 is 6.5×, not 6.4×"';

describe("household: income-multiple checkpoints", () => {
  const AGES_FIDELITY = [30, 40, 50, 60, 67];
  const AGES_MONEY_GUY = [30, 40, 50, 60, 65];
  const targets = (
    table: Parameters<typeof incomeMultipleTarget>[0],
    ages: number[],
  ) =>
    Object.fromEntries(
      ages.map((age) => [
        `age${age}`,
        incomeMultipleTarget(table, age) * 100_000,
      ]),
    );

  it("household/C117 [HH-38] Fidelity on 100,000 at 30 / 40 / 50 / 60 / 67: 100k; 300k; 600k; 800k; 1M", () => {
    // Multiples × 100,000. Decision H5 keeps both tables; 2/4/7× at
    // 35/45/55 aren't asserted (not on Fidelity's page; check before
    // touching them).
    cents(targets(FIDELITY_CHECKPOINTS, AGES_FIDELITY), {
      age30: 100_000,
      age40: 300_000,
      age50: 600_000,
      age60: 800_000,
      age67: 1_000_000,
    });
  });

  xfail({
    id: "household/C118 [HH-38]",
    todo: `${MONEY_GUY_ITEM} (verdict G6)`,
    // Multiples × 100,000: 100,000; 300,000; 650,000; 1,370,000;
    // 2,000,000. Today the config has 6.4× at 50 (640,000), pinned by
    // tests/pure/milestones.test.ts:60.
    run: () => targets(MONEY_GUY_CHECKPOINTS, AGES_MONEY_GUY),
    expected: {
      age30: 100_000,
      age40: 300_000,
      age50: 650_000,
      age60: 1_370_000,
      age65: 2_000_000,
    },
    today: {
      age30: 100_000,
      age40: 300_000,
      age50: 640_000,
      age60: 1_370_000,
      age65: 2_000_000,
    },
  });
});

describe("household: the savings-rate target and the debt line", () => {
  xfail({
    id: "household/SAV-14.5 [HH-40]",
    todo: 'v0.11 Household math "Historical loan "Original Balance" double-counts" (the 14.5% float; verdict A8)',
    // 14,500 saved on 100,000 gross is 14.5%, which rounds half up to a
    // whole 15% and meets a 15% target (DESIGN § Milestones: judged to
    // whole percents). Today 0.145 × 100 = 14.499999999999998 rounds to
    // 14: not met.
    run: () => (meetsRateTarget(14_500 / 100_000, 0.15) ? 1 : 0),
    expected: 1,
    today: 0,
  });

  xfail({
    id: "household/CAR-55 [HH-06]",
    todo: `${MONEY_GUY_ITEM} (the 50+ debt band; verdict G8)`,
    // A car loan at 5% for a 55-year-old: at 50+ any car loan is
    // high-interest. Today the 40s line (above 8%) holds for ever: not
    // high-interest. At 45 the 40s line is right (5% ≤ 8%), today and
    // after the fix.
    run: () => ({
      at55: isHighInterestDebt("auto_loan", 0.05, 55) ? 1 : 0,
      at45: isHighInterestDebt("auto_loan", 0.05, 45) ? 1 : 0,
    }),
    expected: { at55: 1, at45: 0 },
    today: { at55: 0, at45: 0 },
  });
});
