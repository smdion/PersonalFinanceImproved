/* eslint-disable no-restricted-syntax -- test rows stand in for full contribution_accounts rows; only the fields the helpers read */
/**
 * "Also taken from bonus checks" (fromBonus) across every contribution path
 * — the summary, the display specs, the projection's spec builder and the
 * What-If overlay — with one rule (takesFromBonusCheck): a payroll account
 * set to be taken from bonus checks. Fictional household: $100,000 salary,
 * $20,000 bonus, a 6% 401(k) matched 100% up to 4% of pay.
 */
import "./setup-mocks";
import { describe, it, expect } from "vitest";
import {
  aggregateContributionsByCategory,
  applyContribActiveFields,
  buildContributionDisplaySpecs,
  buildProfileContribData,
  type ContribRowWithActiveFields,
} from "@/server/helpers/contribution";
import type { AccountCategory } from "@/lib/calculators/types";

const SALARY = 100_000;
const BONUS = 20_000;

function k401(
  over: {
    fromBonus?: boolean;
    jobId?: number | null;
    isPayrollDeducted?: boolean | null;
  } = {},
) {
  return {
    id: 1,
    personId: 1,
    jobId: 1 as number | null,
    accountType: "401k" as AccountCategory,
    subType: null,
    label: null,
    parentCategory: "Retirement",
    contributionMethod: "percent_of_salary",
    contributionValue: "6",
    taxTreatment: "pre_tax",
    employerMatchType: "percent_of_contribution",
    employerMatchValue: "100",
    employerMaxMatchPct: "0.04",
    isPayrollDeducted: null as boolean | null,
    fromBonus: false as boolean | undefined,
    ...over,
  };
}
const jobs = [{ id: 1, personId: 1, payPeriod: "biweekly" }];
const pay = [
  { job: { id: 1, personId: 1 }, salary: SALARY, bonusGross: BONUS },
];

const summary = (row: ReturnType<typeof k401>) =>
  aggregateContributionsByCategory([row], jobs, pay);

describe("contribution summary (aggregateContributionsByCategory)", () => {
  it("taken from bonus checks: 6% of the bonus too, matched on salary + bonus", () => {
    const r = summary(k401({ fromBonus: true }));
    expect(r.contribByCategory["401k"].annual).toBeCloseTo(7_200, 2);
    expect(r.employerMatchByCategory["401k"]).toBeCloseTo(4_800, 2);
  });

  it("not taken: salary only, matched on salary", () => {
    const r = summary(k401({ fromBonus: false }));
    expect(r.contribByCategory["401k"].annual).toBeCloseTo(6_000, 2);
    expect(r.employerMatchByCategory["401k"]).toBeCloseTo(4_000, 2);
  });

  it("a payroll account with no job of its own uses the person's job", () => {
    const r = summary(
      k401({ fromBonus: true, jobId: null, isPayrollDeducted: true }),
    );
    expect(r.contribByCategory["401k"].annual).toBeCloseTo(7_200, 2);
    expect(r.employerMatchByCategory["401k"]).toBeCloseTo(4_800, 2);
  });

  it("an account not paid through payroll is never taken from a bonus check, set or not", () => {
    const r = summary(
      k401({ fromBonus: true, jobId: null, isPayrollDeducted: null }),
    );
    expect(r.contribByCategory["401k"].annual).toBeCloseTo(6_000, 2);
    expect(r.employerMatchByCategory["401k"]).toBeCloseTo(4_000, 2);
  });
});

describe("contribution lines (buildContributionDisplaySpecs)", () => {
  it("follows the same rule", () => {
    const people = [{ id: 1, name: "Alex" }];
    const on = buildContributionDisplaySpecs(
      [k401({ fromBonus: true })],
      people,
      jobs,
      pay,
    )[0]!;
    const off = buildContributionDisplaySpecs(
      [k401({ fromBonus: false })],
      people,
      jobs,
      pay,
    )[0]!;
    expect(on.baseAnnual).toBeCloseTo(7_200, 2);
    expect(on.matchAnnual).toBeCloseTo(4_800, 2);
    expect(off.baseAnnual).toBeCloseTo(6_000, 2);
    expect(off.matchAnnual).toBeCloseTo(4_000, 2);
  });
});

describe("projection specs (buildProfileContribData — profile switches use it too)", () => {
  const ctx = {
    perfCategoryMap: new Map<number, string>(),
    perfRetirementBehaviorMap: new Map<number, string>(),
    perfContributionScalingMap: new Map<number, string>(),
    personNameById: new Map([[1, "Alex"]]),
    accountBreakdownByCategory: {},
  };
  const build = (fromBonus: boolean) =>
    buildProfileContribData(
      [
        {
          ...k401({ fromBonus }),
          performanceAccountId: null,
          targetAnnual: null,
          allocationPriority: 0,
          ownership: "individual",
        },
      ],
      jobs,
      [{ ...pay[0]!, totalComp: SALARY + BONUS }],
      ctx,
    );

  it("a profile that takes the 401(k) from bonus checks contributes on salary + bonus", () => {
    const on = build(true);
    const off = build(false);
    expect(on.baseYearContributions["401k"]).toBeCloseTo(7_200, 2);
    expect(off.baseYearContributions["401k"]).toBeCloseTo(6_000, 2);
    expect(on.baseYearEmployerMatch["401k"]).toBeCloseTo(4_800, 2);
    expect(off.baseYearEmployerMatch["401k"]).toBeCloseTo(4_000, 2);
    // The share of pay the rate applies to grows with salary in the engine.
    expect(on.contributionSpecs[0]!.salaryFraction).toBeCloseTo(1, 6);
    expect(off.contributionSpecs[0]!.salaryFraction).toBeCloseTo(
      SALARY / (SALARY + BONUS),
      6,
    );
  });
});

describe("What-If overlay (applyContribActiveFields)", () => {
  const resolved = applyContribActiveFields(
    [k401() as unknown as Parameters<typeof applyContribActiveFields>[0][0]],
    {
      "1": {
        contributionValue: "6",
        contributionMethod: "percent_of_salary",
        fromBonus: true,
      },
    },
  ) as ContribRowWithActiveFields[];

  it("a sandbox edit that doesn't touch it keeps the profile's election", () => {
    const [row] = applyContribActiveFields(
      resolved,
      { "1": { contributionValue: "8" } },
      true,
    );
    expect(row!.fromBonus).toBe(true);
    expect(row!.contributionValue).toBe("8");
  });

  it("a sandbox edit can turn it off", () => {
    const [row] = applyContribActiveFields(
      resolved,
      { "1": { fromBonus: false } },
      true,
    );
    expect(row!.fromBonus).toBe(false);
  });
});
