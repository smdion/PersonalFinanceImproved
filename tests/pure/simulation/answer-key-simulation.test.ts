/**
 * Answer key, Simulation: the sampler's parts, percentiles, the plan judge,
 * today's dollars, the shipped presets and "vs budget"
 * (`.scratch/docs/drafts/answer-key.md` § Simulation; rulings in
 * `reviews/2026-11-01/rebuild/simulation-verdicts.md` § "Cases ready to
 * become answer-key tests", worked rules in `reviews/2026-11-01/specs/
 * simulation.md`, cited by SP id). Ids are the verdict's own, prefixed
 * `sim/`; the bracketed part is the docs/CALCULATIONS.md row.
 *
 * Every figure is worked by hand from the rule, never read from `src/`.
 * The slow statistical and replay cases (K2, K12, K13a, K13b, K14, K15)
 * run in the benchmark project:
 * `tests/benchmarks/answer-key-simulation-reference.test.ts`.
 *
 * Not written as figures: K6 calls a function that doesn't exist yet;
 * K7 and K9 are blocked (the `it.todo`s at the end name what unblocks
 * them).
 */
import { describe, expect, it } from "vitest";
import { xfail } from "../../fixtures/answer-key";
import {
  ALL_IN_ONE,
  NO_CLAMP,
  STOCKS,
  BONDS,
  STOCK_BOND_CORRELATION,
  MIX_60_40,
  retiree,
  type Retiree,
} from "../../fixtures/answer-key-simulation";
import {
  blendedReturnStats,
  buildCorrelationMatrix,
  choleskyDecomposition,
  createPRNG,
} from "@/lib/pure/simulation/random";
import {
  calculateMonteCarlo,
  percentile,
} from "@/lib/pure/simulation/monte-carlo";
import { calculateProjection } from "@/lib/pure/engine";
import { assessPlan } from "@/lib/pure/retirement/plan-outcome";
import { readSimulationPresetsFile } from "@/lib/db/reference-data";
import type { MonteCarloInput } from "@/lib/pure/simulation/monte-carlo.types";

/** `A × Bᵀ` for square matrices. */
function timesTranspose(a: number[][], b: number[][]): number[][] {
  return a.map((row) =>
    b.map((other) => row.reduce((s, x, k) => s + x * other[k]!, 0)),
  );
}

/** A Simulation that can't vary: one class at a fixed return, no
 *  volatility, no inflation spread, so every trial is the same path and
 *  the figures can be worked by hand. */
function flatSimulation(h: Retiree, rate: number): MonteCarloInput {
  return {
    engineInput: retiree(h),
    numTrials: 5,
    seed: 1,
    assetClasses: [{ id: 1, name: "One", meanReturn: rate, stdDev: 0 }],
    correlations: [],
    glidePath: ALL_IN_ONE,
    ...NO_CLAMP,
  };
}

const NON_PSD =
  'v0.11 Simulation "Non-PSD correlations (D1, latent, Low)" (verdict D1)';
const DEFLATE_BY_DATE =
  'v0.11 Simulation "Decided: deflate each balance by its own date" (decision F3, with D2)';
const PRESET_OVERRIDE =
  'v0.11 Simulation "Conservative has no International Bonds override"';
const SUCCESS_ITEM = `v0.11 Simulation ""Success" isn't comparable across strategies and is misdescribed" (decision "'vs budget' compares delivered spending")`;

// ---------------------------------------------------------------------------
// The sampler's parts (random.ts)
// ---------------------------------------------------------------------------

