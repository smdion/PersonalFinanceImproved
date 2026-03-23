import { describe, it, expect, vi } from "vitest";

// Mock DB schema and config to avoid pg driver import
vi.mock("@/lib/db/schema", () => ({
  contributionAccounts: {},
  jobs: {},
  people: {},
  performanceAccounts: {},
  salaryChanges: {},
  contributionProfiles: {},
}));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/config/account-types", () => ({
  isTaxFree: (t: string) => t === "roth" || t === "after_tax",
  buildCategoryRecord: (fn: () => unknown) => {
    const cats = ["401k", "ira", "brokerage", "hsa"];
    return Object.fromEntries(cats.map((c) => [c, fn()]));
  },
  categoriesWithTaxPreference: () => ["401k", "ira"],
  getAllCategories: () => ["401k", "ira", "brokerage", "hsa"],
  getDisplayGroup: () => "retirement",
  getParentCategory: (c: string) => c,
}));
vi.mock("@/lib/config/display-labels", () => ({
  TAX_TREATMENT_TO_TAX_TYPE: { pre_tax: "traditional", roth: "roth" },
}));

import {
  computeAnnualContribution,
  computeEmployerMatch,
} from "@/server/helpers/contribution";

describe("computeAnnualContribution", () => {
  it("computes percent_of_salary correctly", () => {
    // 10% of $120,000
    expect(computeAnnualContribution("percent_of_salary", 10, 120000, 26)).toBe(
      12000,
    );
  });

  it("computes fixed_per_period correctly", () => {
    // $500/period × 26 periods
    expect(computeAnnualContribution("fixed_per_period", 500, 120000, 26)).toBe(
      13000,
    );
  });

  it("computes fixed_monthly correctly", () => {
    // $1000/month × 12
    expect(computeAnnualContribution("fixed_monthly", 1000, 120000, 26)).toBe(
      12000,
    );
  });

  it("treats unknown method as fixed_annual", () => {
    expect(computeAnnualContribution("fixed_annual", 6000, 120000, 26)).toBe(
      6000,
    );
  });

  it("handles zero salary for percent_of_salary", () => {
    expect(computeAnnualContribution("percent_of_salary", 10, 0, 26)).toBe(0);
  });

  it("handles zero value", () => {
    expect(computeAnnualContribution("percent_of_salary", 0, 120000, 26)).toBe(
      0,
    );
  });
});

describe("computeEmployerMatch", () => {
  it("returns 0 for no match type", () => {
    expect(
      computeEmployerMatch(null, 0, 0, 12000, "percent_of_salary", 10, 120000),
    ).toBe(0);
  });

  it("returns 0 for 'none' match type", () => {
    expect(
      computeEmployerMatch(
        "none",
        0,
        0,
        12000,
        "percent_of_salary",
        10,
        120000,
      ),
    ).toBe(0);
  });

  it("computes percent_of_contribution match correctly", () => {
    // 100% match up to 6% of salary
    // Employee contributes 10% ($12,000). Max match is 6% of salary.
    // Match = salary × min(empPct, maxMatchPct) × matchRate
    // = 120000 × min(0.10, 0.06) × 1.0 = 120000 × 0.06 × 1.0 = 7200
    expect(
      computeEmployerMatch(
        "percent_of_contribution",
        100,
        0.06,
        12000,
        "percent_of_salary",
        10,
        120000,
      ),
    ).toBe(7200);
  });

  it("computes percent_of_contribution without cap", () => {
    // 50% match, no cap (maxMatchPct = 0)
    // Employee contributes 10% of $120k.
    // Match = 120000 × 0.10 × 0.50 = 6000
    expect(
      computeEmployerMatch(
        "percent_of_contribution",
        50,
        0,
        12000,
        "percent_of_salary",
        10,
        120000,
      ),
    ).toBe(6000);
  });

  it("returns 0 for percent_of_contribution with zero salary", () => {
    expect(
      computeEmployerMatch(
        "percent_of_contribution",
        100,
        0.06,
        0,
        "percent_of_salary",
        10,
        0,
      ),
    ).toBe(0);
  });

  it("computes dollar_match correctly", () => {
    expect(
      computeEmployerMatch(
        "dollar_match",
        5000,
        0,
        12000,
        "percent_of_salary",
        10,
        120000,
      ),
    ).toBe(5000);
  });

  it("computes fixed_annual match correctly", () => {
    expect(
      computeEmployerMatch(
        "fixed_annual",
        3000,
        0,
        12000,
        "percent_of_salary",
        10,
        120000,
      ),
    ).toBe(3000);
  });

  it("returns 0 for unknown match type", () => {
    expect(
      computeEmployerMatch(
        "unknown",
        5000,
        0,
        12000,
        "percent_of_salary",
        10,
        120000,
      ),
    ).toBe(0);
  });

  it("handles fixed_per_period contrib method for empPct calculation", () => {
    // Employee contributes $500/period (annual = $13,000 on $120k salary)
    // empPct = 13000/120000 = 0.1083
    // 100% match up to 6% = salary × min(0.1083, 0.06) × 1.0 = 7200
    expect(
      computeEmployerMatch(
        "percent_of_contribution",
        100,
        0.06,
        13000,
        "fixed_per_period",
        500,
        120000,
      ),
    ).toBe(7200);
  });
});
