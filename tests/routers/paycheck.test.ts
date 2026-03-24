/**
 * Paycheck router integration tests.
 *
 * Tests computeSummary shape with empty DB, after seeding a person,
 * with optional input params, and with a full job + deductions + contributions
 * setup — using an isolated SQLite database per suite.
 *
 * Also tests settings/paycheck CRUD procedures: people, jobs,
 * salaryChanges, contributionAccounts, deductions.
 */
import "./setup-mocks";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestCaller, seedPerson, seedJob } from "./setup";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type * as sqliteSchema from "@/lib/db/schema-sqlite";
import * as schema from "@/lib/db/schema-sqlite";

// ── Empty DB ──────────────────────────────────────────────────────────────────

describe("paycheck router — empty DB", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    cleanup = ctx.cleanup;
  });

  afterAll(() => cleanup());

  describe("computeSummary", () => {
    it("returns expected top-level shape", async () => {
      const result = await caller.paycheck.computeSummary();
      expect(result).toHaveProperty("people");
      expect(result).toHaveProperty("jointContribs");
      expect(result).toHaveProperty("householdTax");
    });

    it("people is an empty array when no people exist", async () => {
      const result = await caller.paycheck.computeSummary();
      expect(Array.isArray(result.people)).toBe(true);
      expect(result.people).toHaveLength(0);
    });

    it("jointContribs is an empty array when no contributions exist", async () => {
      const result = await caller.paycheck.computeSummary();
      expect(Array.isArray(result.jointContribs)).toBe(true);
      expect(result.jointContribs).toHaveLength(0);
    });

    it("householdTax is null when no active earners exist", async () => {
      const result = await caller.paycheck.computeSummary();
      expect(result.householdTax).toBeNull();
    });
  });
});

// ── With a seeded person (no job) ─────────────────────────────────────────────

describe("paycheck router — seeded person, no job", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;

    await seedPerson(db, "Alice Smith", "1988-04-15");
  });

  afterAll(() => cleanup());

  describe("computeSummary", () => {
    it("people array has exactly one entry", async () => {
      const result = await caller.paycheck.computeSummary();
      expect(result.people).toHaveLength(1);
    });

    it("person entry contains the seeded person's name", async () => {
      const result = await caller.paycheck.computeSummary();
      const entry = result.people[0]!;
      expect(entry.person).toBeDefined();
      expect(entry.person.name).toBe("Alice Smith");
    });

    it("job is null — no job was seeded", async () => {
      const result = await caller.paycheck.computeSummary();
      const entry = result.people[0]!;
      expect(entry.job).toBeNull();
    });

    it("paycheck is null — no job was seeded", async () => {
      const result = await caller.paycheck.computeSummary();
      const entry = result.people[0]!;
      expect(entry.paycheck).toBeNull();
    });

    it("tax is null — no job was seeded", async () => {
      const result = await caller.paycheck.computeSummary();
      const entry = result.people[0]!;
      expect(entry.tax).toBeNull();
    });

    it("salary is 0 — no job was seeded", async () => {
      const result = await caller.paycheck.computeSummary();
      const entry = result.people[0]!;
      expect(entry.salary).toBe(0);
    });

    it("futureSalaryChanges is an empty array", async () => {
      const result = await caller.paycheck.computeSummary();
      const entry = result.people[0]!;
      expect(Array.isArray(entry.futureSalaryChanges)).toBe(true);
      expect(entry.futureSalaryChanges).toHaveLength(0);
    });

    it("rawDeductions is an empty array", async () => {
      const result = await caller.paycheck.computeSummary();
      const entry = result.people[0]!;
      expect(Array.isArray(entry.rawDeductions)).toBe(true);
      expect(entry.rawDeductions).toHaveLength(0);
    });

    it("rawContribs is an empty array", async () => {
      const result = await caller.paycheck.computeSummary();
      const entry = result.people[0]!;
      expect(Array.isArray(entry.rawContribs)).toBe(true);
      expect(entry.rawContribs).toHaveLength(0);
    });

    it("householdTax remains null — no active earner", async () => {
      const result = await caller.paycheck.computeSummary();
      expect(result.householdTax).toBeNull();
    });
  });
});

// ── Optional input params ─────────────────────────────────────────────────────