describe("answer key: seeded draws, Cholesky and blend moments", () => {
  it("sim/K1 [SIM-01] Mulberry32 matches the published reference outputs", () => {
    // SP-61: bryc's Mulberry32 ("PRNGs" page, the reference code Ledgr
    // copies), first three outputs from seeds 1 and 12345, exact (the
    // algorithm is integer arithmetic ÷ 2^32, so there's nothing to round).
    const first3 = (seed: number) => {
      const g = createPRNG(seed);
      return [g(), g(), g()];
    };
    expect(first3(1)).toEqual([
      0.6270739405881613, 0.002735721180215478, 0.5274470399599522,
    ]);
    expect(first3(12345)).toEqual([
      0.9797282677609473, 0.3067522644996643, 0.484205421525985,
    ]);
  });

  it("sim/K3 [SIM-03] a positive-definite matrix factors back to itself", () => {
    // SP-53, SP-55: L lower-triangular with L·Lᵀ = A. By hand: L00 = 1,
    // L10 = .8, L11 = √(1 − .64) = .6, L20 = .3, L21 = (−.3 − .24)/.6 =
    // −.9, L22 = √(1 − .09 − .81) = √.1. Checked through L·Lᵀ within 1e-12,
    // so the test doesn't depend on the factor's own rounding.
    const a = [
      [1, 0.8, 0.3],
      [0.8, 1, -0.3],
      [0.3, -0.3, 1],
    ];
    const l = choleskyDecomposition(a);
    expect(l[1]![1]).toBeCloseTo(0.6, 12);
    expect(l[2]![1]).toBeCloseTo(-0.9, 12);
    expect(l[2]![2]).toBeCloseTo(Math.sqrt(0.1), 12);
    const back = timesTranspose(l, l);
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++)
        expect(Math.abs(back[i]![j]! - a[i]![j]!)).toBeLessThanOrEqual(1e-12);
  });

  // K4: SP-53/54. By hand on [[1,.9,.9],[.9,1,−.9],[.9,−.9,1]]: L00 = 1,
  // L10 = .9, L11 = √.19, L20 = .9, L21 = (−.9 − .81)/√.19 = −3.92301,
  // pivot 1 − .81 − 15.39 = −15.2 < 0: not positive semidefinite (smallest
  // eigenvalue −0.8, spec Appendix B), so the factor doesn't exist. Today
  // the pivot is clamped to 0 (`random.ts:122`) and row 3 of L·Lᵀ comes
  // out .81 + 1.71²/.19 = .81 + 15.39 = 16.2 instead of 1: class 3 is drawn
  // with 16.2 times its variance.
  const NOT_PSD = [
    [1, 0.9, 0.9],
    [0.9, 1, -0.9],
    [0.9, -0.9, 1],
  ];
  it.fails(
    'sim/K4 [SIM-03] — expected failure until v0.11 Simulation "Non-PSD correlations (D1, latent, Low)" (verdict D1)',
    () => {
      expect(() => choleskyDecomposition(NOT_PSD)).toThrow(
        /semi-?definite|PSD/i,
      );
    },
  );
  it(`sim/K4:today [SIM-03] — today's figure, wrong until ${NON_PSD}`, () => {
    const l = choleskyDecomposition(NOT_PSD);
    expect(timesTranspose(l, l)[2]![2]).toBeCloseTo(16.2, 9);
  });

  it("sim/K5 [SIM-04] 60/40 blend: mean 8.00%, volatility 11.292%", () => {
    // SP-10: R_p = Σ wᵢRᵢ, so E[r_p] = .6 × .10 + .4 × .05 = .0800 and
    // Var = wᵀCw on the simple returns. Each class is log-normal (SP-4):
    // σ²ᵢ = ln(1 + sᵢ²/(1+aᵢ)²) = .0264246 (stocks), .0044346 (bonds).
    // With normal-space correlation ρ = .05037 (simple-return .05, § 8),
    // Cov = (1.10)(1.05)(exp(ρ σ₁σ₂) − 1) = 1.155 × (exp(.05037 ×
    // .0108252) − 1) = .00062995. Var = .36 × .0324 + .16 × .0049 + 2 ×
    // .24 × .00062995 = .0127504; volatility √.0127504 = .112918 (spec:
    // 11.292%).
    const classes = [STOCKS, BONDS];
    const stats = blendedReturnStats(
      classes,
      buildCorrelationMatrix(classes, [
        { classAId: 1, classBId: 2, correlation: STOCK_BOND_CORRELATION },
      ]),
      MIX_60_40,
      65,
    );
    expect(stats).not.toBeNull();
    expect(Math.abs(stats!.expectedReturn - 0.08)).toBeLessThanOrEqual(1e-12);
    expect(Math.abs(stats!.volatility - 0.11292)).toBeLessThanOrEqual(5e-6);
  });
});

// ---------------------------------------------------------------------------
// Percentiles (Hyndman & Fan type 7)
// ---------------------------------------------------------------------------

describe("answer key: percentile bands", () => {
  it("sim/K8 [SIM-12] type 7 percentiles on hand rows", () => {
    // SP-29, R's default (Hyndman & Fan 1996, type 7): h = (n − 1)p, then
    // x[⌊h⌋] + (h − ⌊h⌋)(x[⌊h⌋+1] − x[⌊h⌋]), zero-based.
    // 100, 200, 300, 400, 1000: p10 h = .4 → 100 + .4 × 100 = 140;
    // p90 h = 3.6 → 400 + .6 × 600 = 760.
    // 10, 20, 30, 40: p25 h = .75 → 10 + .75 × 10 = 17.5;
    // p75 h = 2.25 → 30 + .25 × 10 = 32.5.
    const five = [100, 200, 300, 400, 1000];
    const four = [10, 20, 30, 40];
    expect(percentile(five, 10)).toBeCloseTo(140, 9);
    expect(percentile(five, 90)).toBeCloseTo(760, 9);
    expect(percentile(four, 25)).toBeCloseTo(17.5, 9);
    expect(percentile(four, 75)).toBeCloseTo(32.5, 9);
  });
});

