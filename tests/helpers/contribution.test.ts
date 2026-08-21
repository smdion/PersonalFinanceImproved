import { describe, it, expect, vi } from "vitest";

// Mock DB schema and config to avoid pg driver import
vi.mock("@/lib/db/schema", () => ({
  contributionAccounts: {},
  jobs: {},
  people: {},
  performanceAccounts: {},
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
  computeGroupedEmployerMatch,
  type GroupableMatchRow,
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

describe("computeGroupedEmployerMatch", () => {
  function makeRow(
    overrides: Partial<GroupableMatchRow> = {},
  ): GroupableMatchRow {
    return {
      id: 1,
      jobId: 1,
      personId: 1,
      accountType: "401k",
      parentCategory: "Retirement",
      annual: 0,
      salary: 120000,
      employerMatchType: null,
      employerMatchValue: 0,
      employerMaxMatchPct: 0,
      employerMatchTaxTreatment: "pre_tax",
      ...overrides,
    };
  }

  it("matches computeEmployerMatch for a single ungrouped row (dormant case, own rate already above cap)", () => {
    // Trad 401k row alone: 10% of 120k = 12000, capped at 6% -> same result
    // whether computed per-row (old code) or combined-then-capped (new code),
    // since there's no sibling to combine with.
    const rows = [
      makeRow({
        id: 1,
        annual: 12000,
        employerMatchType: "percent_of_contribution",
        employerMatchValue: 100,
        employerMaxMatchPct: 0.06,
      }),
    ];
    const result = computeGroupedEmployerMatch(rows);
    // 120000 * min(0.10, 0.06) * 1.0 = 7200
    expect(result.get(1)!.matchAnnual).toBe(7200);
  });

  it("combines Roth+Traditional siblings before capping, matching real match-config precedent", () => {
    // Trad row (id 1): $12000 contribution, holds the match config.
    // Roth row (id 2): $6000 contribution, no match config of its own.
    // Combined rate = 18000/120000 = 0.15, capped at 0.06.
    // Total match = 120000 * 0.06 * 1.0 = 7200, split 2:1 by contribution share.
    const rows = [
      makeRow({
        id: 1,
        annual: 12000,
        taxTreatment: "pre_tax",
        employerMatchType: "percent_of_contribution",
        employerMatchValue: 100,
        employerMaxMatchPct: 0.06,
      }),
      makeRow({ id: 2, annual: 6000, taxTreatment: "tax_free" }),
    ];
    const result = computeGroupedEmployerMatch(rows);
    expect(result.get(1)!.matchAnnual).toBeCloseTo(4800);
    expect(result.get(2)!.matchAnnual).toBeCloseTo(2400);
    expect(result.get(1)!.matchAnnual + result.get(2)!.matchAnnual).toBeCloseTo(
      7200,
    );
  });

  it("catches the case that would go wrong today: match config on the SMALLER-contributing sibling", () => {
    // Trad row (id 1) holds match config but only contributes $3000 (2.5%
    // of 120k) — well under the 6% cap on its own. Roth row (id 2)
    // contributes $12000 (10%) with no match config. The old per-row-only
    // computation would cap against row 1's own 2.5% (uncapped, since it's
    // below the 6% cap) and silently ignore row 2's $12000 entirely,
    // under-crediting match. The combined rate is 15000/120000 = 0.125,
    // correctly capped at 0.06.
    const rows = [
      makeRow({
        id: 1,
        annual: 3000,
        employerMatchType: "percent_of_contribution",
        employerMatchValue: 100,
        employerMaxMatchPct: 0.06,
      }),
      makeRow({ id: 2, annual: 12000 }),
    ];
    const result = computeGroupedEmployerMatch(rows);
    const totalMatch = result.get(1)!.matchAnnual + result.get(2)!.matchAnnual;
    // Correct: 120000 * 0.06 * 1.0 = 7200.
    // The old buggy per-row computation would have produced 120000 * 0.025
    // * 1.0 = 3000 — this assertion is the actual behavior change.
    expect(totalMatch).toBeCloseTo(7200);
  });

  it("throws when more than one row in a group carries real match config", () => {
    const rows = [
      makeRow({
        id: 1,
        annual: 12000,
        employerMatchType: "percent_of_contribution",
        employerMatchValue: 100,
        employerMaxMatchPct: 0.06,
      }),
      makeRow({
        id: 2,
        annual: 6000,
        employerMatchType: "percent_of_contribution",
        employerMatchValue: 50,
        employerMaxMatchPct: 0.03,
      }),
    ];
    expect(() => computeGroupedEmployerMatch(rows)).toThrow(
      /independently carry employer match config/,
    );
  });

  it("does not merge two concurrent jobs' same-accountType caps into one group", () => {
    // Same person, two different jobs, both offering a 401k with their own
    // (different) match config. Grouping by personId+accountType alone
    // would incorrectly combine these; grouping by resolved job must not.
    const rows = [
      makeRow({
        id: 1,
        jobId: 10,
        annual: 5000, // well under job 10's own cap
        salary: 100000,
        employerMatchType: "percent_of_contribution",
        employerMatchValue: 100,
        employerMaxMatchPct: 0.06,
      }),
      makeRow({
        id: 2,
        jobId: 20,
        annual: 6000, // well under job 20's own cap
        salary: 80000,
        employerMatchType: "percent_of_contribution",
        employerMatchValue: 100,
        employerMaxMatchPct: 0.08,
      }),
    ];
    const result = computeGroupedEmployerMatch(rows);
    // Job 10: 100000 * min(0.05, 0.06) * 1.0 = 5000
    expect(result.get(1)!.matchAnnual).toBeCloseTo(5000);
    // Job 20: 80000 * min(0.075, 0.08) * 1.0 = 6000
    expect(result.get(2)!.matchAnnual).toBeCloseTo(6000);
  });

  it("computes a flat dollar_match once per group, not once per row", () => {
    const rows = [
      makeRow({
        id: 1,
        annual: 12000,
        employerMatchType: "dollar_match",
        employerMatchValue: 3000,
      }),
      makeRow({ id: 2, annual: 6000 }),
    ];
    const result = computeGroupedEmployerMatch(rows);
    const totalMatch = result.get(1)!.matchAnnual + result.get(2)!.matchAnnual;
    expect(totalMatch).toBe(3000);
  });

  it("keeps rows with mismatched parentCategory in separate (unfixed, per-row) groups", () => {
    const rows = [
      makeRow({
        id: 1,
        annual: 3000,
        parentCategory: "Retirement",
        employerMatchType: "percent_of_contribution",
        employerMatchValue: 100,
        employerMaxMatchPct: 0.06,
      }),
      makeRow({ id: 2, annual: 12000, parentCategory: "Portfolio" }),
    ];
    const result = computeGroupedEmployerMatch(rows);
    // Not combined — row 1 capped against only its own 2.5% (uncapped).
    // 120000 * 0.025 * 1.0 = 3000, and row 2 gets nothing (no match config,
    // and it's in a different group so it never sees row 1's config).
    expect(result.get(1)!.matchAnnual).toBeCloseTo(3000);
    expect(result.get(2)!.matchAnnual).toBe(0);
  });

  it("gives every row in a group the winning row's employerMatchTaxTreatment, never its own", () => {
    const rows = [
      makeRow({
        id: 1,
        annual: 12000,
        employerMatchType: "percent_of_contribution",
        employerMatchValue: 100,
        employerMaxMatchPct: 0.06,
        employerMatchTaxTreatment: "tax_free", // e.g. a real Roth-match plan
      }),
      // Sibling's OWN field says pre_tax — must be overridden by the group's
      // winning config, since match tax character is a plan property.
      makeRow({ id: 2, annual: 6000, employerMatchTaxTreatment: "pre_tax" }),
    ];
    const result = computeGroupedEmployerMatch(rows);
    expect(result.get(1)!.employerMatchTaxTreatment).toBe("tax_free");
    expect(result.get(2)!.employerMatchTaxTreatment).toBe("tax_free");
  });

  it("throws when grouped rows resolve to different salaries", () => {
    const rows = [
      makeRow({
        id: 1,
        annual: 12000,
        salary: 120000,
        employerMatchType: "percent_of_contribution",
        employerMatchValue: 100,
        employerMaxMatchPct: 0.06,
      }),
      makeRow({ id: 2, annual: 6000, salary: 90000 }),
    ];
    expect(() => computeGroupedEmployerMatch(rows)).toThrow(
      /resolved to different salaries/,
    );
  });
});
