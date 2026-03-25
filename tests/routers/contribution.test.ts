/**
 * Contribution router integration tests.
 *
 * Tests the contribution computation pipeline with various data states.
 */
import "./setup-mocks";
import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createTestCaller,
  seedPerson,
  seedJob,
  seedPerformanceAccount,
  seedContributionProfile,
  viewerSession,
} from "./setup";
import * as schema from "@/lib/db/schema-sqlite";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

vi.mock("@/lib/budget-api", () => ({
  getActiveBudgetApi: vi.fn().mockResolvedValue("none"),
  cacheGet: vi.fn().mockResolvedValue(null),
  getClientForService: vi.fn().mockResolvedValue(null),
}));

type TestDb = BetterSQLite3Database<typeof schema>;

/** Insert a contribution account directly using correct schema column names. */
function insertContribAccount(
  db: TestDb,
  overrides: Partial<typeof schema.contributionAccounts.$inferInsert> & {
    personId: number;
    accountType: string;
  },
): number {
  const result = db
    .insert(schema.contributionAccounts)
    .values({
      contributionMethod: "percent_of_salary",
      contributionValue: "10",
      taxTreatment: "pre_tax",
      employerMatchType: "none",
      parentCategory: "Retirement",
      isActive: true,
      ownership: "individual",
      priorYearContribAmount: "0",
      ...overrides,
    })
    .returning({ id: schema.contributionAccounts.id })
    .get();
  return result.id;
}