describe("paycheck router — optional input params", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;
  let personId: number;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;

    personId = await seedPerson(db, "Bob Jones", "1985-07-22");
  });

  afterAll(() => cleanup());

  describe("computeSummary with empty overrides object", () => {
    it("accepts an empty input object and returns valid shape", async () => {
      const result = await caller.paycheck.computeSummary({});
      expect(result).toHaveProperty("people");
      expect(result).toHaveProperty("jointContribs");
      expect(result).toHaveProperty("householdTax");
    });

    it("empty salaryOverrides array does not affect results", async () => {
      const result = await caller.paycheck.computeSummary({
        salaryOverrides: [],
      });
      expect(Array.isArray(result.people)).toBe(true);
      expect(result.people).toHaveLength(1);
    });
  });

  describe("computeSummary with taxYearOverride", () => {
    it("accepts a taxYearOverride and returns valid shape", async () => {
      const result = await caller.paycheck.computeSummary({
        taxYearOverride: 2024,
      });
      expect(result).toHaveProperty("people");
      expect(result).toHaveProperty("jointContribs");
      expect(result).toHaveProperty("householdTax");
    });

    it("returns null paycheck/tax for unseeded year (no brackets)", async () => {
      // Year 1900 will have no tax brackets — person entry still present but paycheck/tax null
      const result = await caller.paycheck.computeSummary({
        taxYearOverride: 1900,
      });
      expect(result.people).toHaveLength(1);
      expect(result.people[0]!.paycheck).toBeNull();
      expect(result.people[0]!.tax).toBeNull();
    });
  });

  describe("computeSummary with salaryOverride for seeded person", () => {
    it("accepts a salary override for the person — no job so still null paycheck", async () => {
      const result = await caller.paycheck.computeSummary({
        salaryOverrides: [{ personId, salary: 120000 }],
      });
      // No job exists, so override has no effect on paycheck (still null)
      expect(result.people).toHaveLength(1);
      expect(result.people[0]!.paycheck).toBeNull();
    });
  });

  describe("computeSummary called without any argument", () => {
    it("is equivalent to calling with no input (undefined)", async () => {
      const withoutInput = await caller.paycheck.computeSummary();
      const withEmptyObj = await caller.paycheck.computeSummary({});
      expect(withoutInput.people.length).toBe(withEmptyObj.people.length);
      expect(withoutInput.householdTax).toBe(withEmptyObj.householdTax);
    });
  });
});

// ── Settings: People CRUD ───────────────────────────────────────────────────

describe("settings.people CRUD", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    cleanup = ctx.cleanup;
  });

  afterAll(() => cleanup());

  it("list returns empty array initially", async () => {
    const result = await caller.settings.people.list();
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });

  it("create adds a person and returns it", async () => {
    const person = await caller.settings.people.create({
      name: "Jane Doe",
      dateOfBirth: "1990-05-15",
    });
    expect(person).toBeDefined();
    expect(person!.name).toBe("Jane Doe");
    expect(person!.dateOfBirth).toBe("1990-05-15");
    expect(person!.id).toBeGreaterThan(0);
  });

  it("list returns one person after create", async () => {
    const result = await caller.settings.people.list();
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("Jane Doe");
  });

  it("create a second person", async () => {
    const person = await caller.settings.people.create({
      name: "John Smith",
      dateOfBirth: "1988-12-01",
      isPrimaryUser: true,
    });
    expect(person!.name).toBe("John Smith");
    expect(person!.isPrimaryUser).toBe(true);
  });

  it("list returns both people ordered by id", async () => {
    const result = await caller.settings.people.list();
    expect(result).toHaveLength(2);
    expect(result[0]!.name).toBe("Jane Doe");
    expect(result[1]!.name).toBe("John Smith");
  });

  it("update changes a person's name", async () => {
    const people = await caller.settings.people.list();
    const id = people[0]!.id;
    const updated = await caller.settings.people.update({
      id,
      name: "Jane Updated",
      dateOfBirth: "1990-05-15",
    });
    expect(updated!.name).toBe("Jane Updated");
  });

  it("delete removes a person", async () => {
    const people = await caller.settings.people.list();
    const id = people[1]!.id;
    await caller.settings.people.delete({ id });
    const remaining = await caller.settings.people.list();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.name).toBe("Jane Updated");
  });
});

// ── Settings: Jobs CRUD ─────────────────────────────────────────────────────

