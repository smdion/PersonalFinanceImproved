/**
 * Tests for pure IRS contribution limit resolution logic.
 * Covers: resolveIrsLimit, resolvePriorYearLimit, computeSiblingTotal, isEligibleForPriorYear.
 */
import { describe, it, expect } from "vitest";
import {
  resolveIrsLimit,
  resolvePriorYearLimit,
  computeSiblingTotal,
  isEligibleForPriorYear,
} from "@/lib/pure/contributions";

// These tests use the real account-type config, so they reflect actual IRS rules.
// The limits record mirrors real contribution_limits DB rows.

const limits2025: Record<string, number> = {
  "401k_employee_limit": 23500,
  "401k_catchup_limit": 7500,
  "401k_super_catchup_limit": 11250,
  ira_limit: 7000,
  ira_catchup_limit: 1000,
  hsa_individual_limit: 4300,
  hsa_family_limit: 8550,
  hsa_catchup_limit: 1000,
};

describe("resolveIrsLimit", () => {
  it("returns base 401k limit for young person", () => {
    const limit = resolveIrsLimit("401k", 35, null, limits2025);
    expect(limit).toBe(23500);
  });

  it("adds catchup for 50+ person", () => {
    const limit = resolveIrsLimit("401k", 52, null, limits2025);
    expect(limit).toBe(23500 + 7500);
  });

  it("adds super-catchup for 60-63 range if configured", () => {
    const limit = resolveIrsLimit("401k", 61, null, limits2025);
    // Super catchup replaces regular catchup for 60-63
    expect(limit).toBe(23500 + 11250);
  });

  it("returns 0 for non-IRS-limited category (brokerage)", () => {
    const limit = resolveIrsLimit("brokerage", 40, null, limits2025);
    expect(limit).toBe(0);
  });

  it("uses family HSA limit when coverage is family", () => {
    const limit = resolveIrsLimit("hsa", 40, "family", limits2025);
    expect(limit).toBe(8550);
  });

  it("uses individual HSA limit when coverage is individual", () => {
    const limit = resolveIrsLimit("hsa", 40, "individual", limits2025);
    expect(limit).toBe(4300);
  });

  it("adds HSA catchup for 55+", () => {
    const limit = resolveIrsLimit("hsa", 56, "individual", limits2025);
    expect(limit).toBe(4300 + 1000);
  });

  it("returns IRA base limit", () => {
    const limit = resolveIrsLimit("ira", 40, null, limits2025);
    expect(limit).toBe(7000);
  });

  it("adds IRA catchup for 50+", () => {
    const limit = resolveIrsLimit("ira", 55, null, limits2025);
    expect(limit).toBe(7000 + 1000);
  });
});

describe("resolvePriorYearLimit", () => {
  it("returns 0 for account types that don't support prior-year contributions", () => {
    const limit = resolvePriorYearLimit("401k", 40, null, limits2025);
    expect(limit).toBe(0);
  });

  it("returns prior-year HSA limit for eligible accounts", () => {
    const limit = resolvePriorYearLimit("hsa", 40, "individual", limits2025);
    expect(limit).toBe(4300);
  });

  it("uses prior-year age (one year younger)", () => {
    // Age 55 means prior-year age 54 — no catchup yet for HSA (catchup at 55)
    const limit = resolvePriorYearLimit("hsa", 55, "individual", limits2025);
    expect(limit).toBe(4300); // no catchup — prior year age is 54
  });

  it("includes catchup when prior-year age qualifies", () => {
    // Age 56 means prior-year age 55 — qualifies for catchup
    const limit = resolvePriorYearLimit("hsa", 56, "individual", limits2025);
    expect(limit).toBe(4300 + 1000);
  });
});

describe("computeSiblingTotal", () => {
  it("sums contributions from sibling accounts in same limit group", () => {
    const contribs = [
      { accountType: "401k", annualContribution: 10000, employerMatch: 5000 },
      { accountType: "401k", annualContribution: 8000, employerMatch: 3000 },
      { accountType: "hsa", annualContribution: 3000, employerMatch: 500 },
    ];
    // For index 0 (401k), sibling is index 1 (also 401k). HSA is different group.
    const total = computeSiblingTotal(contribs, 0, false);
    expect(total).toBe(8000);
  });

  it("includes employer match when matchCountsTowardLimit", () => {
    const contribs = [
      { accountType: "hsa", annualContribution: 2000, employerMatch: 500 },
      { accountType: "hsa", annualContribution: 1000, employerMatch: 300 },
    ];
    const total = computeSiblingTotal(contribs, 0, true);
    expect(total).toBe(1300); // 1000 + 300
  });

  it("returns 0 when no siblings in same group", () => {
    const contribs = [
      { accountType: "401k", annualContribution: 10000, employerMatch: 5000 },
      { accountType: "hsa", annualContribution: 3000, employerMatch: 500 },
    ];
    const total = computeSiblingTotal(contribs, 0, false);
    expect(total).toBe(0); // no other 401k
  });

  it("returns 0 for non-grouped account types", () => {
    const contribs = [
      { accountType: "brokerage", annualContribution: 5000, employerMatch: 0 },
    ];
    const total = computeSiblingTotal(contribs, 0, false);
    expect(total).toBe(0);
  });
});