describe("contribution router", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: TestDb;
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;
  });

  afterAll(() => cleanup());

  describe("computeSummary — empty state", () => {
    it("returns empty when no people exist", async () => {
      const result = await caller.contribution.computeSummary();
      expect(result).toBeDefined();
      expect(result.people).toEqual([]);
      expect(result.limits).toBeDefined();
      expect(result.jointAccountTypes).toEqual([]);
      expect(result.jointTotals).toEqual({
        totalWithoutMatch: 0,
        totalWithMatch: 0,
      });
    });
  });

  describe("computeSummary — person without job", () => {
    let personId: number;

    beforeAll(async () => {
      personId = await seedPerson(db, "No-Job Person", "1985-06-15");
    });

    it("returns person with zero salary and empty accounts", async () => {
      const result = await caller.contribution.computeSummary();
      const person = result.people.find((p) => p.person.id === personId);
      expect(person).toBeDefined();
      expect(person!.salary).toBe(0);
      expect(person!.accountTypes).toEqual([]);
      expect(person!.perContribData).toEqual([]);
      expect(person!.result).toBeNull();
      expect(person!.totals).toEqual({
        retirementWithoutMatch: 0,
        retirementWithMatch: 0,
        portfolioWithoutMatch: 0,
        portfolioWithMatch: 0,
        totalWithoutMatch: 0,
        totalWithMatch: 0,
      });
    });
  });

  describe("computeSummary — person with job, no contributions", () => {
    let personId: number;

    beforeAll(async () => {
      personId = await seedPerson(db, "Job-No-Contrib", "1988-03-10");
      seedJob(db, personId, { annualSalary: "100000" });
    });

    it("returns person with salary but empty account types", async () => {
      const result = await caller.contribution.computeSummary();
      const person = result.people.find((p) => p.person.id === personId);
      expect(person).toBeDefined();
      expect(person!.salary).toBe(100000);
      expect(person!.accountTypes).toEqual([]);
      expect(person!.perContribData).toEqual([]);
      expect(person!.totals.totalWithoutMatch).toBe(0);
      expect(person!.totals.totalWithMatch).toBe(0);
    });

    it("returns periodsPerYear based on pay period", async () => {
      const result = await caller.contribution.computeSummary();
      const person = result.people.find((p) => p.person.id === personId);
      // biweekly = 26 periods
      expect(person!.periodsPerYear).toBe(26);
    });
  });

  describe("computeSummary — 401k contribution (percent_of_salary)", () => {
    let personId: number;
    let jobId: number;

    beforeAll(async () => {
      personId = await seedPerson(db, "401k-Pct", "1990-01-01");
      jobId = seedJob(db, personId, { annualSalary: "120000" });
      insertContribAccount(db, {
        personId,
        jobId,
        accountType: "401k",
        contributionMethod: "percent_of_salary",
        contributionValue: "10",
        taxTreatment: "pre_tax",
        employerMatchType: "none",
        parentCategory: "Retirement",
      });
    });

    it("computes annual contribution as percentage of salary", async () => {
      const result = await caller.contribution.computeSummary();
      const person = result.people.find((p) => p.person.id === personId);
      expect(person).toBeDefined();
      // 10% of 120000 = 12000
      const acctType = person!.accountTypes.find((a) => a.colorKey === "401k");
      expect(acctType).toBeDefined();
      expect(acctType!.employeeContrib).toBe(12000);
      expect(acctType!.parentCategory).toBe("Retirement");
      expect(acctType!.tradContrib).toBe(12000);
      expect(acctType!.taxFreeContrib).toBe(0);
    });

    it("computes IRS limit and funding percentage", async () => {
      const result = await caller.contribution.computeSummary();
      const person = result.people.find((p) => p.person.id === personId);
      const acctType = person!.accountTypes.find((a) => a.colorKey === "401k");
      expect(acctType).toBeDefined();
      // 2026 limit is 24500
      expect(acctType!.limit).toBe(24500);
      // fundingPct = 12000 / 24500
      expect(acctType!.fundingPct).toBeCloseTo(12000 / 24500, 4);
      expect(acctType!.fundingMissing).toBe(24500 - 12000);
    });

    it("computes pctOfSalaryToMax", async () => {
      const result = await caller.contribution.computeSummary();
      const person = result.people.find((p) => p.person.id === personId);
      const acctType = person!.accountTypes.find((a) => a.colorKey === "401k");
      expect(acctType).toBeDefined();
      // missing = 24500 - 12000 = 12500
      // pctOfSalaryToMax = (12500 / 120000) * 100 = 10.42 (rounded)
      expect(acctType!.pctOfSalaryToMax).toBeGreaterThan(0);
      expect(acctType!.currentPctOfSalary).toBeCloseTo(10, 1);
    });

    it("includes perContribData for each raw contribution", async () => {
      const result = await caller.contribution.computeSummary();
      const person = result.people.find((p) => p.person.id === personId);
      expect(person!.perContribData.length).toBeGreaterThanOrEqual(1);
      const pcd = person!.perContribData[0]!;
      expect(pcd.annualAmount).toBe(12000);
      expect(pcd.limit).toBe(24500);
      expect(pcd.limitGroup).toBe("401k");
    });

    it("computes retirement totals correctly", async () => {
      const result = await caller.contribution.computeSummary();
      const person = result.people.find((p) => p.person.id === personId);
      expect(person!.totals.retirementWithoutMatch).toBe(12000);
      expect(person!.totals.retirementWithMatch).toBe(12000);
      expect(person!.totals.portfolioWithoutMatch).toBe(0);
      expect(person!.totals.totalWithoutMatch).toBe(12000);
    });
  });

  describe("computeSummary — 401k with employer match", () => {
    let personId: number;
    let jobId: number;

    beforeAll(async () => {
      personId = await seedPerson(db, "401k-Match", "1990-05-20");
      jobId = seedJob(db, personId, { annualSalary: "100000" });
      insertContribAccount(db, {
        personId,
        jobId,
        accountType: "401k",
        contributionMethod: "percent_of_salary",
        contributionValue: "6",
        taxTreatment: "pre_tax",
        employerMatchType: "percent_of_contribution",
        employerMatchValue: "50",
        employerMaxMatchPct: "0.06",
        parentCategory: "Retirement",
      });
    });

    it("computes employer match amount", async () => {
      const result = await caller.contribution.computeSummary();
      const person = result.people.find((p) => p.person.id === personId);
      expect(person).toBeDefined();
      const acctType = person!.accountTypes.find((a) => a.colorKey === "401k");
      expect(acctType).toBeDefined();
      // 6% of 100000 = 6000 employee
      expect(acctType!.employeeContrib).toBe(6000);
      // Match: 50% of first 6% = 50% of 6000 = 3000
      expect(acctType!.employerMatch).toBe(3000);
      expect(acctType!.totalContrib).toBe(9000);
    });

    it("includes match in retirementWithMatch total", async () => {
      const result = await caller.contribution.computeSummary();
      const person = result.people.find((p) => p.person.id === personId);
      expect(person!.totals.retirementWithoutMatch).toBe(6000);
      expect(person!.totals.retirementWithMatch).toBe(9000);
    });
  });

  describe("computeSummary — Roth 401k (tax_free treatment)", () => {
    let personId: number;
    let jobId: number;

    beforeAll(async () => {
      personId = await seedPerson(db, "Roth-401k", "1992-08-15");
      jobId = seedJob(db, personId, { annualSalary: "80000" });
      insertContribAccount(db, {
        personId,
        jobId,
        accountType: "401k",
        contributionMethod: "percent_of_salary",
        contributionValue: "5",
        taxTreatment: "tax_free",
        employerMatchType: "none",
        parentCategory: "Retirement",
      });
    });

    it("classifies Roth contribution as taxFreeContrib", async () => {
      const result = await caller.contribution.computeSummary();
      const person = result.people.find((p) => p.person.id === personId);
      const acctType = person!.accountTypes.find((a) => a.colorKey === "401k");
      expect(acctType).toBeDefined();
      // 5% of 80000 = 4000
      expect(acctType!.taxFreeContrib).toBe(4000);
      expect(acctType!.tradContrib).toBe(0);
    });
  });

  describe("computeSummary — fixed_per_period contribution method", () => {
    let personId: number;

    beforeAll(async () => {
      personId = await seedPerson(db, "Fixed-Period", "1985-02-28");
      const jobId = seedJob(db, personId, {
        annualSalary: "90000",
        payPeriod: "biweekly",
      });
      insertContribAccount(db, {
        personId,
        jobId,
        accountType: "401k",
        contributionMethod: "fixed_per_period",
        contributionValue: "500",
        taxTreatment: "pre_tax",
        employerMatchType: "none",
        parentCategory: "Retirement",
      });
    });

    it("computes annual contribution as value * periodsPerYear", async () => {
      const result = await caller.contribution.computeSummary();
      const person = result.people.find((p) => p.person.id === personId);
      const acctType = person!.accountTypes.find((a) => a.colorKey === "401k");
      expect(acctType).toBeDefined();
      // 500 per period * 26 periods = 13000
      expect(acctType!.employeeContrib).toBe(13000);
    });
  });

  describe("computeSummary — fixed_annual contribution method", () => {
    let personId: number;

    beforeAll(async () => {
      personId = await seedPerson(db, "Fixed-Annual", "1980-11-05");
      const jobId = seedJob(db, personId, { annualSalary: "150000" });
      insertContribAccount(db, {
        personId,
        jobId,
        accountType: "401k",
        contributionMethod: "fixed_annual",
        contributionValue: "20000",
        taxTreatment: "pre_tax",
        employerMatchType: "none",
        parentCategory: "Retirement",
      });
    });

    it("uses fixed annual value directly", async () => {
      const result = await caller.contribution.computeSummary();
      const person = result.people.find((p) => p.person.id === personId);
      const acctType = person!.accountTypes.find((a) => a.colorKey === "401k");
      expect(acctType).toBeDefined();
      expect(acctType!.employeeContrib).toBe(20000);
    });
  });

  describe("computeSummary — IRA contribution", () => {
    let personId: number;

    beforeAll(async () => {
      personId = await seedPerson(db, "IRA-Person", "1987-04-12");
      seedJob(db, personId, { annualSalary: "100000" });
      // IRA is a personal (non-job) contribution
      insertContribAccount(db, {
        personId,
        jobId: null,
        accountType: "ira",
        contributionMethod: "fixed_annual",
        contributionValue: "7000",
        taxTreatment: "tax_free",
        employerMatchType: "none",
        parentCategory: "Retirement",
      });
    });

    it("includes IRA in account types with IRS limit", async () => {
      const result = await caller.contribution.computeSummary();
      const person = result.people.find((p) => p.person.id === personId);
      const iraAcct = person!.accountTypes.find((a) => a.colorKey === "ira");
      expect(iraAcct).toBeDefined();
      expect(iraAcct!.employeeContrib).toBe(7000);
      // 2026 IRA limit = 7500
      expect(iraAcct!.limit).toBe(7500);
      expect(iraAcct!.taxFreeContrib).toBe(7000);
    });

    it("includes IRA in perContribData", async () => {
      const result = await caller.contribution.computeSummary();
      const person = result.people.find((p) => p.person.id === personId);
      const iraPcd = person!.perContribData.find(
        (pcd) => pcd.limitGroup === "ira",
      );
      expect(iraPcd).toBeDefined();
      expect(iraPcd!.annualAmount).toBe(7000);
      expect(iraPcd!.limit).toBe(7500);
    });
  });

  describe("computeSummary — HSA contribution with coverage type", () => {
    let personId: number;

    beforeAll(async () => {
      personId = await seedPerson(db, "HSA-Family", "1983-07-20");
      const jobId = seedJob(db, personId, { annualSalary: "110000" });
      insertContribAccount(db, {
        personId,
        jobId,
        accountType: "hsa",
        contributionMethod: "fixed_annual",
        contributionValue: "7000",
        taxTreatment: "tax_free",
        employerMatchType: "fixed_annual",
        employerMatchValue: "1000",
        hsaCoverageType: "family",
        parentCategory: "Retirement",
      });
    });

    it("resolves family HSA limit", async () => {
      const result = await caller.contribution.computeSummary();
      const person = result.people.find((p) => p.person.id === personId);
      const hsaAcct = person!.accountTypes.find((a) => a.colorKey === "hsa");
      expect(hsaAcct).toBeDefined();
      // 2026 family HSA limit = 8750
      expect(hsaAcct!.limit).toBe(8750);
      expect(hsaAcct!.employeeContrib).toBe(7000);
      expect(hsaAcct!.employerMatch).toBe(1000);
    });
  });

  describe("computeSummary — brokerage (overflow target) contribution", () => {
    let personId: number;
    let perfAcctId: number;

    beforeAll(async () => {
      personId = await seedPerson(db, "Brokerage-Person", "1991-09-01");
      seedJob(db, personId, { annualSalary: "130000" });
      perfAcctId = seedPerformanceAccount(db, {
        name: "Brokerage",
        institution: "Vanguard",
        accountType: "brokerage",
        parentCategory: "Portfolio",
        accountLabel: "Vanguard Long Term Brokerage",
      });
      insertContribAccount(db, {
        personId,
        jobId: null,
        accountType: "brokerage",
        contributionMethod: "fixed_monthly",
        contributionValue: "1000",
        taxTreatment: "taxable",
        employerMatchType: "none",
        parentCategory: "Portfolio",
        performanceAccountId: perfAcctId,
      });
    });

    it("computes brokerage contribution as fixed_monthly * 12", async () => {
      const result = await caller.contribution.computeSummary();
      const person = result.people.find((p) => p.person.id === personId);
      // Brokerage is overflow target — display name comes from perf account
      const brokAcct = person!.accountTypes.find(
        (a) => a.parentCategory === "Portfolio",
      );
      expect(brokAcct).toBeDefined();
      // 1000 * 12 = 12000
      expect(brokAcct!.employeeContrib).toBe(12000);
      expect(brokAcct!.limit).toBe(0); // no IRS limit
    });

    it("includes portfolio totals", async () => {
      const result = await caller.contribution.computeSummary();
      const person = result.people.find((p) => p.person.id === personId);
      expect(person!.totals.portfolioWithoutMatch).toBe(12000);
      expect(person!.totals.portfolioWithMatch).toBe(12000);
    });
  });

  describe("computeSummary — multiple account types for same person", () => {
    let personId: number;

    beforeAll(async () => {
      personId = await seedPerson(db, "Multi-Acct", "1988-12-25");
      const jobId = seedJob(db, personId, { annualSalary: "150000" });
      // 401k
      insertContribAccount(db, {
        personId,
        jobId,
        accountType: "401k",
        contributionMethod: "percent_of_salary",
        contributionValue: "15",
        taxTreatment: "pre_tax",
        employerMatchType: "percent_of_contribution",
        employerMatchValue: "100",
        employerMaxMatchPct: "0.03",
        parentCategory: "Retirement",
      });
      // IRA
      insertContribAccount(db, {
        personId,
        jobId: null,
        accountType: "ira",
        contributionMethod: "fixed_annual",
        contributionValue: "7000",
        taxTreatment: "tax_free",
        employerMatchType: "none",
        parentCategory: "Retirement",
      });
      // Brokerage
      insertContribAccount(db, {
        personId,
        jobId: null,
        accountType: "brokerage",
        contributionMethod: "fixed_monthly",
        contributionValue: "500",
        taxTreatment: "taxable",
        employerMatchType: "none",
        parentCategory: "Portfolio",
      });
    });

    it("returns all account types", async () => {
      const result = await caller.contribution.computeSummary();
      const person = result.people.find((p) => p.person.id === personId);
      expect(person!.accountTypes.length).toBeGreaterThanOrEqual(3);
    });

    it("sums retirement and portfolio totals separately", async () => {
      const result = await caller.contribution.computeSummary();
      const person = result.people.find((p) => p.person.id === personId);
      // 401k: 15% of 150000 = 22500 employee + 100% match on first 3% = 4500 match
      // IRA: 7000
      // Brokerage: 500 * 12 = 6000
      expect(person!.totals.retirementWithoutMatch).toBe(22500 + 7000);
      expect(person!.totals.retirementWithMatch).toBe(22500 + 4500 + 7000);
      expect(person!.totals.portfolioWithoutMatch).toBe(6000);
      expect(person!.totals.totalWithoutMatch).toBe(22500 + 7000 + 6000);
    });

    it("includes perContribData for all contributions", async () => {
      const result = await caller.contribution.computeSummary();
      const person = result.people.find((p) => p.person.id === personId);
      expect(person!.perContribData.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("computeSummary — catchup contribution for age 50+", () => {
    let personId: number;

    beforeAll(async () => {
      // Born 1974 → age 52 in 2026
      personId = await seedPerson(db, "Catchup-Person", "1974-01-15");
      const jobId = seedJob(db, personId, { annualSalary: "200000" });
      insertContribAccount(db, {
        personId,
        jobId,
        accountType: "401k",
        contributionMethod: "percent_of_salary",
        contributionValue: "20",
        taxTreatment: "pre_tax",
        employerMatchType: "none",
        parentCategory: "Retirement",
      });
    });

    it("applies catchup limit for age 50+", async () => {
      const result = await caller.contribution.computeSummary();
      const person = result.people.find((p) => p.person.id === personId);
      const acctType = person!.accountTypes.find((a) => a.colorKey === "401k");
      expect(acctType).toBeDefined();
      // 2026: base 24500 + catchup 8000 = 32500
      expect(acctType!.limit).toBe(24500 + 8000);
    });
  });

  describe("computeSummary — super catchup for age 60-63", () => {
    let personId: number;

    beforeAll(async () => {
      // Born 1964 → age 62 in 2026 (within 60-63 super catchup range)
      personId = await seedPerson(db, "SuperCatchup", "1964-06-01");
      const jobId = seedJob(db, personId, { annualSalary: "200000" });
      insertContribAccount(db, {
        personId,
        jobId,
        accountType: "401k",
        contributionMethod: "percent_of_salary",
        contributionValue: "20",
        taxTreatment: "pre_tax",
        employerMatchType: "none",
        parentCategory: "Retirement",
      });
    });

    it("applies super catchup limit for age 60-63", async () => {
      const result = await caller.contribution.computeSummary();
      const person = result.people.find((p) => p.person.id === personId);
      const acctType = person!.accountTypes.find((a) => a.colorKey === "401k");
      expect(acctType).toBeDefined();
      // 2026: base 24500 + super catchup 11250 = 35750
      expect(acctType!.limit).toBe(24500 + 11250);
    });
  });

  describe("computeSummary — salary override", () => {
    let personId: number;

    beforeAll(async () => {
      personId = await seedPerson(db, "Salary-Override", "1990-03-15");
      const jobId = seedJob(db, personId, { annualSalary: "100000" });
      insertContribAccount(db, {
        personId,
        jobId,
        accountType: "401k",
        contributionMethod: "percent_of_salary",
        contributionValue: "10",
        taxTreatment: "pre_tax",
        employerMatchType: "none",
        parentCategory: "Retirement",
      });
    });

    it("uses overridden salary for contribution calculation", async () => {
      const result = await caller.contribution.computeSummary({
        salaryOverrides: [{ personId, salary: 200000 }],
      });
      const person = result.people.find((p) => p.person.id === personId);
      expect(person!.salary).toBe(200000);
      const acctType = person!.accountTypes.find((a) => a.colorKey === "401k");
      // 10% of 200000 = 20000
      expect(acctType!.employeeContrib).toBe(20000);
    });
  });

  describe("computeSummary — joint ownership contribution", () => {
    let personId: number;

    beforeAll(async () => {
      personId = await seedPerson(db, "Joint-Person", "1988-08-08");
      seedJob(db, personId, { annualSalary: "100000" });
      insertContribAccount(db, {
        personId,
        accountType: "brokerage",
        contributionMethod: "fixed_monthly",
        contributionValue: "2000",
        taxTreatment: "taxable",
        employerMatchType: "none",
        parentCategory: "Portfolio",
        ownership: "joint",
      });
    });

    it("includes joint accounts in jointAccountTypes", async () => {
      const result = await caller.contribution.computeSummary();
      expect(result.jointAccountTypes.length).toBeGreaterThanOrEqual(1);
      const joint = result.jointAccountTypes.find((a) => a.isJoint === true);
      expect(joint).toBeDefined();
      // fixed_monthly: 2000 * 12 = 24000
      expect(joint!.employeeContrib).toBe(24000);
    });

    it("computes joint totals", async () => {
      const result = await caller.contribution.computeSummary();
      expect(result.jointTotals.totalWithoutMatch).toBeGreaterThanOrEqual(
        24000,
      );
    });
  });

  describe("computeSummary — inactive contribution excluded", () => {
    let personId: number;

    beforeAll(async () => {
      personId = await seedPerson(db, "Inactive-Contrib", "1995-01-01");
      const jobId = seedJob(db, personId, { annualSalary: "80000" });
      insertContribAccount(db, {
        personId,
        jobId,
        accountType: "401k",
        contributionMethod: "percent_of_salary",
        contributionValue: "5",
        taxTreatment: "pre_tax",
        employerMatchType: "none",
        parentCategory: "Retirement",
        isActive: false,
      });
    });

    it("does not include inactive contributions", async () => {
      const result = await caller.contribution.computeSummary();
      const person = result.people.find((p) => p.person.id === personId);
      expect(person).toBeDefined();
      // Person should have no active contribution accounts
      const _acctTypes401k = person!.accountTypes.filter(
        (a) => a.colorKey === "401k",
      );
      // The person's own 401k should not show because isActive=false
      // (there may be other people's 401k accounts, so check this person's totals)
      expect(person!.totals.retirementWithoutMatch).toBe(0);
    });
  });

  describe("computeSummary — bonus contribution", () => {
    let personId: number;

    beforeAll(async () => {
      personId = await seedPerson(db, "Bonus-Person", "1990-06-15");
      const jobId = seedJob(db, personId, {
        annualSalary: "120000",
        bonusPercent: "10",
        bonusMultiplier: "1",
        include401kInBonus: true,
      });
      insertContribAccount(db, {
        personId,
        jobId,
        accountType: "401k",
        contributionMethod: "percent_of_salary",
        contributionValue: "8",
        taxTreatment: "pre_tax",
        employerMatchType: "none",
        parentCategory: "Retirement",
      });
    });

    it("includes bonus contribution estimate in 401k", async () => {
      const result = await caller.contribution.computeSummary();
      const person = result.people.find((p) => p.person.id === personId);
      expect(person).toBeDefined();
      expect(person!.bonusGross).toBeGreaterThan(0);
      const acctType = person!.accountTypes.find((a) => a.colorKey === "401k");
      expect(acctType).toBeDefined();
      // bonusContrib should be > 0 when include401kInBonus is set
      expect(acctType!.bonusContrib).toBeGreaterThan(0);
    });
  });

  describe("computeSummary — person with ended job (no active job)", () => {
    let personId: number;

    beforeAll(async () => {
      personId = await seedPerson(db, "Ended-Job", "1990-01-01");
      seedJob(db, personId, {
        annualSalary: "100000",
        endDate: "2025-12-31",
      });
    });

    it("returns zero salary when only job is ended", async () => {
      const result = await caller.contribution.computeSummary();
      const person = result.people.find((p) => p.person.id === personId);
      expect(person).toBeDefined();
      expect(person!.salary).toBe(0);
      expect(person!.result).toBeNull();
    });
  });

  describe("computeSummary — performance account label in display", () => {
    let personId: number;

    beforeAll(async () => {
      personId = await seedPerson(db, "PerfAcct-Label", "1991-03-15");
      seedJob(db, personId, { annualSalary: "100000" });
      const perfId = seedPerformanceAccount(db, {
        name: "Growth",
        institution: "Fidelity",
        accountType: "brokerage",
        parentCategory: "Portfolio",
        accountLabel: "Fidelity Growth Brokerage",
        displayName: "Fidelity Growth Brokerage",
      });
      insertContribAccount(db, {
        personId,
        jobId: null,
        accountType: "brokerage",
        contributionMethod: "fixed_monthly",
        contributionValue: "300",
        taxTreatment: "taxable",
        employerMatchType: "none",
        parentCategory: "Portfolio",
        performanceAccountId: perfId,
      });
    });

    it("uses performance account label for brokerage display name", async () => {
      const result = await caller.contribution.computeSummary();
      const person = result.people.find((p) => p.person.id === personId);
      const brokAcct = person!.accountTypes.find(
        (a) => a.parentCategory === "Portfolio",
      );
      expect(brokAcct).toBeDefined();
      // The display name should be derived from the performance account
      expect(brokAcct!.accountType).toBeTruthy();
    });
  });

  describe("computeSummary — contribution profile override", () => {
    let personId: number;
    let profileId: number;

    beforeAll(async () => {
      personId = await seedPerson(db, "Profile-Override", "1990-01-01");
      const jobId = seedJob(db, personId, { annualSalary: "100000" });
      const contribId = insertContribAccount(db, {
        personId,
        jobId,
        accountType: "401k",
        contributionMethod: "percent_of_salary",
        contributionValue: "5",
        taxTreatment: "pre_tax",
        employerMatchType: "none",
        parentCategory: "Retirement",
      });
      profileId = seedContributionProfile(db, {
        name: `test-profile-${Date.now()}`,
        isDefault: false,
        salaryOverrides: { [String(personId)]: 180000 },
        contributionOverrides: {
          contributionAccounts: {
            [String(contribId)]: { contributionValue: "15" },
          },
          jobs: {},
        },
      });
    });

    it("applies profile salary and contribution overrides", async () => {
      const result = await caller.contribution.computeSummary({
        contributionProfileId: profileId,
      });
      const person = result.people.find((p) => p.person.id === personId);
      expect(person).toBeDefined();
      // Profile overrides salary to 180000 and contribution to 15%
      expect(person!.salary).toBe(180000);
      const acctType = person!.accountTypes.find((a) => a.colorKey === "401k");
      expect(acctType).toBeDefined();
      // 15% of 180000 = 27000
      expect(acctType!.employeeContrib).toBe(27000);
    });
  });

  describe("computeSummary — limits record returned", () => {
    it("returns current year IRS limits", async () => {
      const result = await caller.contribution.computeSummary();
      expect(result.limits).toBeDefined();
      expect(result.limits["401k_employee_limit"]).toBe(24500);
      expect(result.limits["ira_limit"]).toBe(7500);
      expect(result.limits["hsa_family_limit"]).toBe(8750);
    });
  });

  describe("computeSummary — result field from calculateContributions", () => {
    let personId: number;

    beforeAll(async () => {
      personId = await seedPerson(db, "Calc-Result", "1990-01-01");
      const jobId = seedJob(db, personId, { annualSalary: "100000" });
      insertContribAccount(db, {
        personId,
        jobId,
        accountType: "401k",
        contributionMethod: "percent_of_salary",
        contributionValue: "10",
        taxTreatment: "pre_tax",
        employerMatchType: "none",
        parentCategory: "Retirement",
      });
    });

    it("includes non-null result when person has active job and contributions", async () => {
      const result = await caller.contribution.computeSummary();
      const person = result.people.find((p) => p.person.id === personId);
      expect(person!.result).not.toBeNull();
    });
  });

  describe("computeSummary — fixed_annual employer match", () => {
    let personId: number;

    beforeAll(async () => {
      personId = await seedPerson(db, "FixedMatch", "1990-01-01");
      const jobId = seedJob(db, personId, { annualSalary: "100000" });
      insertContribAccount(db, {
        personId,
        jobId,
        accountType: "401k",
        contributionMethod: "percent_of_salary",
        contributionValue: "5",
        taxTreatment: "pre_tax",
        employerMatchType: "fixed_annual",
        employerMatchValue: "2500",
        parentCategory: "Retirement",
      });
    });

    it("includes fixed annual employer match", async () => {
      const result = await caller.contribution.computeSummary();
      const person = result.people.find((p) => p.person.id === personId);
      const acctType = person!.accountTypes.find((a) => a.colorKey === "401k");
      expect(acctType).toBeDefined();
      expect(acctType!.employerMatch).toBe(2500);
      expect(acctType!.totalContrib).toBe(5000 + 2500);
    });
  });

  describe("computeSummary — sibling contribution in same limit group", () => {
    let personId: number;

    beforeAll(async () => {
      personId = await seedPerson(db, "Sibling-Contribs", "1990-01-01");
      const jobId = seedJob(db, personId, { annualSalary: "100000" });
      // Two separate 401k contributions for the same person/job
      insertContribAccount(db, {
        personId,
        jobId,
        accountType: "401k",
        contributionMethod: "percent_of_salary",
        contributionValue: "5",
        taxTreatment: "pre_tax",
        employerMatchType: "none",
        parentCategory: "Retirement",
      });
      insertContribAccount(db, {
        personId,
        jobId,
        accountType: "401k",
        contributionMethod: "percent_of_salary",
        contributionValue: "3",
        taxTreatment: "tax_free",
        employerMatchType: "none",
        parentCategory: "Retirement",
      });
    });

    it("computes siblingAnnualTotal for contributions in same limit group", async () => {
      const result = await caller.contribution.computeSummary();
      const person = result.people.find((p) => p.person.id === personId);
      // Both are in 401k limit group — each should have sibling total of the other
      const pcds = person!.perContribData.filter(
        (pcd) => pcd.limitGroup === "401k",
      );
      expect(pcds.length).toBe(2);
      // The first (5% = 5000) should have sibling = 3000
      // The second (3% = 3000) should have sibling = 5000
      const amounts = pcds.map((p) => p.annualAmount).sort();
      const siblings = pcds.map((p) => p.siblingAnnualTotal).sort();
      expect(amounts).toEqual([3000, 5000]);
      expect(siblings).toEqual([3000, 5000]);
    });

    it("aggregates both into single 401k account type", async () => {
      const result = await caller.contribution.computeSummary();
      const person = result.people.find((p) => p.person.id === personId);
      const acctTypes401k = person!.accountTypes.filter(
        (a) => a.colorKey === "401k",
      );
      // They should be grouped into a single entry
      expect(acctTypes401k.length).toBe(1);
      expect(acctTypes401k[0]!.employeeContrib).toBe(8000);
      expect(acctTypes401k[0]!.tradContrib).toBe(5000);
      expect(acctTypes401k[0]!.taxFreeContrib).toBe(3000);
    });
  });

  describe("computeSummary — pay period variants", () => {
    it("uses 24 periods for semimonthly", async () => {
      const personId = await seedPerson(db, "Semimonthly", "1990-01-01");
      const jobId = seedJob(db, personId, {
        annualSalary: "120000",
        payPeriod: "semimonthly",
      });
      insertContribAccount(db, {
        personId,
        jobId,
        accountType: "401k",
        contributionMethod: "fixed_per_period",
        contributionValue: "500",
        taxTreatment: "pre_tax",
        employerMatchType: "none",
        parentCategory: "Retirement",
      });
      const result = await caller.contribution.computeSummary();
      const person = result.people.find((p) => p.person.id === personId);
      expect(person!.periodsPerYear).toBe(24);
      const acctType = person!.accountTypes.find((a) => a.colorKey === "401k");
      // 500 * 24 = 12000
      expect(acctType!.employeeContrib).toBe(12000);
    });
  });

  describe("auth", () => {
    it("viewer can read contribution data", async () => {
      const { caller: viewerCaller, cleanup: vc } =
        await createTestCaller(viewerSession);
      try {
        const result = await viewerCaller.contribution.computeSummary();
        expect(result).toBeDefined();
      } finally {
        vc();
      }
    });
  });

  describe("computeSummary — allocation priority and target annual", () => {
    let personId: number;

    beforeAll(async () => {
      personId = await seedPerson(db, "Priority-Target", "1990-01-01");
      const jobId = seedJob(db, personId, { annualSalary: "100000" });
      insertContribAccount(db, {
        personId,
        jobId,
        accountType: "401k",
        contributionMethod: "percent_of_salary",
        contributionValue: "10",
        taxTreatment: "pre_tax",
        employerMatchType: "none",
        parentCategory: "Retirement",
        targetAnnual: "20000",
        allocationPriority: 1,
      });
    });

    it("includes targetAnnual and allocationPriority in snapshot", async () => {
      const result = await caller.contribution.computeSummary();
      const person = result.people.find((p) => p.person.id === personId);
      const acctType = person!.accountTypes.find(
        (a) => a.colorKey === "401k" && a.targetAnnual === 20000,
      );
      expect(acctType).toBeDefined();
      expect(acctType!.targetAnnual).toBe(20000);
      expect(acctType!.allocationPriority).toBe(1);
    });
  });
});
