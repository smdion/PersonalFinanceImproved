/**
 * The gross-up solves `W - cost(W) = need`: a funded decumulation year
 * withdraws exactly enough that what's left after tax and penalty (less any
 * RMD money reinvested) plus Social Security is the year's spending. The
 * solver's own tests assert only bounds (`>=`), which no over-withdrawal
 * can fail; these assert the equation itself, through the whole engine.
 *
 * Two properties, because the equation is exact only where nothing is
 * charged after routing:
 *   - Exact: spending equals the budget in every need-sized year that is
 *     funded, has no RMD and no Roth conversion (both are enforced after
 *     routing, a residual gap the year handler documents) and isn't the
 *     year the money runs out.
 *   - Never over: no need-sized year spends more than its budget. A solver
 *     that over-withdraws (the whole-balance failure) shows here, RMD years
 *     included, since RMD money beyond the need is reinvested, not spent.
 *     It holds for these households, which never pay a penalty in an RMD
 *     year (everyone is 60 or older; the whole-balance household is single
 *     and has no RMD before 59½), not for every household: a per-owner RMD
 *     reshape that moves a draw off a penalized account onto the RMD
 *     owner's spends the penalty the draw was sized for and never pays,
 *     until v0.11.1 EN2 D1 (answer key `engine/RX1-R`, an expected
 *     failure).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import { calculateProjection } from "@/lib/pure/engine";
import type {
  EngineDecumulationYear,
  ProjectionInput,
} from "@/lib/pure/engine/types";
import { grossUpWholeBalanceHousehold } from "../fixtures/gross-up-whole-balance";
import {
  arbitraryHousehold,
  buildHousehold,
  type Shape,
} from "../fixtures/gross-up-households";

const NUM_RUNS = parseInt(process.env.FAST_CHECK_NUM_RUNS ?? "20", 10);
// Spending sums four cent-rounded figures (withdrawal, tax, penalty,
// reinvested RMD money) on a solve accurate to a cent.
const EPSILON = 0.025;

function decumulationYears(input: ProjectionInput): EngineDecumulationYear[] {
  return calculateProjection(input).projectionByYear.filter(
    (y): y is EngineDecumulationYear => y.phase === "decumulation",
  );
}

/** The budget sizes the withdrawal (not a portfolio-sized strategy). */
function needSized(years: EngineDecumulationYear[]) {
  return years.filter((y) => !y.withdrawalSized && y.afterTaxNeed > 0);
}

/** Years where the equation must hold exactly (see the file docblock). */
function exactYears(years: EngineDecumulationYear[]) {
  return needSized(years).filter(
    (y) =>
      (y.unmetNeed ?? 0) === 0 &&
      y.rmdAmount === 0 &&
      y.rothConversionAmount === 0 &&
      y.retirementBalance >= 1,
  );
}

function expectExact(years: EngineDecumulationYear[]) {
  for (const y of exactYears(years))
    expect(Math.abs(y.spending - y.projectedExpenses)).toBeLessThan(EPSILON);
}

function expectNeverOver(years: EngineDecumulationYear[]) {
  for (const y of needSized(years))
    expect(y.spending).toBeLessThan(y.projectedExpenses + EPSILON);
}

describe("the gross-up delivers the need", () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  it("a cent-scale secant slope doesn't withdraw the whole balance (production-path household)", () => {
    const years = decumulationYears(grossUpWholeBalanceHousehold());
    const y2058 = years.find((y) => y.year === 2058)!;
    expect(y2058.afterTaxNeed).toBe(59226.9);
    // The RMD exceeds the grossed-up need: the year withdraws the RMD and
    // reinvests what spending and tax don't use.
    expect(y2058.rmdAmount).toBeCloseTo(105999.55, 2);
    expect(y2058.totalWithdrawal).toBeCloseTo(105999.55, 2);
    expect(y2058.taxCost).toBeCloseTo(10412.67, 2);
    expect(y2058.rmdExcessAmount).toBeCloseTo(36359.98, 2);
    expect(y2058.spending).toBeCloseTo(y2058.projectedExpenses, 2);
    // Never short once the money unlocks: before 59½ (December 2028) every
    // dollar is in Traditional accounts behind the early-withdrawal penalty.
    for (const y of years.filter((r) => r.year >= 2029))
      expect(y.unmetNeedMaterial ?? false).toBe(false);
    expect(years.at(-1)!.retirementBalance).toBeGreaterThan(1_000_000);
  });

  it("that household spends its budget every year, never more", () => {
    const years = decumulationYears(grossUpWholeBalanceHousehold());
    expectExact(years);
    expectNeverOver(years);
  });

  // Percentage routing, where a cent-scale secant slope once sent a year's
  // withdrawal to (nearly) the whole balance: a couple filing jointly and a
  // single head of household.
  const runaways: [string, Shape][] = [
    [
      "MFJ couple, percentage routing",
      {
        twoPeople: true,
        singleFiling: "HOH",
        routing: "percentage",
        annAge: 67,
        boAge: 64,
        annSs: 17796,
        boSs: 4697,
        annSsStart: 65,
        boSsStart: 66,
        annTraditional: 693546,
        annRoth: 68603,
        brokerage: 389328,
        boTraditional: 265469,
        iraPreference: "traditional",
        bracketCeiling: 0.1,
        expenses: 64195,
        inflation: 0,
        returnRate: 0,
      },
    ],
    [
      "HOH single, percentage routing",
      {
        twoPeople: false,
        singleFiling: "HOH",
        routing: "percentage",
        annAge: 70,
        boAge: 80,
        annSs: 30500,
        boSs: 0,
        annSsStart: 64,
        boSsStart: 69,
        annTraditional: 413253,
        annRoth: 299217,
        brokerage: 325281,
        boTraditional: 0,
        iraPreference: "roth",
        bracketCeiling: 0.1,
        expenses: 77244,
        inflation: 0,
        returnRate: 0.08,
      },
    ],
  ];
  it.each(runaways)(
    "%s: spends its budget every year, never more",
    (_, shape) => {
      const years = decumulationYears(buildHousehold(shape));
      expectExact(years);
      expectNeverOver(years);
    },
  );

  it("every exact year spends its budget, across households", () => {
    fc.assert(
      fc.property(arbitraryHousehold, (input) =>
        expectExact(decumulationYears(input)),
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("no year spends more than its budget, across households", () => {
    fc.assert(
      fc.property(arbitraryHousehold, (input) =>
        expectNeverOver(decumulationYears(input)),
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
