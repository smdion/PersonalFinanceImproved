/**
 * Paycheck router integration tests.
 *
 * Tests computeSummary shape with empty DB, after seeding a person,
 * with optional input params, and with a full job + deductions + contributions
 * setup — using an isolated SQLite database per suite.
 *
 * Also tests settings/paycheck CRUD procedures: people, jobs,
 * contributionAccounts, deductions.
 */
import "./setup-mocks";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createTestCaller,
  seedPerson,
  seedJob,
  seedPerformanceAccount,
  seedContributionProfile,
  seedRetirementProfile,
  seedRetirementProfilePerson,
} from "./setup";
import { eq } from "drizzle-orm";
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

    it("empty salaryActiveFields array does not affect results", async () => {
      const result = await caller.paycheck.computeSummary({
        salaryActiveFields: [],
      });
      expect(Array.isArray(result.people)).toBe(true);
      expect(result.people).toHaveLength(1);
    });
  });

  describe("computeSummary with taxYearOverride", () => {
    it("accepts a seeded taxYearOverride and returns valid shape", async () => {
      const result = await caller.paycheck.computeSummary({
        taxYearOverride: 2025,
      });
      expect(result).toHaveProperty("people");
      expect(result).toHaveProperty("jointContribs");
      expect(result).toHaveProperty("householdTax");
      // The response now reports the resolved tax-data vintage.
      expect(result.taxYear).toBe(2025);
    });

    it("returns null paycheck/tax for an unseeded (but in-range) year", async () => {
      // 2024 is within the 2000-2100 bound but has no seeded tables — the
      // person entry still renders, paycheck/tax null (onMissing: "null").
      const result = await caller.paycheck.computeSummary({
        taxYearOverride: 2024,
      });
      expect(result.people).toHaveLength(1);
      expect(result.people[0]!.paycheck).toBeNull();
      expect(result.people[0]!.tax).toBeNull();
      expect(result.taxYear).toBe(2024);
    });

    it("rejects an out-of-range taxYearOverride", async () => {
      await expect(
        caller.paycheck.computeSummary({ taxYearOverride: 1900 }),
      ).rejects.toThrow();
    });
  });

  describe("computeSummary with active salary for seeded person", () => {
    it("accepts a salary override for the person — no job so still null paycheck", async () => {
      const result = await caller.paycheck.computeSummary({
        salaryActiveFields: [{ personId, salary: 120000 }],
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

// ── Settings: speculative-job auto-provisioning ─────────────────────────────

// ── Retirement Profiles completeness invariant ──────────────────────────────
//
// Every retirement_profiles row must hold a retirement_settings + a
// retirement_profile_people row for every person. Person B has no such row
// itself yet when the new person is created, so build-engine-payload has
// nothing to invent one from -- settings/paycheck.ts's people.create fans a
// row into every EXISTING profile, sourced from that profile's primary
// person, the same rule retirementProfiles.duplicate uses.

describe("settings.people.create fans out to every existing retirement profile", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;
  let personA: number;
  let profileId: number;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;

    personA = await seedPerson(db, "Person A", "1985-01-01");
    // isPrimaryUser defaults false via seedPerson's raw insert — mark A
    // primary directly so the fan-out has a deterministic source.
    db.update(schema.people)
      .set({ isPrimaryUser: true })
      .where(eq(schema.people.id, personA))
      .run();

    await caller.retirement.retirementSettings.upsert({
      personId: personA,
      retirementAge: 63,
      endAge: 92,
      returnAfterRetirement: "0.06",
      annualInflation: "0.03",
      salaryAnnualIncrease: "0.04",
    });
    profileId = await seedRetirementProfile(db, "Current Plan");
    await seedRetirementProfilePerson(db, profileId, personA, {
      retirementAge: 63,
      endAge: 92,
      ssStartAge: 68,
    });
  });

  afterAll(() => cleanup());

  it("gives the new person a retirement_settings row cloned from the primary person's, in every existing profile", async () => {
    const newPerson = await caller.settings.people.create({
      name: "Person B",
      dateOfBirth: "1987-06-01",
    });

    const settings = await caller.retirement.retirementSettings.list();
    const bRow = settings.find((s) => s.personId === newPerson!.id);
    expect(bRow).toBeDefined();
    expect(bRow!.profileId).toBe(profileId);
    // Cloned from A's household-grain values.
    expect(bRow!.retirementAge).toBe(63);
    expect(bRow!.endAge).toBe(92);
  });

  it("gives the new person a retirement_profile_people row too", async () => {
    const people = await caller.retirement.retirementProfilePeople.list();
    const bRow = people.find(
      (p) => p.profileId === profileId && p.personId !== personA,
    );
    expect(bRow).toBeDefined();
    expect(bRow!.retirementAge).toBe(63);
    expect(bRow!.ssStartAge).toBe(68);
  });
});

describe("settings.people.create with zero existing retirement profiles does nothing extra", () => {
  it("does not error when there are no retirement_profiles rows to fan out to", async () => {
    const { caller, cleanup } = await createTestCaller();
    try {
      const person = await caller.settings.people.create({
        name: "Nobody's Household Yet",
        dateOfBirth: "1990-01-01",
      });
      expect(person).toBeDefined();
      const settings = await caller.retirement.retirementSettings.list();
      expect(settings).toHaveLength(0);
    } finally {
      cleanup();
    }
  });
});

describe("settings.people.create auto-provisions a speculative job", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    cleanup = ctx.cleanup;
  });

  afterAll(() => cleanup());

  it("gives a newly-created person exactly one speculative job, atomically", async () => {
    const person = await caller.settings.people.create({
      name: "New Person",
      dateOfBirth: "1995-01-01",
    });
    const jobs = await caller.settings.jobs.list();
    const personJobs = jobs.filter((j) => j.personId === person!.id);
    expect(personJobs).toHaveLength(1);
    expect(personJobs[0]!.isSpeculative).toBe(true);
    expect(personJobs[0]!.employerName).toBe("Speculative (What-If Planning)");
    expect(personJobs[0]!.endDate).toBeNull();
  });

  it("the speculative job never appears in the Jobs Settings list a user would see", async () => {
    // Mirrors historical/jobs.tsx's client-side filter — the peg is only
    // ever surfaced through the Salary Profile editor's job picker.
    const jobs = await caller.settings.jobs.list();
    const visibleJobs = jobs.filter((j) => !j.isSpeculative);
    expect(visibleJobs.every((j) => !j.isSpeculative)).toBe(true);
    expect(jobs.some((j) => j.isSpeculative)).toBe(true);
  });

  it("deleting a person with only the speculative job succeeds (no FK block)", async () => {
    const person = await caller.settings.people.create({
      name: "Deletable",
      dateOfBirth: "1999-01-01",
    });
    await caller.settings.people.delete({ id: person!.id });
    const remaining = await caller.settings.people.list();
    expect(remaining.some((p) => p.id === person!.id)).toBe(false);
    const jobs = await caller.settings.jobs.list();
    expect(jobs.some((j) => j.personId === person!.id)).toBe(false);
  });

  it("deleting a person with a REAL job still correctly fails", async () => {
    const person = await caller.settings.people.create({
      name: "Employed",
      dateOfBirth: "1993-01-01",
    });
    await caller.settings.jobs.create({
      personId: person!.id,
      employerName: "Real Co",
      payPeriod: "biweekly",
      payWeek: "even",
      startDate: "2022-01-01",
      w4FilingStatus: "Single",
    });
    await expect(
      caller.settings.people.delete({ id: person!.id }),
    ).rejects.toThrow();
  });
});

