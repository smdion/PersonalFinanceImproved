/**
 * Answer key, passing companions for rows whose only cases were expected
 * failures (the 2026-11-08 test-suite review § 2; v0.10.5 overnight batch
 * 3): an input where today's code is right, so a regression in the part
 * that works is caught too. Only rows with an outside authority or plain
 * arithmetic: the Roth IRA verdict's range (LIM-13) and today's dollars
 * per trial (SIM-13). Worked by hand first, never read from `src/`.
 * Invented households only.
 *
 * Citations: IRC 408A(c)(3); Notice 2025-67 and Pub 590-A (2025)
 * Worksheet 2-2 (2026 Roth IRA range, Single $153,000-$168,000; the IRA
 * limit $7,500 under 50); the verdict's margin below the range is owner
 * design (`roth_ira_direct_margin`, default the range's width, $15,000).
 * Today's dollars: a figure divided by the trial's price index; at 0%
 * inflation the index is 1, so today's dollars are the nominal ones
 * (SIM-13's own expected failure covers the dated index at 3%).
 */
import { describe, expect, it } from "vitest";
import { cents } from "../../fixtures/answer-key";
import {
  ALL_IN_ONE,
  NO_CLAMP,
  retiree,
} from "../../fixtures/answer-key-simulation";
import { judgeRothIra } from "@/lib/pure/contributions/roth-ira-judge";
import { calculateMonteCarlo } from "@/lib/pure/simulation/monte-carlo";

const SINGLE_2026 = { start: 153_000, end: 168_000 };

/** One Single filer, 45, paid $200,000, judged at `magi`. */
const judge = (magi: number) =>
  judgeRothIra({
    magi,
    phaseOut: SINGLE_2026,
    marginOverride: null,
    combinedCompensation: false,
    people: [
      { personId: 1, name: "A", compensation: 200_000, iraLimit: 7_500 },
    ],
  })!;

describe("answer key: the Roth IRA verdict where today's code is right", () => {
  it("limits/LIM13-1 [LIM-13] well under the range: direct, the whole limit", () => {
    // MAGI 120,000 < 153,000 − 15,000 = 138,000: direct; no reduction
    // (Worksheet 2-2 needs MAGI over 153,000): 7,500.
    const r = judge(120_000);
    expect(r.verdict).toBe("direct");
    cents(r.people[0]!.maxDirect, 7_500);
  });

  it("limits/LIM13-2 [LIM-13] inside the margin: too close to call, still the whole limit", () => {
    // MAGI 145,000: at or above 138,000 but under 153,000; nothing is
    // reduced yet: 7,500.
    const r = judge(145_000);
    expect(r.verdict).toBe("tooClose");
    cents(r.people[0]!.maxDirect, 7_500);
  });

  it("limits/LIM13-3 [LIM-13] at the range's top: backdoor, nothing direct", () => {
    // MAGI 168,000: 408A(c)(3)(A) reduces the limit to 0 at the end of the
    // range: backdoor, 0.
    const r = judge(168_000);
    expect(r.verdict).toBe("backdoor");
    cents(r.people[0]!.maxDirect, 0);
  });
});

describe("answer key: today's dollars at 0% inflation", () => {
  it("sim/SIM13-1 [SIM-13] the price index is 1: today's dollars are the nominal ones", () => {
    // Retired, Roth 1,000,000, spending 40,000 drawn at the start of each
    // year, 5% return, 0% inflation, no spread. 2026: (1,000,000 −
    // 40,000) × 1.05 = 1,008,000; 2027: (1,008,000 − 40,000) × 1.05 =
    // 1,016,400. Today's dollars the same.
    const r = calculateMonteCarlo({
      engineInput: retiree({
        start: 1_000_000,
        spend: 40_000,
        years: 30,
        inflation: 0,
        returnRate: 0.05,
      }),
      numTrials: 5,
      seed: 1,
      assetClasses: [{ id: 1, name: "One", meanReturn: 0.05, stdDev: 0 }],
      correlations: [],
      glidePath: ALL_IN_ONE,
      ...NO_CLAMP,
    });
    cents(
      {
        nominal0: r.percentileBands[0]!.p50,
        today0: r.today.percentileBands[0]!.p50,
        nominal1: r.percentileBands[1]!.p50,
        today1: r.today.percentileBands[1]!.p50,
      },
      {
        nominal0: 1_008_000,
        today0: 1_008_000,
        nominal1: 1_016_400,
        today1: 1_016_400,
      },
    );
  });
});
