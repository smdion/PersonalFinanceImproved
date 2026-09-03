/**
 * Tests for the Tax Buckets tool's early-access (Rule of 55 / Roth
 * ordering rules) computation.
 */
import { describe, it, expect } from "vitest";
import {
  resolveSeparationYear,
  isRuleOf55Eligible,
  computeBrokerageAccess,
  computeTraditionalIraAccess,
  computeEmployerPlanPreTaxAccess,
  computeEmployerPlanRothAccess,
  computeRothIraAccess,
} from "@/lib/pure/early-access";

describe("resolveSeparationYear", () => {
  it("prefers an explicit separation year over derived data", () => {
    const result = resolveSeparationYear({
      explicitSeparationYear: 2040,
      linkedJobs: [{ endDate: new Date("2020-01-01"), isSpeculative: false }],
      currentDate: new Date("2026-01-01"),
    });
    expect(result).toEqual({ year: 2040, source: "explicit" });
  });

  it("derives from an ended job's real endDate, not filtered as inactive", () => {
    // A dormant former-employer plan: the job ended years ago. Must NOT be
    // excluded the way filterActiveJobs()/isActive filtering would exclude it.
    const result = resolveSeparationYear({
      explicitSeparationYear: null,
      linkedJobs: [{ endDate: new Date("2020-06-01"), isSpeculative: false }],
      currentDate: new Date("2026-01-01"),
    });
    expect(result).toEqual({ year: 2020, source: "derived" });
  });

  it("picks the MAX across multiple already-ended linked jobs", () => {
    // Left job A in 2015, left job B (a later employer) in 2020 — both real,
    // already-happened separations. Must pick 2020, the latest, not 2015.
    const result = resolveSeparationYear({
      explicitSeparationYear: null,
      linkedJobs: [
        { endDate: new Date("2015-01-01"), isSpeculative: false },
        { endDate: new Date("2020-01-01"), isSpeculative: false },
      ],
      currentDate: new Date("2026-01-01"),
    });
    expect(result).toEqual({ year: 2020, source: "derived" });
  });

  it("reports 'active' (not 'no_data') when the only linked job has no real endDate yet — still employed, not unknown", () => {
    const result = resolveSeparationYear({
      explicitSeparationYear: null,
      linkedJobs: [{ endDate: null, isSpeculative: false }],
      currentDate: new Date("2026-01-01"),
    });
    expect(result).toEqual({ year: null, source: "active" });
  });

  it("filters out speculative what-if jobs", () => {
    const result = resolveSeparationYear({
      explicitSeparationYear: null,
      linkedJobs: [{ endDate: new Date("2020-01-01"), isSpeculative: true }],
      currentDate: new Date("2026-01-01"),
    });
    expect(result).toEqual({ year: null, source: "no_data" });
  });

  it("returns no_data, not ineligible, when no linked job and no explicit date", () => {
    const result = resolveSeparationYear({
      explicitSeparationYear: null,
      linkedJobs: [],
      currentDate: new Date("2026-01-01"),
    });
    expect(result).toEqual({ year: null, source: "no_data" });
  });
});

describe("isRuleOf55Eligible", () => {
  it("is eligible when separation age is exactly 55", () => {
    expect(isRuleOf55Eligible(2042, 1987)).toBe(true);
  });

  it("is eligible for a dormant former-employer plan separated at 56, still true decades later", () => {
    // A subtle case: eligibility is permanent once earned, not tied to
    // "current employer."
    expect(isRuleOf55Eligible(2043, 1987)).toBe(true);
  });

  it("is not eligible when separation happens before 55", () => {
    expect(isRuleOf55Eligible(2032, 1987)).toBe(false); // age 45
  });
});

describe("computeBrokerageAccess", () => {
  it("is always penalty-free; only growth is taxable", () => {
    const slices = computeBrokerageAccess(23697.52, 10120.24);
    expect(slices).toEqual([
      {
        label: "Cost basis",
        amount: 10120.24,
        penaltyFree: true,
        taxFree: true,
      },
      {
        label: "Growth",
        amount: 23697.52 - 10120.24,
        penaltyFree: true,
        taxFree: false,
      },
    ]);
  });
});

describe("computeTraditionalIraAccess", () => {
  it("is penalty-free only at 59½, always taxable", () => {
    expect(computeTraditionalIraAccess(100000, 56)).toEqual([
      {
        label: "Traditional IRA",
        amount: 100000,
        penaltyFree: false,
        taxFree: false,
      },
    ]);
    expect(computeTraditionalIraAccess(100000, 60)).toEqual([
      {
        label: "Traditional IRA",
        amount: 100000,
        penaltyFree: true,
        taxFree: false,
      },
    ]);
  });
});