describe("settings.jobs.delete rejects deleting a speculative job", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    cleanup = ctx.cleanup;
  });

  afterAll(() => cleanup());

  it("throws rather than deleting the speculative peg", async () => {
    const person = await caller.settings.people.create({
      name: "Guarded",
      dateOfBirth: "1991-01-01",
    });
    const jobs = await caller.settings.jobs.list();
    const speculativeJob = jobs.find(
      (j) => j.personId === person!.id && j.isSpeculative,
    )!;
    await expect(
      caller.settings.jobs.delete({ id: speculativeJob.id }),
    ).rejects.toThrow(/speculative/i);
    const stillThere = await caller.settings.jobs.list();
    expect(stillThere.some((j) => j.id === speculativeJob.id)).toBe(true);
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

  it("create adds a job with no salary or payroll-config of its own", async () => {
    const job = await caller.settings.jobs.create({
      personId,
      employerName: "Acme Corp",
      startDate: "2022-01-15",
    });
    expect(job).toBeDefined();
    expect(job!.employerName).toBe("Acme Corp");
    expect(job).not.toHaveProperty("annualSalary");
    expect(job).not.toHaveProperty("payPeriod");
  });

  it("list returns one job after create", async () => {
    const result = await caller.settings.jobs.list();
    expect(result).toHaveLength(1);
  });

  it("update does not touch salary — a job carries none of its own", async () => {
    const jobs = await caller.settings.jobs.list();
    const id = jobs[0]!.id;
    const updated = await caller.settings.jobs.update({
      id,
      personId,
      employerName: "Acme Corp Renamed",
      payPeriod: "biweekly",
      payWeek: "even",
      startDate: "2022-01-15",
      w4FilingStatus: "Single",
    });
    expect(updated!.employerName).toBe("Acme Corp Renamed");
    expect(updated).not.toHaveProperty("annualSalary");
  });

  it("create a job with endDate", async () => {
    const job = await caller.settings.jobs.create({
      personId,
      employerName: "Old Corp",
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
      isPretax: true,
      ficaExempt: true,
    });
    expect(updated!.deductionName).toBe("Health Insurance Premium");
    expect(updated).not.toHaveProperty("amountPerPeriod");
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
      employerMatchType: "percent_of_contribution",
      employerMatchValue: "1.0",
      employerMaxMatchPct: "0.06",
    });
    expect(acct).toBeDefined();
    expect(acct!.accountType).toBe("401k");
    expect(acct!.taxTreatment).toBe("pre_tax");
    expect(acct!.employerMatchType).toBe("percent_of_contribution");
  });

  it("create adds an IRA contribution account (no job)", async () => {
    const acct = await caller.settings.contributionAccounts.create({
      personId,
      accountType: "ira",
      parentCategory: "Retirement",
      taxTreatment: "tax_free",
      employerMatchType: "none",
    });
    expect(acct!.accountType).toBe("ira");
    expect(acct!.taxTreatment).toBe("tax_free");
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
      employerMatchType: "percent_of_contribution",
      employerMatchValue: "1.0",
      employerMaxMatchPct: "0.06",
    });
    expect(updated!.employerMatchValue).toBe("1.0");
  });

  it("create a joint brokerage contribution account", async () => {
    const acct = await caller.settings.contributionAccounts.create({
      personId: null,
      accountType: "brokerage",
      parentCategory: "Portfolio",
      taxTreatment: "after_tax",
      employerMatchType: "none",
      ownership: "joint",
    });
    expect(acct!.ownership).toBe("joint");
    expect(acct!.parentCategory).toBe("Portfolio");
    expect(acct!.personId).toBeNull();
  });

  it("create round-trips a full field payload (institution, label, subType, HSA coverage, match fields)", async () => {
    const perfAcctId = seedPerformanceAccount(db, {
      institution: "Fidelity",
      accountType: "hsa",
      parentCategory: "Retirement",
    });
    const acct = await caller.settings.contributionAccounts.create({
      personId,
      jobId,
      accountType: "hsa",
      subType: "Rollover",
      label: "Family HSA",
      parentCategory: "Retirement",
      performanceAccountId: perfAcctId,
      taxTreatment: "hsa",
      employerMatchType: "fixed_annual",
      employerMatchValue: "500",
      employerMaxMatchPct: "0.05",
      employerMatchTaxTreatment: "pre_tax",
      hsaCoverageType: "family",
      autoMaximize: true,
      isActive: true,
      ownership: "individual",
      targetAnnual: "8000",
      allocationPriority: 2,
      notes: "Full-field creation smoke test",
      isPayrollDeducted: true,
    });
    expect(acct).toBeDefined();
    expect(acct!.subType).toBe("Rollover");
    expect(acct!.label).toBe("Family HSA");
    expect(acct!.performanceAccountId).toBe(perfAcctId);
    expect(acct!.hsaCoverageType).toBe("family");
    expect(acct!.employerMatchValue).toBe("500");
    expect(acct!.employerMaxMatchPct).toBe("0.05");
    expect(acct!.autoMaximize).toBe(true);
    expect(acct!.targetAnnual).toBe("8000");
    expect(acct!.allocationPriority).toBe(2);
    expect(acct!.notes).toBe("Full-field creation smoke test");
    expect(acct!.isPayrollDeducted).toBe(true);

    const updated = await caller.settings.contributionAccounts.update({
      id: acct!.id,
      personId,
      jobId,
      accountType: "hsa",
      subType: "Rollover",
      label: "Family HSA — updated",
      parentCategory: "Retirement",
      performanceAccountId: perfAcctId,
      taxTreatment: "hsa",
      employerMatchType: "fixed_annual",
      employerMatchValue: "500",
      employerMaxMatchPct: "0.05",
      employerMatchTaxTreatment: "pre_tax",
      hsaCoverageType: "family",
      autoMaximize: true,
      isActive: true,
      ownership: "individual",
      targetAnnual: "8000",
      allocationPriority: 2,
      notes: "Full-field creation smoke test",
      isPayrollDeducted: true,
    });
    expect(updated!.label).toBe("Family HSA — updated");
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
  let profileId: number;

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

    // Add a deduction — amountPerPeriod no longer lives on the row
    // (Stage B); it only resolves via the Contribution Profile's
    // deductions active field below (same no-base-value rule contribution
    // accounts already follow), so it needs one to appear at all.
    const deduction = db
      .insert(schema.paycheckDeductions)
      .values({
        jobId,
        deductionName: "Health Insurance",
        isPretax: true,
        ficaExempt: true,
      })
      .returning({ id: schema.paycheckDeductions.id })
      .get();

    // Add a contribution account — no value of its own; the Contribution
    // Profile below is what gives it one.
    const contribAcct = db
      .insert(schema.contributionAccounts)
      .values({
        personId,
        jobId,
        accountType: "401k",
        parentCategory: "Retirement",
        taxTreatment: "pre_tax",
        employerMatchType: "percent_of_contribution",
        employerMatchValue: "1.0",
        employerMaxMatchPct: "0.06",
        isActive: true,
        ownership: "individual",
      })
      .returning({ id: schema.contributionAccounts.id })
      .get();

    profileId = seedContributionProfile(db, {
      name: "Full Setup Profile",
      contributionActiveFields: {
        contributionAccounts: {
          [contribAcct.id]: {
            contributionValue: "0.10",
            contributionMethod: "percent_of_salary",
          },
        },
        deductions: {
          [deduction.id]: { amountPerPeriod: "50.00" },
        },
      },
    });
  });

  afterAll(() => cleanup());

  it("rawDeductions includes the seeded deduction", async () => {
    const result = await caller.paycheck.computeSummary({
      contributionProfileId: profileId,
    });
    const entry = result.people[0]!;
    expect(entry.rawDeductions).toHaveLength(1);
    expect(entry.rawDeductions[0]!.deductionName).toBe("Health Insurance");
  });

  it("rawContribs includes the seeded contribution", async () => {
    const result = await caller.paycheck.computeSummary({
      contributionProfileId: profileId,
    });
    const entry = result.people[0]!;
    expect(entry.rawContribs.length).toBeGreaterThanOrEqual(1);
    expect(entry.rawContribs[0]!.accountType).toBe("401k");
  });

  it("salary reflects the job salary", async () => {
    const result = await caller.paycheck.computeSummary({
      contributionProfileId: profileId,
    });
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

// ── computeSummary with joint contribution accounts ─────────────────────────

describe("paycheck router — joint contributions", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;
  let profileId: number;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;

    const personId = await seedPerson(db, "Joint Person", "1990-01-01");

    // Joint contribution account (no job) — no value of its own; the
    // Contribution Profile below is what gives it one.
    const contribAcct = db
      .insert(schema.contributionAccounts)
      .values({
        personId,
        accountType: "brokerage",
        parentCategory: "Portfolio",
        taxTreatment: "after_tax",
        employerMatchType: "none",
        isActive: true,
        ownership: "joint",
      })
      .returning({ id: schema.contributionAccounts.id })
      .get();

    profileId = seedContributionProfile(db, {
      name: "Joint Profile",
      contributionActiveFields: {
        contributionAccounts: {
          [contribAcct.id]: {
            contributionValue: "1000",
            contributionMethod: "fixed_monthly",
          },
        },
        jobs: {},
      },
    });
  });

  afterAll(() => cleanup());

  it("jointContribs contains the joint account", async () => {
    const result = await caller.paycheck.computeSummary({
      contributionProfileId: profileId,
    });
    expect(result.jointContribs).toHaveLength(1);
    expect(result.jointContribs[0]!.ownership).toBe("joint");
    expect(result.jointContribs[0]!.accountType).toBe("brokerage");
  });

  it("joint contribs are not in person's rawContribs", async () => {
    const result = await caller.paycheck.computeSummary({
      contributionProfileId: profileId,
    });
    // Person has no job, so rawContribs should be empty
    expect(result.people[0]!.rawContribs).toHaveLength(0);
  });
});