describe("isEligibleForPriorYear", () => {
  it("returns true when all conditions met", () => {
    expect(isEligibleForPriorYear(true, "hsa", 500)).toBe(true);
  });

  it("returns false when not in prior year window", () => {
    expect(isEligibleForPriorYear(false, "hsa", 500)).toBe(false);
  });

  it("returns false when amount is 0", () => {
    expect(isEligibleForPriorYear(true, "hsa", 0)).toBe(false);
  });

  it("returns false for account types that don't support prior-year", () => {
    expect(isEligibleForPriorYear(true, "401k", 500)).toBe(false);
  });

  it("returns false for non-IRS-limited types", () => {
    expect(isEligibleForPriorYear(true, "brokerage", 500)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// View-aware metrics
// ---------------------------------------------------------------------------

import {
  computeViewAwareAccountMetrics,
  computeViewAwareTotals,
} from "@/lib/pure/contributions";

describe("computeViewAwareAccountMetrics", () => {
  const base = {
    projected: { employeeContrib: 12000, employerMatch: 3000 },
    blended: { employeeContrib: 12200, employerMatch: 2800 },
    limit: 24500,
    salary: 120000,
    ytdActual: { contributions: 5000, employerMatch: 2000 },
    matchCountsTowardLimit: false,
  };

  it("projected uses projected dollar amounts and limit metrics", () => {
    const v = computeViewAwareAccountMetrics(base);
    expect(v.projected.employeeContrib).toBe(12000);
    expect(v.projected.employerMatch).toBe(3000);
    expect(v.projected.totalContrib).toBe(15000);
    expect(v.projected.fundingPct).toBeCloseTo(12000 / 24500, 4);
    expect(v.projected.fundingMissing).toBe(24500 - 12000);
    expect(v.projected.pctOfSalaryToMax).toBeGreaterThan(0);
  });

  it("blended uses pre-computed blended dollar amounts", () => {
    const v = computeViewAwareAccountMetrics(base);
    expect(v.blended.employeeContrib).toBe(12200);
    expect(v.blended.employerMatch).toBe(2800);
    expect(v.blended.fundingPct).toBeCloseTo(12200 / 24500, 4);
  });

  it("ytd uses actual dollar amounts", () => {
    const v = computeViewAwareAccountMetrics(base);
    expect(v.ytd.employeeContrib).toBe(5000);
    expect(v.ytd.employerMatch).toBe(2000);
    expect(v.ytd.fundingPct).toBeCloseTo(5000 / 24500, 4);
    expect(v.ytd.pctOfSalaryToMax).toBeNull();
  });

  it("matchCountsTowardLimit includes employer match in ytd funding", () => {
    const v = computeViewAwareAccountMetrics({
      ...base,
      matchCountsTowardLimit: true,
    });
    expect(v.ytd.fundingPct).toBeCloseTo(7000 / 24500, 4);
  });

  it("ytdActual=null falls back to projected for all views", () => {
    const v = computeViewAwareAccountMetrics({ ...base, ytdActual: null });
    expect(v.blended).toEqual(v.projected);
    expect(v.ytd).toEqual(v.projected);
  });

  it("limit=0 returns zero metrics for all views", () => {
    const v = computeViewAwareAccountMetrics({ ...base, limit: 0 });
    expect(v.projected.fundingPct).toBe(0);
    expect(v.blended.fundingPct).toBe(0);
    expect(v.ytd.fundingPct).toBe(0);
  });

  it("salary=0 returns null pctOfSalaryToMax", () => {
    const v = computeViewAwareAccountMetrics({ ...base, salary: 0 });
    expect(v.projected.pctOfSalaryToMax).toBeNull();
  });
});

describe("computeViewAwareTotals", () => {
  // Blended = pre-computed from method-aware remaining fractions
  const base = {
    projected: {
      retirementWithoutMatch: 20000,
      retirementWithMatch: 25000,
      portfolioWithoutMatch: 5000,
      portfolioWithMatch: 5000,
    },
    blended: {
      retirementWithoutMatch: 18000,
      retirementWithMatch: 23500,
      portfolioWithoutMatch: 4500,
      portfolioWithMatch: 4500,
    },
    ytdActuals: { retirement: 8000, portfolio: 2000, match: 3000 },
    ytdRatio: 0.5,
    totalCompensation: 150000,
  };

  it("projected passes through annual values", () => {
    const v = computeViewAwareTotals(base);
    expect(v.projected.retirementWithoutMatch).toBe(20000);
    expect(v.projected.totalWithMatch).toBe(30000);
    expect(v.projected.savingsRateWithMatch).toBeCloseTo(30000 / 150000, 4);
  });

  it("blended uses pre-computed blended totals", () => {
    const v = computeViewAwareTotals(base);
    expect(v.blended.retirementWithoutMatch).toBe(18000);
    expect(v.blended.retirementWithMatch).toBe(23500);
    expect(v.blended.totalWithMatch).toBe(23500 + 4500);
  });

  it("ytd shows actual amounts only", () => {
    const v = computeViewAwareTotals(base);
    expect(v.ytd.retirementWithoutMatch).toBeCloseTo(8000, 0);
    expect(v.ytd.retirementWithMatch).toBeCloseTo(11000, 0);
    expect(v.ytd.portfolioWithoutMatch).toBeCloseTo(2000, 0);
  });

  it("ytd savings rate uses prorated compensation", () => {
    const v = computeViewAwareTotals(base);
    // ytdRetWith=8000+3000=11000, ytdPortWith=2000, total=13000
    expect(v.ytd.savingsRateWithMatch).toBeCloseTo(13000 / (150000 * 0.5), 4);
  });

  it("all ytdActuals=0 falls back to projected", () => {
    const v = computeViewAwareTotals({
      ...base,
      ytdActuals: { retirement: 0, portfolio: 0, match: 0 },
    });
    expect(v.blended).toEqual(v.projected);
  });

  it("totalCompensation=0 returns zero savings rate", () => {
    const v = computeViewAwareTotals({ ...base, totalCompensation: 0 });
    expect(v.projected.savingsRateWithMatch).toBe(0);
  });
});
