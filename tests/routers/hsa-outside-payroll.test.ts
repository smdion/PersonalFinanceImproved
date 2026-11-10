/**
 * HSA money paid in outside payroll comes off AGI on the Taxes page
 * (Schedule 1 line 13), so the figure the tax reads must already respect
 * the § 223(b) limit less the person's payroll HSA money: an over-limit
 * entry must not lower the tax. Invented household, 2026 tables (self-only
 * limit 4,400, Rev. Proc. 2025-19), the clock held in 2026.
 */
import "./setup-mocks";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createTestCaller,
  seedContributionAccount,
  seedContributionProfile,
  seedJob,
  seedPerson,
} from "./setup";

const NOW = new Date("2026-08-14T12:00:00");
const SELF_ONLY_LIMIT = 4_400;

describe("HSA money paid outside payroll, over the § 223(b) limit", () => {
  let ctx: Awaited<ReturnType<typeof createTestCaller>>;
  let profileId = 0;
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    ctx = await createTestCaller();
    const personId = await seedPerson(ctx.db, "Example Saver", "1985-03-01");
    const jobId = seedJob(ctx.db, personId, {
      employerName: "Example Co",
      annualSalary: "104000",
      payPeriod: "biweekly",
      payWeek: "even",
      startDate: "2020-01-01",
      w4FilingStatus: "Single",
    });
    const hsa = {
      personId,
      accountType: "hsa",
      parentCategory: "Retirement",
      taxTreatment: "hsa",
      hsaCoverageType: "self_only",
    } as const;
    const payroll = seedContributionAccount(ctx.db, {
      ...hsa,
      jobId,
      isPayrollDeducted: true,
    });
    const outside = seedContributionAccount(ctx.db, {
      ...hsa,
      jobId: null,
      isPayrollDeducted: false,
    });
    // 3,000 through payroll and 4,400 paid in directly: 7,400 asked for.
    profileId = seedContributionProfile(ctx.db, {
      name: "Over the HSA limit",
      contributionActiveFields: {
        contributionAccounts: {
          [String(payroll)]: {
            contributionValue: "3000",
            contributionMethod: "fixed_annual",
          },
          [String(outside)]: {
            contributionValue: "4400",
            contributionMethod: "fixed_annual",
          },
        },
        deductions: {},
      },
    });
    await ctx.caller.settings.appSettings.upsert({
      key: "tax_filing_status",
      value: "Single",
    });
  });
  afterAll(() => {
    ctx.cleanup();
    vi.useRealTimers();
  });

  it("the deducted amount is at most the limit less the payroll HSA money", async () => {
    const s = await ctx.caller.paycheck.computeSummary({
      contributionProfileId: profileId,
      taxYearOverride: 2026,
    });
    const income = s.householdIncome!;
    // The payroll HSA is the job's only pre-tax money.
    expect(income.hsaOutsidePayroll).toBeGreaterThan(0);
    expect(income.preTaxFederal + income.hsaOutsidePayroll).toBeLessThanOrEqual(
      SELF_ONLY_LIMIT + 0.01,
    );
    expect(s.householdTax!.wageAgi).toBeCloseTo(
      income.federalWages - income.hsaOutsidePayroll,
      2,
    );
  });
});
