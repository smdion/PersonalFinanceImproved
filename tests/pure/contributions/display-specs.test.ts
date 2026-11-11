import { describe, it, expect } from "vitest";
import { buildContributionDisplaySpecs } from "@/lib/pure/contributions/display-specs";
import {
  makeContribRow,
  makeJob,
  makeJobSalary,
} from "../../fixtures/contribution-rows";

// ---------------------------------------------------------------------------
// buildContributionDisplaySpecs
// ---------------------------------------------------------------------------

describe("buildContributionDisplaySpecs", () => {
  it("builds specs from contribution rows", () => {
    const contribs = [makeContribRow({ contributionValue: "10" })];
    const people = [{ id: 1, name: "Alice" }];
    const jobs = [makeJob()];
    const salaries = [{ ...makeJobSalary(), totalComp: 120000 }];

    // Need full JobSalaryRef shape
    const jobSalaryRefs = salaries.map((s) => ({
      job: { id: s.job.id, personId: s.job.personId },
      salary: s.salary,
    }));

    const specs = buildContributionDisplaySpecs(
      contribs,
      people,
      jobs,
      jobSalaryRefs,
    );

    expect(specs).toHaveLength(1);
    expect(specs[0]!.category).toBe("401k");
    expect(specs[0]!.baseAnnual).toBe(12000);
    expect(specs[0]!.ownerName).toBe("Alice");
    expect(specs[0]!.personId).toBe(1);
  });

  it("filters out zero-value contributions", () => {
    const contribs = [makeContribRow({ contributionValue: "0" })];
    const specs = buildContributionDisplaySpecs(
      contribs,
      [{ id: 1, name: "Alice" }],
      [makeJob()],
      [makeJobSalary()],
    );
    expect(specs).toHaveLength(0);
  });

  it("redistributes match proportionally within person+category group", () => {
    // Only one of the two sibling rows carries real match config — the
    // schema/computeGroupedEmployerMatch invariant (at most one row per
    // job/person + accountType + parentCategory group may have real
    // config; two independently-configured siblings is a data-integrity
    // error, covered separately below).
    const contribs = [
      makeContribRow({
        id: 1,
        contributionValue: "10", // 12000
        taxTreatment: "pre_tax",
        employerMatchType: "percent_of_contribution" as const,
        employerMatchValue: "100",
        employerMaxMatchPct: "0.06",
      }),
      makeContribRow({
        id: 2,
        contributionValue: "5", // 6000
        taxTreatment: "tax_free",
      }),
    ];
    const people = [{ id: 1, name: "Alice" }];
    const jobs = [makeJob()];
    const salaries = [makeJobSalary()];

    const specs = buildContributionDisplaySpecs(
      contribs,
      people,
      jobs,
      salaries,
    );

    expect(specs).toHaveLength(2);
    // Combined rate = 18000/120000 = 0.15, capped at 0.06 -> total match
    // = 120000 * 0.06 * 1.0 = 7200, split 2:1 by contribution share.
    const totalMatch = specs.reduce((s, sp) => s + sp.matchAnnual, 0);
    expect(totalMatch).toBeCloseTo(7200);
    // Pre-tax has 2x the contribution, so should get 2x the match
    expect(specs[0]!.matchAnnual).toBeCloseTo(specs[1]!.matchAnnual * 2, 0);
  });

  it("throws when two sibling rows both carry real match config", () => {
    const contribs = [
      makeContribRow({
        id: 1,
        contributionValue: "10",
        employerMatchType: "percent_of_contribution" as const,
        employerMatchValue: "100",
        employerMaxMatchPct: "0.06",
      }),
      makeContribRow({
        id: 2,
        contributionValue: "5",
        taxTreatment: "tax_free",
        employerMatchType: "percent_of_contribution" as const,
        employerMatchValue: "100",
        employerMaxMatchPct: "0.06",
      }),
    ];
    expect(() =>
      buildContributionDisplaySpecs(
        contribs,
        [{ id: 1, name: "Alice" }],
        [makeJob()],
        [makeJobSalary()],
      ),
    ).toThrow(/independently carry employer match config/);
  });
});