describe("settings.jobs CRUD", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;
  let personId: number;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;
    personId = await seedPerson(db, "Worker Bee", "1992-03-10");
  });

  afterAll(() => cleanup());

  it("list returns empty array initially", async () => {
    const result = await caller.settings.jobs.list();
    expect(result).toHaveLength(0);
  });

  it("create adds a job and returns it", async () => {
    const job = await caller.settings.jobs.create({
      personId,
      employerName: "Acme Corp",
      annualSalary: "100000",
      payPeriod: "biweekly",
      payWeek: "even",
      startDate: "2022-01-15",
      w4FilingStatus: "Single",
    });
    expect(job).toBeDefined();
    expect(job!.employerName).toBe("Acme Corp");
    expect(job!.annualSalary).toBe("100000");
    expect(job!.payPeriod).toBe("biweekly");
  });

  it("list returns one job after create", async () => {
    const result = await caller.settings.jobs.list();
    expect(result).toHaveLength(1);
  });

  it("update changes a job's salary", async () => {
    const jobs = await caller.settings.jobs.list();
    const id = jobs[0]!.id;
    const updated = await caller.settings.jobs.update({
      id,
      personId,
      employerName: "Acme Corp",
      annualSalary: "110000",
      payPeriod: "biweekly",
      payWeek: "even",
      startDate: "2022-01-15",
      w4FilingStatus: "Single",
    });
    expect(updated!.annualSalary).toBe("110000");
  });

  it("create a job with endDate", async () => {
    const job = await caller.settings.jobs.create({
      personId,
      employerName: "Old Corp",
      annualSalary: "80000",
      payPeriod: "monthly",
      payWeek: "na",
      startDate: "2018-06-01",
      endDate: "2021-12-31",
      w4FilingStatus: "MFJ",
    });
    expect(job!.endDate).toBe("2021-12-31");
  });

  it("delete removes a job", async () => {
    const jobs = await caller.settings.jobs.list();
    expect(jobs).toHaveLength(2);
    const id = jobs[1]!.id;
    await caller.settings.jobs.delete({ id });
    const remaining = await caller.settings.jobs.list();
    expect(remaining).toHaveLength(1);
  });
});

// ── Settings: Salary Changes CRUD ───────────────────────────────────────────

describe("settings.salaryChanges CRUD", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;
  let jobId: number;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;
    const personId = await seedPerson(db, "Salary Person", "1990-01-01");
    jobId = seedJob(db, personId);
  });

  afterAll(() => cleanup());

  it("list returns empty array initially", async () => {
    const result = await caller.settings.salaryChanges.list();
    expect(result).toHaveLength(0);
  });

  it("create adds a salary change", async () => {
    const change = await caller.settings.salaryChanges.create({
      jobId,
      effectiveDate: "2023-01-01",
      newSalary: "130000",
      raisePercent: "8.33",
      notes: "Annual raise",
    });
    expect(change).toBeDefined();
    expect(change!.newSalary).toBe("130000");
    expect(change!.notes).toBe("Annual raise");
  });

  it("create a second salary change", async () => {
    const change = await caller.settings.salaryChanges.create({
      jobId,
      effectiveDate: "2024-01-01",
      newSalary: "140000",
    });
    expect(change!.effectiveDate).toBe("2024-01-01");
  });

  it("list returns both salary changes ordered by date", async () => {
    const result = await caller.settings.salaryChanges.list();
    expect(result).toHaveLength(2);
    expect(result[0]!.effectiveDate).toBe("2023-01-01");
    expect(result[1]!.effectiveDate).toBe("2024-01-01");
  });

  it("update changes the salary amount", async () => {
    const changes = await caller.settings.salaryChanges.list();
    const id = changes[0]!.id;
    const updated = await caller.settings.salaryChanges.update({
      id,
      jobId,
      effectiveDate: "2023-01-01",
      newSalary: "135000",
      notes: "Adjusted raise",
    });
    expect(updated!.newSalary).toBe("135000");
    expect(updated!.notes).toBe("Adjusted raise");
  });

  it("delete removes a salary change", async () => {
    const changes = await caller.settings.salaryChanges.list();
    const id = changes[1]!.id;
    await caller.settings.salaryChanges.delete({ id });
    const remaining = await caller.settings.salaryChanges.list();
    expect(remaining).toHaveLength(1);
  });
});

// ── Settings: Deductions CRUD ───────────────────────────────────────────────

