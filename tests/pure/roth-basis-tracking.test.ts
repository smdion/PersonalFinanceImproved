/**
 * Tests for roth-basis-tracking.ts (v0.7.8 follow-up — tracked Roth basis
 * draw-down). Per the design decision doc's acceptance criteria: basis
 * never negative/over-balance, conservation (basis + growth sums to the
 * withdrawal), and the full-distribution equivalence invariant against
 * early-access.ts's balance-slicing predicates (the anti-drift guard for
 * Q3 — drawFromBasis must agree with the predicates it's the flow-dual of,
 * not just look plausible on its own).
 */
import { describe, it, expect } from "vitest";
import {
  initRothBasisState,
  accrueContributionBasis,
  drawFromBasis,
  applyBasisDraw,
  clampBasisToBalance,
} from "@/lib/pure/roth-basis-tracking";
import {
  computeRothIraAccess,
  computeEmployerPlanRothAccess,
} from "@/lib/pure/early-access";

describe("initRothBasisState", () => {
  it("seeds an all-zero state when there is no account_basis row", () => {
    const state = initRothBasisState(null, 2026);
    expect(state).toEqual({
      contributionBasis: 0,
      conversionBasis: 0,
      latestConversionYear: null,
      sourceYear: null,
      isSeeded: false,
      stale: false,
    });
  });

  it("carries the snapshot values and flags a stale (pre-projection) source year", () => {
    const state = initRothBasisState(
      {
        year: 2020,
        contributionBasis: 40000,
        conversionBasis: 5000,
        latestConversionYear: 2019,
        isSeeded: false,
        updatedAt: new Date("2020-06-01"),
      },
      2026,
    );
    expect(state.contributionBasis).toBe(40000);
    expect(state.conversionBasis).toBe(5000);
    expect(state.sourceYear).toBe(2020);
    expect(state.stale).toBe(true); // 2020 < 2026
  });

  it("does not flag stale when the source year is the projection start year or later", () => {
    const state = initRothBasisState(
      {
        year: 2026,
        contributionBasis: 10000,
        conversionBasis: 0,
        latestConversionYear: null,
        isSeeded: true,
        updatedAt: new Date("2026-01-01"),
      },
      2026,
    );
    expect(state.stale).toBe(false);
    expect(state.isSeeded).toBe(true);
  });
});

describe("accrueContributionBasis", () => {
  it("adds this year's contribution to the running total", () => {
    const state = initRothBasisState(null, 2026);
    const next = accrueContributionBasis(state, 7000);
    expect(next.contributionBasis).toBe(7000);
    // Original state untouched.
    expect(state.contributionBasis).toBe(0);
  });

  it("is a no-op for a zero or negative contribution", () => {
    const state = accrueContributionBasis(initRothBasisState(null, 2026), 0);
    expect(state.contributionBasis).toBe(0);
  });

  it("accumulates across multiple years", () => {
    let state = initRothBasisState(null, 2026);
    state = accrueContributionBasis(state, 7000);
    state = accrueContributionBasis(state, 7500);
    expect(state.contributionBasis).toBe(14500);
  });
});

describe("drawFromBasis — basis_first (Roth IRA)", () => {
  it("draws contribution basis before conversion basis before growth", () => {
    const state = initRothBasisState(
      {
        year: 2026,
        contributionBasis: 20000,
        conversionBasis: 10000,
        latestConversionYear: 2022,
        isSeeded: false,
        updatedAt: new Date(),
      },
      2026,
    );
    const draw = drawFromBasis({
      state,
      orderingRule: "basis_first",
      balanceBeforeWithdrawal: 100000,
      withdrawal: 25000,
    });
    expect(draw.contributionDrawn).toBe(20000);
    expect(draw.conversionDrawn).toBe(5000);
    expect(draw.growthDrawn).toBe(0);
    // Conservation.
    expect(
      draw.contributionDrawn + draw.conversionDrawn + draw.growthDrawn,
    ).toBe(25000);
  });

  it("draws only growth once basis is exhausted", () => {
    const state = initRothBasisState(null, 2026); // no basis at all
    const draw = drawFromBasis({
      state,
      orderingRule: "basis_first",
      balanceBeforeWithdrawal: 50000,
      withdrawal: 10000,
    });
    expect(draw.contributionDrawn).toBe(0);
    expect(draw.conversionDrawn).toBe(0);
    expect(draw.growthDrawn).toBe(10000);
  });

  it("full-distribution equivalence: matches computeRothIraAccess's non-growth (basis) slices when not age-qualified", () => {
    // Scoped to the under-59½ case deliberately: once age-qualified, growth
    // ALSO becomes taxFree in computeRothIraAccess (a different question —
    // "is this now qualified" — from "how much of it is basis"), which
    // would inflate a blanket "sum of taxFree slices" comparison for an
    // unrelated reason. The invariant that actually matters — and the one
    // this guards against drifting — is basis tracking agreeing with the
    // predicate's own basis slices specifically.
    const contributionBasis = 20000;
    const conversionBasis = 10000;
    const balance = 100000;
    const state = initRothBasisState(
      {
        year: 2026,
        contributionBasis,
        conversionBasis,
        latestConversionYear: 2022,
        isSeeded: false,
        updatedAt: new Date(),
      },
      2026,
    );
    const draw = drawFromBasis({
      state,
      orderingRule: "basis_first",
      balanceBeforeWithdrawal: balance,
      withdrawal: balance, // full distribution
    });
    const slices = computeRothIraAccess({
      balance,
      currentAge: 40, // under 59½
      currentYear: 2026,
      contributionBasis,
      conversionBasis,
      latestConversionYear: 2022,
    });
    const basisSlices = slices.filter((s) => s.label !== "Growth");
    const basisSliceTotal = basisSlices.reduce((s, x) => s + x.amount, 0);
    expect(draw.contributionDrawn + draw.conversionDrawn).toBe(basisSliceTotal);
    expect(basisSlices.every((s) => s.taxFree)).toBe(true);
  });
});

