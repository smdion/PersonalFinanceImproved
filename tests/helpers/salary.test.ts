import "../helpers/setup-mocks";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  computeBonusGross,
  getEffectiveIncome,
  getTotalCompensation,
  getCurrentSalary,
  getFutureSalaryChanges,
} from "@/server/helpers/salary";
import { createTestDb, type TestDbContext } from "./db-harness";

describe("computeBonusGross", () => {
  it("computes bonus from percent and multiplier", () => {
    // $120,000 salary × 10% bonus × 1.0 multiplier × (12/12 months)
    expect(computeBonusGross(120000, "0.10", "1", null, null)).toBe(12000);
  });

  it("applies bonusMultiplier", () => {
    // $120,000 × 10% × 1.5 = $18,000
    expect(computeBonusGross(120000, "0.10", "1.5", null, null)).toBe(18000);
  });

  it("returns override directly when set", () => {
    expect(computeBonusGross(120000, "0.10", "1", "15000", null)).toBe(15000);
  });

  it("returns 0 when bonus percent is 0", () => {
    expect(computeBonusGross(120000, "0", "1", null, null)).toBe(0);
  });

  it("returns 0 when bonus percent is null", () => {
    expect(computeBonusGross(120000, null, null, null, null)).toBe(0);
  });

  it("prorates for partial bonus year", () => {
    // $120,000 × 10% × 1 × (6/12) = $6,000
    expect(computeBonusGross(120000, "0.10", "1", null, 6)).toBe(6000);
  });

  it("defaults multiplier to 1 when null", () => {
    expect(computeBonusGross(120000, "0.10", null, null, null)).toBe(12000);
  });

  it("defaults multiplier to 1 when zero", () => {
    // "0" multiplier fallback → 1
    expect(computeBonusGross(120000, "0.10", "0", null, null)).toBe(12000);
  });

  it("defaults monthsInBonusYear to 12 when null", () => {
    expect(computeBonusGross(120000, "0.10", "1", null, null)).toBe(12000);
  });

  it("rounds to cents", () => {
    // 100000 × 0.15 × 1.1 × (12/12) = 16500.000...
    const result = computeBonusGross(100000, "0.15", "1.1", null, null);
    expect(result).toBe(16500);
    // Check that the result has at most 2 decimal places
    expect(Math.round(result * 100)).toBe(result * 100);
  });
});

// ---------------------------------------------------------------------------
// getEffectiveIncome (pure)
// ---------------------------------------------------------------------------

describe("getEffectiveIncome", () => {
  function makeJob(overrides: Record<string, unknown> = {}) {
    return {
      id: 1,
      personId: 1,
      annualSalary: "120000",
      bonusPercent: "0.10",
      bonusMultiplier: "1",
      bonusOverride: null,
      monthsInBonusYear: 12,
      includeBonusInContributions: false,
      payPeriod: "biweekly",
      endDate: null,
      ...overrides,
    } as Parameters<typeof getEffectiveIncome>[0];
  }

  it("returns base salary when includeBonusInContributions is false", () => {
    expect(getEffectiveIncome(makeJob(), 120000)).toBe(120000);
  });

  it("returns salary + bonus when includeBonusInContributions is true", () => {
    const job = makeJob({ includeBonusInContributions: true });
    // 120000 + 120000 * 0.10 * 1 * (12/12) = 132000
    expect(getEffectiveIncome(job, 120000)).toBe(132000);
  });
});

// ---------------------------------------------------------------------------
// getTotalCompensation (pure)
// ---------------------------------------------------------------------------

describe("getTotalCompensation", () => {
  function makeJob(overrides: Record<string, unknown> = {}) {
    return {
      id: 1,
      personId: 1,
      annualSalary: "120000",
      bonusPercent: "0.10",
      bonusMultiplier: "1",
      bonusOverride: null,
      monthsInBonusYear: 12,
      includeBonusInContributions: false,
      payPeriod: "biweekly",
      endDate: null,
      ...overrides,
    } as Parameters<typeof getTotalCompensation>[0];
  }

  it("returns salary + bonus regardless of includeBonusInContributions", () => {
    const job = makeJob({ includeBonusInContributions: false });
    expect(getTotalCompensation(job, 120000)).toBe(132000);
  });

  it("returns just salary when no bonus", () => {
    const job = makeJob({ bonusPercent: "0" });
    expect(getTotalCompensation(job, 120000)).toBe(120000);
  });

  it("applies bonus override", () => {
    const job = makeJob({ bonusOverride: "25000" });
    expect(getTotalCompensation(job, 120000)).toBe(145000);
  });
});

