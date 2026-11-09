/**
 * A payroll fixed_monthly / fixed_annual account taken from the bonus check
 * needs the job's real pay-period count to know its per-paycheck amount.
 * resolveContributionPeriods used to hand back 0 for those methods, so the
 * bonus share was regular / 0 = Infinity and the cap pass zeroed the account.
 */
import { describe, it, expect } from "vitest";
import {
  annualContributionWithBonus,
  contributionRowAmounts,
  resolveContribPeriods,
  type ContributionRow,
} from "@/lib/pure/contributions/contribution-rows";

const hsa = (method: string, value: number): ContributionRow => ({
  id: 1,
  personId: 1,
  jobId: 1,
  accountType: "hsa",
  subType: null,
  label: null,
  parentCategory: "Retirement",
  contributionMethod: method,
  contributionValue: value,
  taxTreatment: "tax_free",
  employerMatchType: "none",
  employerMatchValue: null,
  employerMaxMatchPct: null,
  isPayrollDeducted: true,
  fromBonus: true,
});

const jobs = [{ id: 1, personId: 1, payPeriod: "biweekly" }];
const pay = [
  {
    job: { id: 1, personId: 1 },
    salary: 100_000,
    bonusGross: 10_000,
  },
];

describe("fixed-monthly / fixed-annual accounts taken from the bonus check", () => {
  it("resolves the job's real pay periods for every method", () => {
    expect(
      resolveContribPeriods("fixed_monthly", { payPeriod: "biweekly" })
        .periodsPerYear,
    ).toBe(26);
    expect(
      resolveContribPeriods("fixed_monthly", { payPeriod: "biweekly" })
        .incomplete,
    ).toBe(false);
  });

  it("a $100/month HSA gives a finite annual: 12 months plus one paycheck's share", () => {
    const { annualById } = contributionRowAmounts(
      [hsa("fixed_monthly", 100)],
      jobs,
      pay,
    );
    const annual = annualById.get(1)!;
    expect(Number.isFinite(annual)).toBe(true);
    expect(annual).toBeCloseTo(1200 + 1200 / 26, 2);
  });

  it("a fixed-annual account likewise takes one paycheck's share from the bonus", () => {
    const { annualById } = contributionRowAmounts(
      [hsa("fixed_annual", 1200)],
      jobs,
      pay,
    );
    expect(annualById.get(1)!).toBeCloseTo(1200 + 1200 / 26, 2);
  });

  it("never divides by zero when no pay period is known", () => {
    const annual = annualContributionWithBonus(
      {
        contributionMethod: "fixed_monthly",
        contributionValue: 100,
        jobId: 1,
        fromBonus: true,
      },
      { salary: 100_000, bonusGross: 10_000 },
      0,
    );
    expect(annual).toBe(1200);
  });
});

// ---------------------------------------------------------------------------
// annualContributionWithBonus — the one yearly amount (the paycheck's way)
// ---------------------------------------------------------------------------

describe("annualContributionWithBonus", () => {
  const pct = (
    value: number,
    jobId: number | null = 1,
    fromBonus: boolean | undefined = true,
  ) => ({
    contributionMethod: "percent_of_salary",
    contributionValue: value,
    jobId,
    fromBonus,
  });

  it("takes the rate of the base salary when the bonus check carries nothing", () => {
    expect(annualContributionWithBonus(pct(10), { salary: 100_000 }, 26)).toBe(
      10_000,
    );
  });

  it("adds the rate of the bonus once when the account is taken from bonus checks", () => {
    // The bonus is never also part of the salary, so it can't be counted twice.
    expect(
      annualContributionWithBonus(
        pct(10),
        { salary: 100_000, bonusGross: 12_000 },
        26,
      ),
    ).toBe(11_200);
  });

  it("takes a fixed per-paycheck amount once more from the bonus check", () => {
    expect(
      annualContributionWithBonus(
        {
          contributionMethod: "fixed_per_period",
          contributionValue: 200,
          jobId: 1,
          fromBonus: true,
        },
        { salary: 100_000, bonusGross: 12_000 },
        26,
      ),
    ).toBe(200 * 27);
  });

  it("takes nothing from the bonus unless the account is set to (fromBonus)", () => {
    for (const fromBonus of [false, undefined]) {
      expect(
        annualContributionWithBonus(
          { ...pct(10), fromBonus },
          { salary: 100_000, bonusGross: 12_000 },
          26,
        ),
      ).toBe(10_000);
    }
  });

  it("takes nothing from the bonus for an account not paid through payroll", () => {
    expect(
      annualContributionWithBonus(
        pct(10, null),
        { salary: 100_000, bonusGross: 12_000 },
        26,
      ),
    ).toBe(10_000);
  });
});