// ---------------------------------------------------------------------------
// The plan judge (plan-outcome.ts) and today's dollars
// ---------------------------------------------------------------------------

describe("answer key: the plan judge and today's dollars", () => {
  it("sim/K10 [SIM-10] the money runs out exactly, $1 short, $5,000 short", () => {
    // SP-46, SP-40, D4. 0% return and 0% inflation: 30 start-of-year
    // withdrawals of 40,000 need exactly 30 × 40,000 = 1,200,000.
    // - 1,200,000: the last withdrawal leaves exactly $0 and no later year
    //   needs money (SP-46): success.
    // - 1,199,999: year 30 is $1 short; the materiality floor is
    //   max($50, 1% × 40,000) = $400 (decumulation-year.ts, DESIGN § the
    //   plan judge; decision F7 keeps it), so $1 isn't material: success.
    // - 1,195,000: 1,195,000 − 29 × 40,000 = 35,000 left for year 30
    //   (2055, age 94), $5,000 short ≥ $400 with the money gone: fails,
    //   `depleted`.
    // The engine stops a year early (E7), so the fixture pads the end year
    // and the run has its 30 rows; after D10 the pad goes.
    const judge = (start: number) => {
      const r = calculateProjection(
        retiree({ start, spend: 40_000, years: 30, inflation: 0 }),
      );
      expect(r.projectionByYear).toHaveLength(30);
      return assessPlan(r);
    };
    expect(judge(1_200_000).succeeded).toBe(true);
    expect(judge(1_199_999).succeeded).toBe(true);
    const short = judge(1_195_000);
    expect(short.succeeded).toBe(false);
    expect(short.failureReason).toBe("depleted");
    expect(short.failureYear).toBe(2055);
  });

  describe("sim/K11 [SIM-13] today's dollars at the end of the row", () => {
    // SP-27, D3. Retired, Roth 1,000,000, spending 40,000 drawn at the
    // start of the year, 5% return, 3% inflation, no spread, as of
    // January 1 2026. 2026 row: (1,000,000 − 40,000) × 1.05 = 1,008,000
    // nominal, a balance measured on December 31, one year from the as-of
    // date. In today's dollars by its own date (decision F3):
    // 1,008,000 / 1.03 = 978,640.78. Today Ledgr divides by the row's
    // start-of-year index (1.03⁰ = 1) and shows 1,008,000 (key's Today on
    // 24bae33b). As of January 1 year 0 is a whole year either way (D2
    // decides other as-of dates).
    xfail({
      id: "sim/K11 [SIM-13]",
      todo: DEFLATE_BY_DATE,
      run: () => {
        const r = calculateMonteCarlo(
          flatSimulation(
            { start: 1_000_000, spend: 40_000, years: 30, inflation: 0.03 },
            0.05,
          ),
        );
        return {
          nominal: r.percentileBands[0]!.p50,
          today: r.today.percentileBands[0]!.p50,
        };
      },
      expected: { nominal: 1_008_000, today: 978_640.78 },
      today: { nominal: 1_008_000, today: 1_008_000 },
    });
  });
});

// ---------------------------------------------------------------------------
// "vs budget" (spending-terms trace #13)
// ---------------------------------------------------------------------------

describe('answer key: "vs budget" compares delivered spending', () => {
  describe("sim/T5 [SIM-11] Fixed strategy, the money runs out in year 3", () => {
    // Trace #9/#13; decision "'vs budget' compares delivered spending, not
    // the strategy's target" (DECISIONS § Spending terms trace). Invented
    // household: Fixed strategy, Roth 100,000, Retirement budget 40,000 a
    // year, 0% return, no volatility, 0% inflation, 30 years. Every trial is
    // the same path. Start-of-year withdrawals:
    //   year 1 delivers 40,000 (60,000 left), year 2 40,000 (20,000 left),
    //   year 3 20,000 (all that's left), years 4-30 deliver 0.
    // The budget line stays 40,000 (0% inflation). "vs budget" counts a
    // trial stable when delivered spending is at least 75% of the budget
    // every retirement year (MC_SPENDING_STABILITY_THRESHOLD, Ledgr's
    // choice): year 3 is 20,000 / 40,000 = 50% and year 4 is 0%, so no
    // trial is stable: "vs budget" 0 of 5 = 0%, with year 3's ratio 0.5 and
    // year 4's 0. Today `strategySpending` returns Fixed's target
    // (`projectedExpenses`, 40,000 every year: `strategy-spending.ts:12-18`,
    // read at `monte-carlo.ts:483-486`), so every trial reads stable: 100%,
    // ratios 1.
    xfail({
      id: "sim/T5 [SIM-11]",
      todo: SUCCESS_ITEM,
      run: () => {
        const r = calculateMonteCarlo(
          flatSimulation(
            { start: 100_000, spend: 40_000, years: 30, inflation: 0 },
            0,
          ),
        );
        const bands = r.spendingStabilityBands?.budgetRatio;
        return {
          vsBudget: r.budgetStabilityRate ?? Number.NaN,
          year3: bands?.[2]?.p50 ?? Number.NaN,
          year4: bands?.[3]?.p50 ?? Number.NaN,
        };
      },
      expected: { vsBudget: 0, year3: 0.5, year4: 0 },
      today: { vsBudget: 1, year3: 1, year4: 1 },
    });
  });
});