// ---------------------------------------------------------------------------
// getCurrentSalary (DB-dependent)
// ---------------------------------------------------------------------------

describe("getCurrentSalary", () => {
  let ctx: TestDbContext;

  beforeAll(async () => {
    ctx = await createTestDb();
    // Seed a person + job + salary change
    ctx.db
      .insert(ctx.schema.people)
      .values({
        id: 1,
        name: "Test",
        dateOfBirth: "1990-01-01",
        isPrimaryUser: true,
      })
      .run();
    ctx.db
      .insert(ctx.schema.jobs)
      .values({
        id: 1,
        personId: 1,
        employerName: "TestCo",
        annualSalary: "100000",
        payPeriod: "biweekly",
        payWeek: "even",
        startDate: "2020-01-01",
        w4FilingStatus: "MFJ",
      })
      .run();
    ctx.db
      .insert(ctx.schema.salaryChanges)
      .values({
        jobId: 1,
        newSalary: "110000",
        effectiveDate: "2025-01-01",
      })
      .run();
    ctx.db
      .insert(ctx.schema.salaryChanges)
      .values({
        jobId: 1,
        newSalary: "120000",
        effectiveDate: "2025-06-01",
      })
      .run();
  });

  afterAll(() => ctx.cleanup());

  it("returns latest salary change before asOfDate", async () => {
    const salary = await getCurrentSalary(
      ctx.rawDb,
      1,
      "100000",
      new Date("2025-07-01"),
    );
    expect(salary).toBe(120000);
  });

  it("returns earlier change when asOfDate is before later change", async () => {
    const salary = await getCurrentSalary(
      ctx.rawDb,
      1,
      "100000",
      new Date("2025-03-01"),
    );
    expect(salary).toBe(110000);
  });

  it("falls back to fallbackSalary when no changes exist before date", async () => {
    const salary = await getCurrentSalary(
      ctx.rawDb,
      1,
      "100000",
      new Date("2024-01-01"),
    );
    expect(salary).toBe(100000);
  });

  it("falls back to fallbackSalary for non-existent job", async () => {
    const salary = await getCurrentSalary(ctx.rawDb, 999, "80000");
    expect(salary).toBe(80000);
  });
});

// ---------------------------------------------------------------------------
// getFutureSalaryChanges (DB-dependent)
// ---------------------------------------------------------------------------

describe("getFutureSalaryChanges", () => {
  let ctx: TestDbContext;

  beforeAll(async () => {
    ctx = await createTestDb();
    ctx.db
      .insert(ctx.schema.people)
      .values({
        id: 1,
        name: "Test",
        dateOfBirth: "1990-01-01",
        isPrimaryUser: true,
      })
      .run();
    ctx.db
      .insert(ctx.schema.jobs)
      .values({
        id: 1,
        personId: 1,
        employerName: "TestCo",
        annualSalary: "100000",
        payPeriod: "biweekly",
        payWeek: "even",
        startDate: "2020-01-01",
        w4FilingStatus: "MFJ",
      })
      .run();
    ctx.db
      .insert(ctx.schema.salaryChanges)
      .values({
        jobId: 1,
        newSalary: "110000",
        effectiveDate: "2025-06-01",
      })
      .run();
    ctx.db
      .insert(ctx.schema.salaryChanges)
      .values({
        jobId: 1,
        newSalary: "120000",
        effectiveDate: "2026-01-01",
      })
      .run();
  });

  afterAll(() => ctx.cleanup());

  it("returns future changes sorted by date", async () => {
    const changes = await getFutureSalaryChanges(
      ctx.rawDb,
      1,
      new Date("2025-01-01"),
    );
    expect(changes).toHaveLength(2);
    expect(changes[0]!.salary).toBe(110000);
    expect(changes[0]!.effectiveDate).toBe("2025-06-01");
    expect(changes[1]!.salary).toBe(120000);
  });

  it("returns only changes after asOfDate", async () => {
    const changes = await getFutureSalaryChanges(
      ctx.rawDb,
      1,
      new Date("2025-07-01"),
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]!.salary).toBe(120000);
  });

  it("returns empty array when no future changes", async () => {
    const changes = await getFutureSalaryChanges(
      ctx.rawDb,
      1,
      new Date("2027-01-01"),
    );
    expect(changes).toHaveLength(0);
  });

  it("returns empty for non-existent job", async () => {
    const changes = await getFutureSalaryChanges(ctx.rawDb, 999);
    expect(changes).toHaveLength(0);
  });
});
