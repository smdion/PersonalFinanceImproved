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
    include401kInBonus: false,
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