// ---------------------------------------------------------------------------
// The shipped presets (reference-data/simulation-presets.json)
// ---------------------------------------------------------------------------

describe("answer key: the shipped presets", () => {
  // K16: under a preset whose return multiplier is 0 (Conservative), a
  // class with no return override is drawn at its table mean × 0.5
  // (`presetAssetClasses`, `simulation-preset.ts:139`, the documented
  // fallback at :117-118). v0.9.9's typed "not configured" states cover a
  // missing preset, asset classes or glide path, not a missing override,
  // so nothing tells the household. The verdict's guard: every active
  // class has an override under such a preset. In the shipped file (v0.9.9) Conservative overrides five of the six active
  // classes; International Bonds (table 4.5%) has none, so it would draw
  // at 4.5% × 0.5 = 2.25%, under Conservative's own US Bonds 3.5%. No
  // glide path weights it today (a data trap).
  const presets = readSimulationPresetsFile();
  const active = presets.asset_class_params
    .filter((c) => c.is_active)
    .map((c) => c.name);
  const missingOverrides = (key: string) => {
    const has = new Set(
      presets.mc_preset_return_overrides
        .filter((o) => o.preset === key)
        .map((o) => o.asset_class),
    );
    return active.filter((name) => !has.has(name));
  };
  const zeroMultiplier = presets.mc_presets
    .filter((p) => p.is_active && Number(p.return_multiplier) === 0)
    .map((p) => p.key);

  it.fails(
    'sim/K16 [SIM-16] — expected failure until v0.11 Simulation "Conservative has no International Bonds override"',
    () => {
      expect(zeroMultiplier.length).toBeGreaterThan(0);
      for (const key of zeroMultiplier)
        expect(missingOverrides(key)).toEqual([]);
    },
  );
  it(`sim/K16:today [SIM-16] — today's figure, wrong until ${PRESET_OVERRIDE}`, () => {
    expect(zeroMultiplier).toEqual(["conservative"]);
    expect(missingOverrides("conservative")).toEqual(["International Bonds"]);
  });
});

// ---------------------------------------------------------------------------
// Not written yet
// ---------------------------------------------------------------------------

describe("answer key: Simulation cases waiting on an item", () => {
  // K6 (decision F2): the portfolio median rate for K5's 60/40 is
  // exp(E ln Σ wᵢRᵢ) − 1 = 7.408% ± 0.005% a year (the skeptic's 4M draws,
  // D5; SP-10); Σ w·G = .6 × 8.5562% + .4 × 4.7674% = 7.041% is the wrong
  // answer today's baseline compounds at. The function doesn't exist yet
  // (home in v0.10.3, the switch in v0.11): write against it when added.
  it.todo(
    'sim/K6: blocked on v0.11 Simulation "Decided: compound at the true median rate" (decision F2: no portfolioMedianRate yet)',
  );
  // K7: displayed volatility on the Default preset at 65 (weights
  // .40/.20/.25/.09/.06) is 9.24% by the blendedReturnStats formula, not
  // the 11.47% Σ w·s shown; F1 re-sources those rows, so the figure goes
  // stale. K5 covers the formula on invented rows meanwhile.
  it.todo(
    'sim/K7: blocked on v0.11 Simulation "Decided: re-source mean and volatility from one published series" (decision F1)',
  );
  // K9 (SP-24): three trials, nominal 100 / 200 / 400 at index 4 / 1 / 2,
  // give real 25 / 200 / 200: median 200 (the forbidden median-then-
  // deflate gives 200 / 2 = 100). The percentile-of-real step isn't
  // reachable from a test.
  it.todo(
    'sim/K9: blocked on v0.11 Simulation "Simulation tests that can\'t fail for their rule" (a percentile-of-real seam)',
  );
});
