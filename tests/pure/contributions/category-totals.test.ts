import { describe, it, expect } from "vitest";
import { aggregateContributionsByCategory } from "@/lib/pure/contributions/category-totals";
import type { AccountCategory } from "@/lib/config/account-types";
import {
  makeContribRow,
  makeJob,
  makeJobSalary,
} from "../../fixtures/contribution-rows";

// ---------------------------------------------------------------------------
// aggregateContributionsByCategory
// ---------------------------------------------------------------------------

describe("aggregateContributionsByCategory", () => {
  it("aggregates a single 401k contribution", () => {
    const contribs = [makeContribRow()];
    const jobs = [makeJob()];
    const salaries = [makeJobSalary()];

    const { contribByCategory, employerMatchByCategory } =
      aggregateContributionsByCategory(contribs, jobs, salaries);

    // 10% of 120000 = 12000
    expect(contribByCategory["401k"].annual).toBe(12000);
    expect(contribByCategory["401k"].tradAnnual).toBe(12000);
    expect(contribByCategory["401k"].rothAnnual).toBe(0);
    expect(contribByCategory["401k"].rothFraction).toBe(0);
    expect(employerMatchByCategory["401k"]).toBe(0);
  });

  it("computes Roth fraction correctly", () => {
    const contribs = [
      makeContribRow({
        id: 1,
        contributionValue: "8",
        taxTreatment: "pre_tax",
      }),
      makeContribRow({
        id: 2,
        contributionValue: "4",
        taxTreatment: "tax_free",
      }),
    ];
    const jobs = [makeJob()];
    const salaries = [makeJobSalary()];

    const { contribByCategory } = aggregateContributionsByCategory(
      contribs,
      jobs,
      salaries,
    );

    // Pre-tax: 8% of 120k = 9600, Roth: 4% of 120k = 4800
    // Roth fraction = 4800 / (9600 + 4800) = 0.333...
    expect(contribByCategory["401k"].annual).toBeCloseTo(14400);
    expect(contribByCategory["401k"].rothFraction).toBeCloseTo(1 / 3);
  });

  it("includes employer match by category", () => {
    const contribs = [
      makeContribRow({
        employerMatchType: "percent_of_contribution",
        employerMatchValue: "100",
        employerMaxMatchPct: "0.06",
      }),
    ];
    const jobs = [makeJob()];
    const salaries = [makeJobSalary()];

    const { employerMatchByCategory } = aggregateContributionsByCategory(
      contribs,
      jobs,
      salaries,
    );

    // Match: 120000 × min(0.10, 0.06) × 1.0 = 7200
    expect(employerMatchByCategory["401k"]).toBe(7200);
  });

  it("aggregates across multiple categories", () => {
    const contribs = [
      makeContribRow({
        id: 1,
        accountType: "401k" as AccountCategory,
        contributionValue: "10",
      }),
      makeContribRow({
        id: 2,
        accountType: "ira" as AccountCategory,
        contributionValue: "5",
        taxTreatment: "tax_free",
      }),
      makeContribRow({
        id: 3,
        accountType: "hsa" as AccountCategory,
        contributionMethod: "fixed_annual",
        contributionValue: "4300",
      }),
    ];
    const jobs = [makeJob()];
    const salaries = [makeJobSalary()];

    const { contribByCategory } = aggregateContributionsByCategory(
      contribs,
      jobs,
      salaries,
    );

    expect(contribByCategory["401k"].annual).toBe(12000);
    expect(contribByCategory["ira"].annual).toBe(6000);
    expect(contribByCategory["hsa"].annual).toBe(4300);
  });

  it("handles zero salary gracefully", () => {
    const contribs = [makeContribRow()];
    const jobs = [makeJob()];
    const salaries = [makeJobSalary(1, 1, 0)];

    const { contribByCategory } = aggregateContributionsByCategory(
      contribs,
      jobs,
      salaries,
    );

    expect(contribByCategory["401k"].annual).toBe(0);
  });

  it("tracks employer match by parent category", () => {
    const contribs = [
      makeContribRow({
        parentCategory: "Retirement — Employer",
        employerMatchType: "dollar_match",
        employerMatchValue: "5000",
      }),
    ];
    const jobs = [makeJob()];
    const salaries = [makeJobSalary()];

    const { employerMatchByParentCat } = aggregateContributionsByCategory(
      contribs,
      jobs,
      salaries,
    );

    const catMap = employerMatchByParentCat.get("401k" as AccountCategory);
    expect(catMap).toBeDefined();
    expect(catMap!.get("Retirement — Employer")).toBe(5000);
  });

  it("falls back to person's first job when jobId is null", () => {
    const contribs = [makeContribRow({ jobId: null, personId: 2 })];
    const jobs = [makeJob(10, 2, "monthly")];
    const salaries = [makeJobSalary(10, 2, 100000)];

    const { contribByCategory } = aggregateContributionsByCategory(
      contribs,
      jobs,
      salaries,
    );

    // 10% of 100000 = 10000
    expect(contribByCategory["401k"].annual).toBe(10000);
  });

  it("marks a fixed_per_period account incomplete and excludes it when its job can't be resolved (method-gated treatment)", () => {
    const contribs = [
      makeContribRow({
        id: 1,
        jobId: 99, // no job with this id in `jobs` below — ended/missing link
        contributionMethod: "fixed_per_period",
        contributionValue: "500",
      }),
    ];
    const jobs = [makeJob(1, 1, "biweekly")]; // a different, unrelated job
    const salaries = [makeJobSalary(1, 1, 120000)];

    const { contribByCategory, incompleteAccountIds } =
      aggregateContributionsByCategory(contribs, jobs, salaries);

    expect(incompleteAccountIds).toEqual([1]);
    // Excluded from the total (0), not defaulted to a guessed pay period.
    expect(contribByCategory["401k"].annual).toBe(0);
  });

  it("does NOT mark percent_of_salary/fixed_monthly accounts incomplete for the same missing-job scenario", () => {
    const contribs = [
      makeContribRow({
        id: 1,
        jobId: 99,
        contributionMethod: "percent_of_salary",
        contributionValue: "10",
      }),
      makeContribRow({
        id: 2,
        jobId: 99,
        contributionMethod: "fixed_monthly",
        contributionValue: "200",
      }),
    ];
    const jobs = [makeJob(1, 1, "biweekly")];
    const salaries = [makeJobSalary(1, 1, 120000)];

    const { incompleteAccountIds } = aggregateContributionsByCategory(
      contribs,
      jobs,
      salaries,
    );

    expect(incompleteAccountIds).toEqual([]);
  });
});
