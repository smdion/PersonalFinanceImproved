/**
 * A payroll fixed_monthly / fixed_annual account taken from the bonus check
 * needs the job's real pay-period count to know its per-paycheck amount.
 * resolveContribPeriods used to hand back 0 for those methods, so the
 * bonus share was regular / 0 = Infinity and the cap pass zeroed the account.
 */
import "./setup-mocks";
import { describe, it, expect } from "vitest";
import {
  annualContributionWithBonus,
  contribRowAmounts,
  resolveContribPeriods,
  type ContribRow,
} from "@/lib/pure/contributions/contribution-rows";

const hsa = (method: string, value: number): ContribRow => ({
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
    const { annualById } = contribRowAmounts(
      [hsa("fixed_monthly", 100)],
      jobs,
      pay,
    );
    const annual = annualById.get(1)!;
    expect(Number.isFinite(annual)).toBe(true);
    expect(annual).toBeCloseTo(1200 + 1200 / 26, 2);
  });

  it("a fixed-annual account likewise takes one paycheck's share from the bonus", () => {
    const { annualById } = contribRowAmounts(
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