describe("computeEmployerPlanPreTaxAccess", () => {
  it("is penalty-free once Rule-of-55-eligible, even under 59½ — the case round 2 caught", () => {
    // A 56-year-old, Rule-of-55-eligible for this account: the household's
    // full preTax 401k balance must show penalty-free, not locked.
    const slices = computeEmployerPlanPreTaxAccess(200037.65, 56, true);
    expect(slices).toEqual([
      {
        label: "Traditional",
        amount: 200037.65,
        penaltyFree: true,
        taxFree: false,
      },
    ]);
  });

  it("is locked pre-59½ when not Rule-of-55-eligible", () => {
    const slices = computeEmployerPlanPreTaxAccess(200037.65, 50, false);
    expect(slices[0]!.penaltyFree).toBe(false);
  });

  it("is penalty-free at 59½ regardless of Rule of 55", () => {
    const slices = computeEmployerPlanPreTaxAccess(200037.65, 60, false);
    expect(slices[0]!.penaltyFree).toBe(true);
  });
});

describe("computeEmployerPlanRothAccess", () => {
  it("shares the same penalty-free gate as the preTax slice of the same account (Rule of 55 frees the whole plan)", () => {
    const slices = computeEmployerPlanRothAccess(92992.68, 56, true, 40000);
    const basisSlice = slices.find((s) => s.label.startsWith("Basis"))!;
    const growthSlice = slices.find((s) => s.label.startsWith("Growth"))!;
    expect(basisSlice.penaltyFree).toBe(true);
    expect(growthSlice.penaltyFree).toBe(true); // same gate, not independently computed
    expect(basisSlice.taxFree).toBe(true);
    expect(growthSlice.taxFree).toBe(false);
    expect(basisSlice.amount).toBe(40000);
    expect(growthSlice.amount).toBeCloseTo(92992.68 - 40000, 2);
  });

  it("caps entered basis at the account balance", () => {
    const slices = computeEmployerPlanRothAccess(1000, 60, true, 5000);
    const basisSlice = slices.find((s) => s.label.startsWith("Basis"))!;
    expect(basisSlice.amount).toBe(1000);
  });
});

describe("computeRothIraAccess", () => {
  it("contribution basis is always penalty-free and tax-free, no clock", () => {
    const slices = computeRothIraAccess({
      balance: 188268.24,
      currentAge: 39,
      currentYear: 2026,
      contributionBasis: 50000,
      conversionBasis: 0,
      latestConversionYear: null,
    });
    const contribSlice = slices.find((s) => s.label === "Contribution basis")!;
    expect(contribSlice.amount).toBe(50000);
    expect(contribSlice.penaltyFree).toBe(true);
    expect(contribSlice.taxFree).toBe(true);
    // No conversion basis entered — no conversion slice.
    expect(slices.find((s) => s.label === "Conversion basis")).toBeUndefined();
  });

  it("gates conversion basis on the 5-year clock from the LATEST tracked conversion year", () => {
    // Multi-year ladder pooled into one number: converted in 2020 and 2025,
    // latestConversionYear=2025 (the conservative choice). In 2026, only 1
    // year has passed since 2025 — must be locked, even though the 2020
    // conversion alone would have seasoned.
    const slices = computeRothIraAccess({
      balance: 100000,
      currentAge: 50,
      currentYear: 2026,
      contributionBasis: 0,
      conversionBasis: 100000,
      latestConversionYear: 2025,
    });
    const conversionSlice = slices.find((s) => s.label === "Conversion basis")!;
    expect(conversionSlice.penaltyFree).toBe(false); // understated, not overstated
    expect(conversionSlice.taxFree).toBe(true); // conversions are always tax-free
  });

  it("conversion basis becomes penalty-free once 5 years have passed since the latest conversion", () => {
    const slices = computeRothIraAccess({
      balance: 100000,
      currentAge: 50,
      currentYear: 2030,
      contributionBasis: 0,
      conversionBasis: 100000,
      latestConversionYear: 2025,
    });
    const conversionSlice = slices.find((s) => s.label === "Conversion basis")!;
    expect(conversionSlice.penaltyFree).toBe(true);
  });

  it("growth needs age 59½ for both penalty-free and tax-free", () => {
    const under = computeRothIraAccess({
      balance: 100000,
      currentAge: 50,
      currentYear: 2026,
      contributionBasis: 20000,
      conversionBasis: 0,
      latestConversionYear: null,
    });
    const growthUnder = under.find((s) => s.label === "Growth")!;
    expect(growthUnder.amount).toBe(80000);
    expect(growthUnder.penaltyFree).toBe(false);
    expect(growthUnder.taxFree).toBe(false);

    const over = computeRothIraAccess({
      balance: 100000,
      currentAge: 60,
      currentYear: 2026,
      contributionBasis: 20000,
      conversionBasis: 0,
      latestConversionYear: null,
    });
    const growthOver = over.find((s) => s.label === "Growth")!;
    expect(growthOver.penaltyFree).toBe(true);
    expect(growthOver.taxFree).toBe(true);
  });

  it("caps contribution + conversion basis at the total balance", () => {
    const slices = computeRothIraAccess({
      balance: 1000,
      currentAge: 50,
      currentYear: 2026,
      contributionBasis: 800,
      conversionBasis: 800,
      latestConversionYear: 2020,
    });
    const contrib = slices.find((s) => s.label === "Contribution basis")!;
    const conversion = slices.find((s) => s.label === "Conversion basis")!;
    const growth = slices.find((s) => s.label === "Growth")!;
    expect(contrib.amount).toBe(800);
    expect(conversion.amount).toBe(200); // capped to what's left
    expect(growth.amount).toBe(0);
  });
});
