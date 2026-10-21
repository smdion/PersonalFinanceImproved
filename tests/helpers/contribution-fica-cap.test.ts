/**
 * buildContribAccounts sizes each payroll account's FICA-exempt cap from the
 * real account-type config: HSA payroll money (§125) is exempt up to the IRS
 * limit for the coverage and age, less employer money; 401(k) deferrals and
 * money paid in outside payroll are FICA wages.
 */
import "./setup-mocks";
import { describe, it, expect } from "vitest";
import { buildContribAccounts } from "@/server/helpers/contribution";
import type { ContribRowWithActiveFields } from "@/server/helpers/contribution";

const limits = {
  hsa_individual_limit: 4000,
  hsa_family_limit: 8000,
  hsa_catchup_limit: 1000,
  "401k_employee_limit": 20000,
};

function row(
  overrides: Partial<Record<string, unknown>>,
): ContribRowWithActiveFields {
  return {
    id: 1,
    personId: 1,
    jobId: 10,
    accountType: "hsa",
    parentCategory: "portfolio",
    contributionMethod: "fixed_per_period",
    contributionValue: 200,
    employerMatchType: "fixed_annual",
    employerMatchValue: 600,
    employerMaxMatchPct: null,
    employerMatchTaxTreatment: "pre_tax",
    hsaCoverageType: "family",
    isRoth: false,
    accountLabel: "HSA",
    ...overrides,
    // eslint-disable-next-line no-restricted-syntax -- test-only stub; only the fields the builder reads
  } as unknown as ContribRowWithActiveFields;
}

const build = (r: ContribRowWithActiveFields, ageAtYearEnd = 40) =>
  buildContribAccounts([r], [], 100000, 26, { limits, ageAtYearEnd })[0]!;

describe("buildContribAccounts — ficaExemptAnnualCap", () => {
  it("payroll HSA: coverage limit less employer money", () => {
    expect(build(row({})).ficaExemptAnnualCap).toBe(8000 - 600);
  });

  it("follows the coverage and age", () => {
    expect(
      build(row({ hsaCoverageType: "self_only" }), 56).ficaExemptAnnualCap,
    ).toBe(4000 + 1000 - 600);
  });

  it("HSA paid outside payroll has no cap (it isn't on the paycheck)", () => {
    expect(build(row({ jobId: null })).ficaExemptAnnualCap).toBeNull();
    expect(
      build(row({ isPayrollDeducted: false })).ficaExemptAnnualCap,
    ).toBeNull();
  });

  it("401(k) deferrals are FICA wages", () => {
    expect(
      build(
        row({
          accountType: "401k",
          parentCategory: "retirement",
          hsaCoverageType: null,
          employerMatchType: "none",
        }),
      ).ficaExemptAnnualCap,
    ).toBeNull();
  });
});

describe("buildContribAccounts — employer match on bonus checks", () => {
  // 6% deferral, 100% match up to 4% of pay. $100,000 salary, $20,000 bonus.
  const k401 = (fromBonus: boolean) =>
    row({
      accountType: "401k",
      parentCategory: "Retirement",
      contributionMethod: "percent_of_salary",
      contributionValue: 6,
      employerMatchType: "percent_of_contribution",
      employerMatchValue: 100,
      employerMaxMatchPct: 0.04,
      hsaCoverageType: null,
      fromBonus,
    });
  const buildWithBonus = (r: ContribRowWithActiveFields) =>
    buildContribAccounts(
      [r],
      [],
      100000,
      26,
      { limits, ageAtYearEnd: 40 },
      20000,
    )[0]!;

  it("taken from bonus checks: the bonus check's deferral and its match count", () => {
    const a = buildWithBonus(k401(true));
    expect(a.fromBonus).toBe(true);
    // Match cap 4% of $120,000 pay.
    expect(a.employerMatch).toBeCloseTo(4800, 2);
    expect(a.employerMatchOnBonus).toBeCloseTo(800, 2);
  });

  it("not taken from bonus checks: the match is on base salary alone", () => {
    const a = buildWithBonus(k401(false));
    expect(a.fromBonus).toBe(false);
    expect(a.employerMatch).toBeCloseTo(4000, 2);
    expect(a.employerMatchOnBonus).toBe(0);
  });
});
