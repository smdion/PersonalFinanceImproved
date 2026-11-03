/**
 * Answer key, Simulation: the statistical and replay cases
 * (`.scratch/docs/drafts/answer-key.md` § Simulation; rulings in
 * `reviews/2026-11-01/rebuild/simulation-verdicts.md`; reference figures
 * in `reviews/2026-11-01/specs/simulation.md` § 11.6, § 11.7, § 12, cited
 * by SP id). Ids are the verdict's own, prefixed `sim/`; the bracketed
 * part is the docs/CALCULATIONS.md row. The fast cases are in
 * `tests/calculators/answer-key-simulation.test.ts`.
 *
 * These run thousands of engine years, so they live in the benchmark
 * project (`pnpm test:benchmarks`). Every statistical tolerance is
 * z · SE with z = 3.89 (two-sided α = 1e-4, SP-98): a sound simulator
 * fails one of them by chance less than once in 10,000 runs. Each seed
 * was fixed before the run (changing one to get a pass voids the test);
 * no case asserts a seed's own draw unless the case is about seeds (K12).
 *
 * K15 replays history through the production engine from
 * `tests/benchmarks/cfiresim-export.csv`: one return per age (that
 * calendar year's blended return) and that year's CPI change as an
 * inflation shock, plan inflation 0 (SP-116). The counts are exact.
 */
import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  ALL_IN_ONE,
  NO_CLAMP,
  p2,
  retiree,
} from "../fixtures/answer-key-simulation";
import { createPRNG, sampleCorrelatedReturns } from "@/lib/calculators/random";
import { calculateMonteCarlo } from "@/lib/calculators/monte-carlo";
import { calculateProjection } from "@/lib/calculators/engine";
import { assessPlan } from "@/lib/calculators/plan-outcome";
import type { MonteCarloResult } from "@/lib/calculators/types";

/** SP-98: two-sided α = 1e-4. */
const Z = 3.89;
/** Long engine runs: minutes on a loaded runner. */
const SLOW = 900_000;

const DEFLATE_BY_DATE =
  'v0.11 Simulation "Decided: deflate each balance by its own date" (decision F3)';
const SEED_MIX = 'v0.11 Simulation "Mix seed and trial per trial" (verdict D2)';

const mean = (xs: readonly number[]) =>
  xs.reduce((s, x) => s + x, 0) / xs.length;
/** Sample variance (n − 1). */
const variance = (xs: readonly number[]) => {
  const m = mean(xs);
  return xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
};
/** Type 7 quantile of sorted values (Hyndman & Fan; written here, not
 *  read from `src/`, so K2 measures with its own ruler). */
const quantile = (sorted: readonly number[], p: number) => {
  const h = (sorted.length - 1) * p;
  const lo = Math.floor(h);
  return sorted[lo]! + (h - lo) * (sorted[Math.ceil(h)]! - sorted[lo]!);
};
/** Standard normal CDF via Abramowitz & Stegun 7.1.26 (|error| ≤ 1.5e-7,
 *  far inside K2's KS bound of 0.00704). */