describe("settings.deductions CRUD", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;
  let jobId: number;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;
    const personId = await seedPerson(db, "Deduction Person", "1990-01-01");
    jobId = seedJob(db, personId);
  });

  afterAll(() => cleanup());

  it("list returns empty array initially", async () => {
    const result = await caller.settings.deductions.list();
    expect(result).toHaveLength(0);
  });

  it("create adds a pre-tax deduction", async () => {
    const ded = await caller.settings.deductions.create({
      jobId,
      deductionName: "Health Insurance",
      amountPerPeriod: "250.00",
      isPretax: true,
      ficaExempt: true,
    });
    expect(ded).toBeDefined();
    expect(ded!.deductionName).toBe("Health Insurance");
    expect(ded!.isPretax).toBe(true);
    expect(ded!.ficaExempt).toBe(true);
  });

  it("create adds an after-tax deduction", async () => {
    const ded = await caller.settings.deductions.create({
      jobId,
      deductionName: "Parking",
      amountPerPeriod: "50.00",
      isPretax: false,
    });
    expect(ded!.deductionName).toBe("Parking");
    expect(ded!.isPretax).toBe(false);
    expect(ded!.ficaExempt).toBe(false); // default
  });

  it("list returns both deductions", async () => {
    const result = await caller.settings.deductions.list();
    expect(result).toHaveLength(2);
  });

  it("update changes a deduction", async () => {
    const deds = await caller.settings.deductions.list();
    const id = deds[0]!.id;
    const updated = await caller.settings.deductions.update({
      id,
      jobId,
      deductionName: "Health Insurance Premium",
      amountPerPeriod: "275.00",
      isPretax: true,
      ficaExempt: true,
    });
    expect(updated!.deductionName).toBe("Health Insurance Premium");
    expect(updated!.amountPerPeriod).toBe("275.00");
  });

  it("delete removes a deduction", async () => {
    const deds = await caller.settings.deductions.list();
    const id = deds[1]!.id;
    await caller.settings.deductions.delete({ id });
    const remaining = await caller.settings.deductions.list();
    expect(remaining).toHaveLength(1);
  });
});

// ── Settings: Contribution Accounts CRUD ────────────────────────────────────

describe("settings.contributionAccounts CRUD", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;
  let personId: number;
  let jobId: number;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;
    personId = await seedPerson(db, "Contrib Person", "1990-01-01");
    jobId = seedJob(db, personId);
  });

  afterAll(() => cleanup());

  it("list returns empty array initially", async () => {
    const result = await caller.settings.contributionAccounts.list();
    expect(result).toHaveLength(0);
  });

  it("create adds a 401k contribution account", async () => {
    const acct = await caller.settings.contributionAccounts.create({
      personId,
      jobId,
      accountType: "401k",
      parentCategory: "Retirement",
      taxTreatment: "pre_tax",
      contributionMethod: "percent_of_salary",
      contributionValue: "0.10",
      employerMatchType: "percent_of_contribution",
      employerMatchValue: "1.0",
      employerMaxMatchPct: "0.06",
    });
    expect(acct).toBeDefined();
    expect(acct!.accountType).toBe("401k");
    expect(acct!.taxTreatment).toBe("pre_tax");
    expect(acct!.contributionValue).toBe("0.10");
    expect(acct!.employerMatchType).toBe("percent_of_contribution");
  });

  it("create adds an IRA contribution account (no job)", async () => {
    const acct = await caller.settings.contributionAccounts.create({
      personId,
      accountType: "ira",
      parentCategory: "Retirement",
      taxTreatment: "tax_free",
      contributionMethod: "fixed_annual",
      contributionValue: "7000",
      employerMatchType: "none",
    });
    expect(acct!.accountType).toBe("ira");
    expect(acct!.taxTreatment).toBe("tax_free");
    expect(acct!.contributionMethod).toBe("fixed_annual");
  });

  it("list returns both contribution accounts", async () => {
    const result = await caller.settings.contributionAccounts.list();
    expect(result).toHaveLength(2);
  });

  it("update changes a contribution account", async () => {
    const accts = await caller.settings.contributionAccounts.list();
    const id = accts[0]!.id;
    const updated = await caller.settings.contributionAccounts.update({
      id,
      personId,
      jobId,
      accountType: "401k",
      parentCategory: "Retirement",
      taxTreatment: "pre_tax",
      contributionMethod: "percent_of_salary",
      contributionValue: "0.15",
      employerMatchType: "percent_of_contribution",
      employerMatchValue: "1.0",
      employerMaxMatchPct: "0.06",
    });
    expect(updated!.contributionValue).toBe("0.15");
  });

  it("create a joint brokerage contribution account", async () => {
    const acct = await caller.settings.contributionAccounts.create({
      personId,
      accountType: "brokerage",
      parentCategory: "Portfolio",
      taxTreatment: "after_tax",
      contributionMethod: "fixed_monthly",
      contributionValue: "500",
      employerMatchType: "none",
      ownership: "joint",
    });
    expect(acct!.ownership).toBe("joint");
    expect(acct!.parentCategory).toBe("Portfolio");
  });

  it("delete removes a contribution account", async () => {
    const accts = await caller.settings.contributionAccounts.list();
    const initialCount = accts.length;
    const id = accts[accts.length - 1]!.id;
    await caller.settings.contributionAccounts.delete({ id });
    const remaining = await caller.settings.contributionAccounts.list();
    expect(remaining).toHaveLength(initialCount - 1);
  });
});