describe("drawFromBasis — pro_rata (401k/403b Roth sub-election)", () => {
  it("draws basis proportionally to the basis/balance ratio", () => {
    const state = initRothBasisState(
      {
        year: 2026,
        contributionBasis: 30000,
        conversionBasis: 0,
        latestConversionYear: null,
        isSeeded: false,
        updatedAt: new Date(),
      },
      2026,
    );
    // 30k basis / 100k balance = 30% basis ratio.
    const draw = drawFromBasis({
      state,
      orderingRule: "pro_rata",
      balanceBeforeWithdrawal: 100000,
      withdrawal: 10000,
    });
    expect(draw.contributionDrawn).toBeCloseTo(3000, 0);
    expect(draw.growthDrawn).toBeCloseTo(7000, 0);
    expect(
      draw.contributionDrawn + draw.conversionDrawn + draw.growthDrawn,
    ).toBeCloseTo(10000, 0);
  });

  it("full-distribution equivalence: matches computeEmployerPlanRothAccess's Basis slice", () => {
    const contributionBasis = 15000;
    const conversionBasis = 5000;
    const balance = 80000;
    const state = initRothBasisState(
      {
        year: 2026,
        contributionBasis,
        conversionBasis,
        latestConversionYear: 2021,
        isSeeded: false,
        updatedAt: new Date(),
      },
      2026,
    );
    const draw = drawFromBasis({
      state,
      orderingRule: "pro_rata",
      balanceBeforeWithdrawal: balance,
      withdrawal: balance, // full distribution
    });
    const slices = computeEmployerPlanRothAccess(
      balance,
      40, // currentAge, irrelevant to the basis/growth split itself
      false, // ruleOf55Eligible, irrelevant to the basis/growth split
      contributionBasis + conversionBasis,
    );
    const basisSlice = slices.find((s) => s.label.startsWith("Basis"))!;
    expect(draw.contributionDrawn + draw.conversionDrawn).toBeCloseTo(
      basisSlice.amount,
      2,
    );
  });

  it("zero balance before withdrawal never divides by zero", () => {
    const state = initRothBasisState(
      {
        year: 2026,
        contributionBasis: 5000,
        conversionBasis: 0,
        latestConversionYear: null,
        isSeeded: false,
        updatedAt: new Date(),
      },
      2026,
    );
    const draw = drawFromBasis({
      state,
      orderingRule: "pro_rata",
      balanceBeforeWithdrawal: 0,
      withdrawal: 0,
    });
    expect(draw).toEqual({
      contributionDrawn: 0,
      conversionDrawn: 0,
      growthDrawn: 0,
    });
  });
});

describe("applyBasisDraw", () => {
  it("decrements basis by the drawn amounts, never below zero", () => {
    const state = initRothBasisState(
      {
        year: 2026,
        contributionBasis: 10000,
        conversionBasis: 5000,
        latestConversionYear: 2022,
        isSeeded: false,
        updatedAt: new Date(),
      },
      2026,
    );
    const next = applyBasisDraw(state, {
      contributionDrawn: 4000,
      conversionDrawn: 5000,
      growthDrawn: 1000,
    });
    expect(next.contributionBasis).toBe(6000);
    expect(next.conversionBasis).toBe(0);
    // Original state untouched.
    expect(state.contributionBasis).toBe(10000);
  });
});

describe("clampBasisToBalance", () => {
  it("is a no-op when basis is already within the balance", () => {
    const state = initRothBasisState(
      {
        year: 2026,
        contributionBasis: 5000,
        conversionBasis: 0,
        latestConversionYear: null,
        isSeeded: false,
        updatedAt: new Date(),
      },
      2026,
    );
    expect(clampBasisToBalance(state, 10000)).toEqual(state);
  });

  it("clamps contribution basis before conversion basis when balance shrinks below total basis (mirrors early-access.ts's clamp order)", () => {
    const state = initRothBasisState(
      {
        year: 2026,
        contributionBasis: 8000,
        conversionBasis: 4000,
        latestConversionYear: 2022,
        isSeeded: false,
        updatedAt: new Date(),
      },
      2026,
    );
    // Balance shrinks to 6000 — less than total basis (12000).
    const clamped = clampBasisToBalance(state, 6000);
    expect(clamped.contributionBasis).toBe(6000);
    expect(clamped.conversionBasis).toBe(0);
  });

  it("zeroes both fields when balance is zero (dust-cleaned account)", () => {
    const state = initRothBasisState(
      {
        year: 2026,
        contributionBasis: 3000,
        conversionBasis: 1000,
        latestConversionYear: 2020,
        isSeeded: false,
        updatedAt: new Date(),
      },
      2026,
    );
    const clamped = clampBasisToBalance(state, 0);
    expect(clamped.contributionBasis).toBe(0);
    expect(clamped.conversionBasis).toBe(0);
  });
});