function normalCdf(x: number): number {
  const t = 1 / (1 + 0.3275911 * (Math.abs(x) / Math.SQRT2));
  const poly =
    t *
    (0.254829592 +
      t *
        (-0.284496736 +
          t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-(x * x) / 2);
  return x >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

/** Run once, share between the tests that read it. */
function once<T>(f: () => T): () => T {
  let value: T | undefined;
  return () => (value ??= f());
}

// ---------------------------------------------------------------------------
// K2: the log-normal sampler (§ 12.2)
// ---------------------------------------------------------------------------

describe("answer key: one class drawn 100,000 times", () => {
  it("sim/K2 [SIM-02] a 10%, s 18%: the nine § 12.2 checks and KS", () => {
    // SP-4: to sample a simple return with arithmetic mean a and deviation
    // s, σ² = ln(1 + s²/(1+a)²) = ln(1 + .0324/1.21) = .0264246, so
    // σ = .162557, and μ = ln(1.1) − σ²/2 = .082098; R = exp(μ + σz).
    // Quantiles of r = exp(μ + σ z_p) − 1 with z_.10 = −1.281552, z_.25 =
    // −.674490: p10 −.11859, p25 −.02717, p50 .08556, p75 .21136, p90
    // .33699. The SEs are § 12.2's (SP-98): s/√n for the mean, [WV] for
    // the variances, [WQ] for the quantiles; tolerance 3.89 SE each.
    // KS (SP-100): D on (ln R − μ)/σ against N(0, 1) under 2.225/√n =
    // .00704 at α = 1e-4. Seed 20261102, fixed in advance.
    const n = 100_000;
    const a = 0.1;
    const s = 0.18;
    const sigma2 = Math.log(1 + (s * s) / ((1 + a) * (1 + a)));
    const mu = Math.log(1 + a) - sigma2 / 2;
    const sigma = Math.sqrt(sigma2);
    expect(mu).toBeCloseTo(0.082098, 6);
    expect(sigma).toBeCloseTo(0.162557, 6);

    const rng = createPRNG(20261102);
    const one = [{ id: 1, name: "One", meanReturn: a, stdDev: s }];
    const r: number[] = [];
    for (let i = 0; i < n; i++)
      r.push(sampleCorrelatedReturns(rng, one, [[1]])[0]!);
    const lnR = r.map((x) => Math.log(1 + x));
    const sorted = [...r].sort((x, y) => x - y);

    const checks: [string, number, number, number][] = [
      // [check, measured, expected, tolerance (3.89 SE)]
      ["mean of r", mean(r), 0.1, 0.00221],
      ["variance of r", variance(r), 0.0324, 0.00062],
      ["mean of ln R", mean(lnR), 0.082098, 0.002],
      ["variance of ln R", variance(lnR), 0.026425, 0.00046],
      ["p10 of r", quantile(sorted, 0.1), -0.11859, 0.00301],
      ["p25 of r", quantile(sorted, 0.25), -0.02717, 0.00265],
      ["p50 of r", quantile(sorted, 0.5), 0.08556, 0.00272],
      ["p75 of r", quantile(sorted, 0.75), 0.21136, 0.0033],
      ["p90 of r", quantile(sorted, 0.9), 0.33699, 0.00457],
    ];
    for (const [check, got, want, tol] of checks)
      expect(
        Math.abs(got - want),
        `${check}: ${got} vs ${want} ±${tol}`,
      ).toBeLessThanOrEqual(tol);

    const z = lnR.map((x) => (x - mu) / sigma).sort((x, y) => x - y);
    let d = 0;
    z.forEach((x, i) => {
      const f = normalCdf(x);
      d = Math.max(d, (i + 1) / n - f, f - i / n);
    });
    expect(d).toBeLessThan(2.225 / Math.sqrt(n));
  });
});

// ---------------------------------------------------------------------------
// K12: nearby seeds (SP-121)
// ---------------------------------------------------------------------------

describe("answer key: seeds 1000-1019", () => {
  // SP-121: 20 runs of P2 (§ 11.7) at n = 1,000, seeds 1000-1019. Each p̂
  // has SE √(p(1 − p)/n); if the runs are independent, (SD of the 20 p̂)
  // ÷ SE is √(χ²₁₉/19), inside [0.437, 1.667] at α = 1e-4 (χ²₁₉ quantiles
  // 3.63 and 52.8). Today trial i of seed s is `createPRNG(s + i)`
  // (`monte-carlo.ts`), so seed 1001 reruns 999 of seed 1000's trials and
  // the 20 runs nearly coincide: the verdict measured 0.274 (D2), the
  // signature of shared trials. The seeds are the case.
  const ratio = once(() => {
    const rates: number[] = [];
    for (let seed = 1000; seed < 1020; seed++)
      rates.push(calculateMonteCarlo(p2(1_000, seed)).successRate);
    const p = mean(rates);
    return Math.sqrt(variance(rates)) / Math.sqrt((p * (1 - p)) / 1_000);
  });
  it.fails(
    'sim/K12 [SIM-01] — expected failure until v0.11 Simulation "Mix seed and trial per trial" (verdict D2)',
    () => {
      const got = ratio();
      expect(got).toBeGreaterThanOrEqual(0.437);
      expect(got).toBeLessThanOrEqual(1.667);
    },
    SLOW,
  );
  it(
    `sim/K12:today [SIM-01] — today's figure, wrong until ${SEED_MIX}`,
    () => {
      // Below the range: the shared-trials signature. The verdict's 0.274
      // was measured on the review's properties setup (P2 plus a 1.5%
      // inflation spread, `simulation_compare.py` convergence()); this
      // case's P2 setup measured 0.299 on 24bae33b. Either is far under
      // 0.437, so the property, not a draw, is pinned.
      expect(ratio()).toBeLessThan(0.437);
    },
    SLOW,
  );
});

// ---------------------------------------------------------------------------
// K13: P2 through the full engine (SP-96)
// ---------------------------------------------------------------------------

describe("answer key: P2, 60/40 at 4%, 30 years", () => {
  // SP-96 P2: stocks a 10% s 18%, bonds 5% 7%, simple-return correlation
  // .05 (normal space .05037), 60/40 rebalanced yearly, fixed 3% inflation,
  // 4% of the start drawn at the start of each year and indexed, pay in
  // full or fail, 30 years, no tax or fees, no clamp. Reference (spec grid
  // and 2M draws): success .89166 (SE .00005); terminal real p50 1.007 ×
  // start on the end-of-year-30 index (quantile SE about .001). n 20,000,
  // seed 31 (the review's seed, fixed in advance; on 24bae33b it gave
  // .8935, SE .00218).
  const run = once((): MonteCarloResult => calculateMonteCarlo(p2(20_000, 31)));
  const n = 20_000;

  it(
    "sim/K13a [SIM-09] success within 3.89 SE of 0.89166",
    () => {
      // |p̂ − .89166| ≤ 3.89 √(p̂(1 − p̂)/n + .00005²): ±.00849 at p̂ .8935.
      const p = run().successRate;
      const tol = Z * Math.sqrt((p * (1 - p)) / n + 0.00005 ** 2);
      expect(Math.abs(p - 0.89166), `p̂ ${p} ±${tol}`).toBeLessThanOrEqual(tol);
    },
    SLOW,
  );

  // K13b. The engine's median nominal terminal balance in end-of-year-30
  // dollars (÷ 1.03³⁰ = 2.427262, fixed inflation, so every trial's index
  // is the same) should sit within 3.89 SE of 1.007 × start. The engine's
  // SE for a median at n 20,000 is √(.25/n)/f(m); the reference quartiles
  // (p25 .364, p50 1.007, p75 2.003) put the density at the median at
  // about .25/(2.003 − 1.007) = .251 or more, so SE ≤ .01409 and the
  // bound is 3.89 √(.01409² + .001²) = ±.0550 × start. Decision F3: the
  // today's-dollar median is that same figure, the nominal median ÷
  // 1.03³⁰. Today Ledgr divides by the last row's start-of-year index,
  // 1.03²⁹ = 2.356566, one year of inflation high (≈ 1.007 × 1.03 = 1.037).
  const START = 1_000_000;
  const MEDIAN_TOL = Z * Math.sqrt(0.01409 ** 2 + 0.001 ** 2);
  const nominalMedianReal = () =>
    run().distributions.terminalBalance.median / 1.03 ** 30 / START;
  it.fails(
    'sim/K13b [SIM-13] — expected failure until v0.11 Simulation "Decided: deflate each balance by its own date" (decision F3)',
    () => {
      expect(Math.abs(nominalMedianReal() - 1.007)).toBeLessThanOrEqual(
        MEDIAN_TOL,
      );
      // Each trial deflated then rounded to the cent: within 2¢.
      expect(
        Math.abs(
          run().today.terminalBalance.median -
            run().distributions.terminalBalance.median / 1.03 ** 30,
        ),
      ).toBeLessThanOrEqual(0.02);
    },
    SLOW,
  );
  it(
    `sim/K13b:today [SIM-13] — today's figure, wrong until ${DEFLATE_BY_DATE}`,
    () => {
      expect(Math.abs(nominalMedianReal() - 1.007)).toBeLessThanOrEqual(
        MEDIAN_TOL,
      );
      expect(
        Math.abs(
          run().today.terminalBalance.median -
            run().distributions.terminalBalance.median / 1.03 ** 29,
        ),
      ).toBeLessThanOrEqual(0.02);
    },
    SLOW,
  );
});

// ---------------------------------------------------------------------------
// K14: closed form P0 (SP-97)
// ---------------------------------------------------------------------------

describe("answer key: P0, one class, no flows", () => {
  it(
    "sim/K14 [SIM-02] 30 years at 7%/15%: mean 7.6123, median 5.6850",
    () => {
      // SP-8, SP-97: no flows, independent years, V₀ 1. Mean
      // E[V₃₀] = 1.07³⁰ = 7.6123. Median exp(30μ) with σ² = ln(1 +
      // .0225/1.1449) = .019463, μ = ln 1.07 − σ²/2 = .057928: exp(1.73784)
      // = 5.6850. Tolerances at n 100,000 (§ 11.7): mean ±1.10%, median
      // ±1.18%. Inflation 0, so today's dollars are nominal. Seed 11,
      // fixed in advance.
      const r = calculateMonteCarlo({
        engineInput: retiree({
          start: 1_000_000,
          spend: 0,
          years: 30,
          inflation: 0,
        }),
        numTrials: 100_000,
        seed: 11,
        assetClasses: [{ id: 1, name: "One", meanReturn: 0.07, stdDev: 0.15 }],
        correlations: [],
        glidePath: ALL_IN_ONE,
        ...NO_CLAMP,
      });
      expect(r.percentileBands).toHaveLength(30);
      const t = r.today.terminalBalance;
      expect(Math.abs(t.mean / 1e6 / 7.6123 - 1)).toBeLessThanOrEqual(0.011);
      expect(Math.abs(t.median / 1e6 / 5.685 - 1)).toBeLessThanOrEqual(0.0118);
    },
    SLOW,
  );
});

// ---------------------------------------------------------------------------
// K15: the 30-year rolling grid, replayed through the engine (§ 11.6)
// ---------------------------------------------------------------------------

/** The export's year-by-year series (spec Appendix A): stock growth `g`
 *  and dividends `d` as shares of the year's equity start, bond return
 *  `b` (`braw`, the raw yield a cycle's last year earns, only where no
 *  other cycle covers the year) and CPI change `pi`, each the median over
 *  the cycles that contain the year (they agree to rounding). */
function exportSeries() {
  const text = fs.readFileSync(
    path.join(__dirname, "cfiresim-export.csv"),
    "utf8",
  );
  const [head, ...lines] = text.split(/\r?\n/);
  const cols = head!.split(",");
  const at = (k: string) => cols.indexOf(k);
  const rows = lines
    .map((l) => l.split(","))
    .filter((c) => /^\d+$/.test((c[at("cycle_starting_year")] ?? "").trim()));
  const num = (c: string[], k: string) => Number(c[at(k)] || 0);
  const by = new Map<
    number,
    Record<"g" | "d" | "b" | "braw" | "pi", number[]>
  >();
  const slot = (y: number) => {
    if (!by.has(y)) by.set(y, { g: [], d: [], b: [], braw: [], pi: [] });
    return by.get(y)!;
  };
  const cycles = new Map<number, string[][]>();
  for (const c of rows) {
    const y = num(c, "year");
    const s = slot(y);
    s.g.push(num(c, "equities_growth") / num(c, "equities_start"));
    s.d.push(num(c, "dividends") / num(c, "equities_start"));
    (num(c, "segment_number") === 56 ? s.braw : s.b).push(
      num(c, "bonds_growth") / num(c, "bonds_start"),
    );
    const start = num(c, "cycle_starting_year");
    cycles.set(start, [...(cycles.get(start) ?? []), c]);
  }
  for (const cyc of cycles.values())
    for (let i = 1; i < cyc.length; i++)
      slot(num(cyc[i]!, "year")).pi.push(
        num(cyc[i]!, "cumulative_cpi") / num(cyc[i - 1]!, "cumulative_cpi"),
      );
  const median = (xs: number[]) =>
    quantile(
      [...xs].sort((x, y) => x - y),
      0.5,
    );
  const g = new Map<number, number>();
  const d = new Map<number, number>();
  const b = new Map<number, number>();
  const pi = new Map<number, number>();
  for (const [y, s] of by) {
    g.set(y, median(s.g));
    d.set(y, median(s.d));
    b.set(y, median(s.b.length ? s.b : s.braw));
    if (s.pi.length) pi.set(y, median(s.pi) - 1);
  }
  return { g, d, b, pi };
}

describe("answer key: history replayed through the engine", () => {
  it(
    "sim/K15 [SIM-09] the 42 cells of the 30-year grid, and the 4% failures",
    () => {
      // SP-95, SP-116 (spec § 11.6, Appendix A): every start year 1871-1995
      // (125 periods of 30 years), the stock share's return g + d plus the
      // bond share's b, rebalanced yearly, no fee; withdraw rate × start at
      // the start of each year, indexed by the export's CPI; success when
      // every withdrawal is paid. Expected counts, out of 125 (the spec's
      // own replay; the review matched all 42 through Ledgr):
      const expected: Record<string, number[]> = {
        // stocks: successes at 3%, 3.5%, 4%, 4.5%, 5%, 6%, 7%
        "1": [125, 125, 120, 113, 99, 85, 66],
        "0.75": [125, 125, 121, 114, 95, 77, 57],
        "0.6": [125, 125, 119, 107, 92, 67, 49],
        "0.5": [125, 125, 119, 102, 84, 61, 39],
        "0.25": [125, 123, 100, 72, 60, 41, 20],
        "0": [114, 85, 62, 56, 46, 24, 11],
      };
      // Failing starts at 4%, with the first unpaid year (1 = the start
      // year):
      const failingAt4: Record<string, [number, number][]> = {
        "0.75": [
          [1965, 27],
          [1966, 25],
          [1968, 28],
          [1969, 27],
        ],
        "0.6": [
          [1964, 30],
          [1965, 26],
          [1966, 25],
          [1967, 29],
          [1968, 28],
          [1969, 27],
        ],
        "1": [
          [1929, 27],
          [1965, 29],
          [1966, 25],
          [1968, 28],
          [1969, 26],
        ],
      };
      const rates = [0.03, 0.035, 0.04, 0.045, 0.05, 0.06, 0.07];
      const { g, d, b, pi } = exportSeries();
      const got: Record<string, number[]> = {};
      const fails: Record<string, [number, number][]> = {};
      for (const key of Object.keys(expected)) {
        const w = Number(key);
        got[key] = rates.map((rate) => {
          let ok = 0;
          for (let s0 = 1871; s0 <= 1995; s0++) {
            const years = Array.from({ length: 30 }, (_, j) => s0 + j);
            const outcome = assessPlan(
              calculateProjection(
                retiree({
                  start: 1_000_000,
                  spend: rate * 1_000_000,
                  years: 30,
                  inflation: 0,
                  returnPath: years.map(
                    (y) => w * (g.get(y)! + d.get(y)!) + (1 - w) * b.get(y)!,
                  ),
                  // Year 1's withdrawal is unindexed; year j's carries the
                  // CPI change into calendar year s0 + j.
                  shocks: years.map((y, j) => (j === 0 ? 0 : pi.get(y)!)),
                }),
              ),
            );
            if (outcome.succeeded) ok++;
            else if (rate === 0.04)
              (fails[key] ??= []).push([s0, outcome.failureYear - 2026 + 1]);
          }
          return ok;
        });
      }
      expect(got).toEqual(expected);
      for (const key of Object.keys(failingAt4))
        expect(fails[key], `stocks ${key} at 4%`).toEqual(failingAt4[key]);
    },
    SLOW,
  );
});