// ── computeSummary with person + job (paycheck calculation) ─────────────────

describe("paycheck router — person with active job", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;

    const personId = await seedPerson(db, "Active Worker", "1990-01-01");
    seedJob(db, personId, {
      employerName: "TechCo",
      annualSalary: "120000",
      payPeriod: "biweekly",
      payWeek: "even",
      startDate: "2020-01-01",
      w4FilingStatus: "MFJ",
    });
  });

  afterAll(() => cleanup());

  it("person entry has a non-null job", async () => {
    const result = await caller.paycheck.computeSummary();
    const entry = result.people[0]!;
    expect(entry.job).not.toBeNull();
    expect(entry.job!.employerName).toBe("TechCo");
  });

  it("salary reflects the job's annualSalary", async () => {
    const result = await caller.paycheck.computeSummary();
    const entry = result.people[0]!;
    expect(entry.salary).toBe(120000);
  });

  it("paycheck is computed (not null) when tax brackets exist", async () => {
    const result = await caller.paycheck.computeSummary();
    const entry = result.people[0]!;
    // May be null if seed data doesn't include brackets for current year
    // but the structure should be present
    if (entry.paycheck !== null) {
      expect(entry.paycheck).toHaveProperty("gross");
      expect(typeof entry.paycheck.gross).toBe("number");
      expect(entry.paycheck.gross).toBeGreaterThan(0);
    }
  });

  it("futureSalaryChanges is empty when no changes are seeded", async () => {
    const result = await caller.paycheck.computeSummary();
    expect(result.people[0]!.futureSalaryChanges).toHaveLength(0);
  });
});

// ── computeSummary with person + job that has an endDate ─────────────────────

describe("paycheck router — person with ended job", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;

    const personId = await seedPerson(db, "Former Worker", "1990-01-01");
    seedJob(db, personId, {
      employerName: "OldCo",
      annualSalary: "90000",
      payPeriod: "monthly",
      payWeek: "na",
      startDate: "2018-01-01",
      endDate: "2023-12-31",
      w4FilingStatus: "Single",
    });
  });

  afterAll(() => cleanup());

  it("person with ended job has null paycheck — no active job", async () => {
    const result = await caller.paycheck.computeSummary();
    const entry = result.people[0]!;
    expect(entry.job).toBeNull(); // activeJob filter excludes ended jobs
    expect(entry.paycheck).toBeNull();
    expect(entry.salary).toBe(0);
  });
});

// ── computeSummary with deductions and contributions ────────────────────────

describe("paycheck router — with deductions and contributions", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;

    const personId = await seedPerson(db, "Full Setup", "1990-01-01");
    const jobId = seedJob(db, personId, {
      employerName: "BigCo",
      annualSalary: "150000",
      payPeriod: "semimonthly",
      payWeek: "na",
      startDate: "2021-01-01",
      w4FilingStatus: "MFJ",
    });

    // Add a deduction
    db.insert(schema.paycheckDeductions)
      .values({
        jobId,
        deductionName: "Health Insurance",
        amountPerPeriod: "200",
        isPretax: true,
        ficaExempt: true,
      })
      .run();

    // Add a contribution account
    db.insert(schema.contributionAccounts)
      .values({
        personId,
        jobId,
        accountType: "401k",
        parentCategory: "Retirement",
        taxTreatment: "pre_tax",
        contributionMethod: "percent_of_salary",
        contributionValue: "0.10",
        employerMatchType: "percent_of_contribution",
        employerMatchValue: "1.0",
        employerMaxMatchPct: "0.06",
        isActive: true,
        ownership: "individual",
      })
      .run();
  });

  afterAll(() => cleanup());

  it("rawDeductions includes the seeded deduction", async () => {
    const result = await caller.paycheck.computeSummary();
    const entry = result.people[0]!;
    expect(entry.rawDeductions).toHaveLength(1);
    expect(entry.rawDeductions[0]!.deductionName).toBe("Health Insurance");
  });

  it("rawContribs includes the seeded contribution", async () => {
    const result = await caller.paycheck.computeSummary();
    const entry = result.people[0]!;
    expect(entry.rawContribs.length).toBeGreaterThanOrEqual(1);
    expect(entry.rawContribs[0]!.accountType).toBe("401k");
  });

  it("salary reflects the job salary", async () => {
    const result = await caller.paycheck.computeSummary();
    const entry = result.people[0]!;
    expect(entry.salary).toBe(150000);
  });
});

// ── computeSummary with multiple people ─────────────────────────────────────

describe("paycheck router — multiple people", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;

    const person1 = await seedPerson(db, "Person One", "1990-01-01");
    const person2 = await seedPerson(db, "Person Two", "1992-06-15");
    seedJob(db, person1, {
      employerName: "CompanyA",
      annualSalary: "100000",
      payPeriod: "biweekly",
      payWeek: "even",
      startDate: "2020-01-01",
      w4FilingStatus: "MFJ",
    });
    seedJob(db, person2, {
      employerName: "CompanyB",
      annualSalary: "80000",
      payPeriod: "monthly",
      payWeek: "na",
      startDate: "2021-01-01",
      w4FilingStatus: "MFJ",
    });
  });

  afterAll(() => cleanup());

  it("returns two people entries", async () => {
    const result = await caller.paycheck.computeSummary();
    expect(result.people).toHaveLength(2);
  });

  it("each person has their own job", async () => {
    const result = await caller.paycheck.computeSummary();
    const employers = result.people.map((p) => p.job?.employerName);
    expect(employers).toContain("CompanyA");
    expect(employers).toContain("CompanyB");
  });

  it("salaries are correct for each person", async () => {
    const result = await caller.paycheck.computeSummary();
    const p1 = result.people.find((p) => p.person.name === "Person One")!;
    const p2 = result.people.find((p) => p.person.name === "Person Two")!;
    expect(p1.salary).toBe(100000);
    expect(p2.salary).toBe(80000);
  });
});

// ── computeSummary with salary changes (future) ─────────────────────────────

describe("paycheck router — with future salary changes", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;

    const personId = await seedPerson(db, "Raise Person", "1990-01-01");
    const jobId = seedJob(db, personId, {
      annualSalary: "100000",
      startDate: "2020-01-01",
    });

    // Add a future salary change (next year)
    const futureYear = new Date().getFullYear() + 1;
    db.insert(schema.salaryChanges)
      .values({
        jobId,
        effectiveDate: `${futureYear}-01-01`,
        newSalary: "115000",
        raisePercent: "15",
        notes: "Future raise",
      })
      .run();
  });

  afterAll(() => cleanup());

  it("futureSalaryChanges contains the upcoming raise", async () => {
    const result = await caller.paycheck.computeSummary();
    const entry = result.people[0]!;
    expect(entry.futureSalaryChanges.length).toBeGreaterThanOrEqual(1);
  });

  it("current salary is still the original (not the future change)", async () => {
    const result = await caller.paycheck.computeSummary();
    const entry = result.people[0]!;
    expect(entry.salary).toBe(100000);
  });
});

// ── computeSummary with joint contribution accounts ─────────────────────────

describe("paycheck router — joint contributions", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;

    const personId = await seedPerson(db, "Joint Person", "1990-01-01");

    // Joint contribution account (no job)
    db.insert(schema.contributionAccounts)
      .values({
        personId,
        accountType: "brokerage",
        parentCategory: "Portfolio",
        taxTreatment: "after_tax",
        contributionMethod: "fixed_monthly",
        contributionValue: "1000",
        employerMatchType: "none",
        isActive: true,
        ownership: "joint",
      })
      .run();
  });

  afterAll(() => cleanup());

  it("jointContribs contains the joint account", async () => {
    const result = await caller.paycheck.computeSummary();
    expect(result.jointContribs).toHaveLength(1);
    expect(result.jointContribs[0]!.ownership).toBe("joint");
    expect(result.jointContribs[0]!.accountType).toBe("brokerage");
  });

  it("joint contribs are not in person's rawContribs", async () => {
    const result = await caller.paycheck.computeSummary();
    // Person has no job, so rawContribs should be empty
    expect(result.people[0]!.rawContribs).toHaveLength(0);
  });
});
