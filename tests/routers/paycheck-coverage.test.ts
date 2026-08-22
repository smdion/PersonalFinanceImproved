/**
 * Additional paycheck settings router tests for branch coverage.
 *
 * Covers:
 *   - contributionAccounts.create with performanceAccountId (auto-stub creation)
 *   - contributionAccounts.create without performanceAccountId (no stubs)
 *   - contributionAccounts.update with priorYearContribAmount validation
 *   - contributionAccounts.update with performanceAccountId (parent category sync)
 *   - contributionAccounts.setPriorYearAmount — valid and invalid account types
 *   - Job create/update with optional fields (title, anchorPayDate, bonusOverride, etc.)
 */
import "./setup-mocks";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestCaller, seedPerson, seedPerformanceAccount } from "./setup";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type * as sqliteSchema from "@/lib/db/schema-sqlite";

// ── contributionAccounts.create with performanceAccountId ────────────────

describe("settings.contributionAccounts — performanceAccountId-linked create", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;
  let personId: number;
  let perfAcctId: number;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;
    personId = await seedPerson(db, "PerfAcct Person", "1990-01-01");
    perfAcctId = seedPerformanceAccount(db, {
      accountType: "401k",
      parentCategory: "Retirement",
    });
  });

  afterAll(() => cleanup());

  it("syncs parentCategory from performanceAccount and creates inactive stubs", async () => {
    const acct = await caller.settings.contributionAccounts.create({
      personId,
      accountType: "401k",
      taxTreatment: "pre_tax",
      employerMatchType: "none",
      performanceAccountId: perfAcctId,
      parentCategory: "Portfolio", // should be overridden by perf account's Retirement
    });

    expect(acct).toBeDefined();
    // parentCategory synced from performanceAccount
    expect(acct!.parentCategory).toBe("Retirement");

    // Should auto-create stub for the other supported tax treatment (tax_free for 401k)
    const allAccts = await caller.settings.contributionAccounts.list();
    const linkedAccts = allAccts.filter(
      (a) => a.performanceAccountId === perfAcctId,
    );
    // Should have 2: the one we created (pre_tax) + auto-stub (tax_free)
    expect(linkedAccts.length).toBe(2);
    const stub = linkedAccts.find((a) => a.taxTreatment === "tax_free");
    expect(stub).toBeDefined();
    expect(stub!.isActive).toBe(false);
  });
});

// ── contributionAccounts.create without performanceAccountId ─────────────

describe("settings.contributionAccounts — no performanceAccountId", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;
  let personId: number;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;
    personId = await seedPerson(db, "No PerfAcct", "1990-01-01");
  });

  afterAll(() => cleanup());

  it("does not create stubs when no performanceAccountId", async () => {
    const acct = await caller.settings.contributionAccounts.create({
      personId,
      accountType: "brokerage",
      taxTreatment: "after_tax",
      contributionMethod: "fixed_monthly",
      contributionValue: "500",
      employerMatchType: "none",
      parentCategory: "Portfolio",
    });

    expect(acct).toBeDefined();
    expect(acct!.parentCategory).toBe("Portfolio");

    // Only 1 account, no stubs
    const allAccts = await caller.settings.contributionAccounts.list();
    expect(allAccts).toHaveLength(1);
  });
});

// ── contributionAccounts.update — priorYearContribAmount validation ──────

describe("settings.contributionAccounts — update priorYearContrib validation", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;
  let personId: number;
  let acctId401k: number;
  let acctIdIra: number;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;
    personId = await seedPerson(db, "PriorYear Person", "1990-01-01");

    // Create a 401k account (does NOT support prior year contrib)
    const acct401k = await caller.settings.contributionAccounts.create({
      personId,
      accountType: "401k",
      taxTreatment: "pre_tax",
      contributionMethod: "percent_of_salary",
      contributionValue: "0.10",
      employerMatchType: "none",
    });
    acctId401k = acct401k!.id;

    // Create an IRA account (supports prior year contrib)
    const acctIra = await caller.settings.contributionAccounts.create({
      personId,
      accountType: "ira",
      taxTreatment: "tax_free",
      contributionMethod: "fixed_annual",
      contributionValue: "7000",
      employerMatchType: "none",
    });
    acctIdIra = acctIra!.id;
  });

  afterAll(() => cleanup());

  it("throws when setting priorYearContribAmount on 401k (unsupported)", async () => {
    await expect(
      caller.settings.contributionAccounts.update({
        id: acctId401k,
        personId,
        accountType: "401k",
        taxTreatment: "pre_tax",
        contributionMethod: "percent_of_salary",
        contributionValue: "0.10",
        employerMatchType: "none",
        priorYearContribAmount: "5000",
      }),
    ).rejects.toThrow(/prior-year contributions are not supported/i);
  });

  it("allows priorYearContribAmount on IRA (supported)", async () => {
    const updated = await caller.settings.contributionAccounts.update({
      id: acctIdIra,
      personId,
      accountType: "ira",
      taxTreatment: "tax_free",
      contributionMethod: "fixed_annual",
      contributionValue: "7000",
      employerMatchType: "none",
      priorYearContribAmount: "3000",
    });
    expect(updated!.priorYearContribAmount).toBe("3000");
  });
});

// ── contributionAccounts.update — performanceAccountId sync ──────────────

describe("settings.contributionAccounts — update with performanceAccountId", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;
  let personId: number;
  let perfAcctId: number;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;
    personId = await seedPerson(db, "Update Sync", "1990-01-01");
    perfAcctId = seedPerformanceAccount(db, {
      accountType: "brokerage",
      parentCategory: "Portfolio",
    });
  });

  afterAll(() => cleanup());

  it("syncs parentCategory from performanceAccount on update", async () => {
    // Create without linking
    const acct = await caller.settings.contributionAccounts.create({
      personId,
      accountType: "brokerage",
      taxTreatment: "after_tax",
      contributionMethod: "fixed_monthly",
      contributionValue: "500",
      employerMatchType: "none",
      parentCategory: "Retirement", // intentionally wrong
    });

    // Update with performanceAccountId — should sync to Portfolio
    const updated = await caller.settings.contributionAccounts.update({
      id: acct!.id,
      personId,
      accountType: "brokerage",
      taxTreatment: "after_tax",
      contributionMethod: "fixed_monthly",
      contributionValue: "500",
      employerMatchType: "none",
      performanceAccountId: perfAcctId,
    });
    expect(updated!.parentCategory).toBe("Portfolio");
  });

  it("reads existing performanceAccountId when not provided in update input", async () => {
    // Create linked to a performance account
    const acct = await caller.settings.contributionAccounts.create({
      personId,
      accountType: "brokerage",
      taxTreatment: "after_tax",
      employerMatchType: "none",
      performanceAccountId: perfAcctId,
    });

    // Update without specifying performanceAccountId — should still sync from existing link
    const updated = await caller.settings.contributionAccounts.update({
      id: acct!.id,
      personId,
      accountType: "brokerage",
      taxTreatment: "after_tax",
      employerMatchType: "none",
      // no performanceAccountId
    });
    expect(updated!.parentCategory).toBe("Portfolio");
  });
});

// ── contributionAccounts.setPriorYearAmount ──────────────────────────────

describe("settings.contributionAccounts.setPriorYearAmount", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;
  let personId: number;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;
    personId = await seedPerson(db, "SetPriorYear Person", "1990-01-01");
  });

  afterAll(() => cleanup());

  it("sets priorYearContribAmount for IRA account", async () => {
    const acct = await caller.settings.contributionAccounts.create({
      personId,
      accountType: "ira",
      taxTreatment: "pre_tax",
      contributionMethod: "fixed_annual",
      contributionValue: "7000",
      employerMatchType: "none",
    });

    const result =
      await caller.settings.contributionAccounts.setPriorYearAmount({
        id: acct!.id,
        priorYearContribAmount: "2500",
      });

    expect(result).toBeDefined();
    expect(result!.priorYearContribAmount).toBe("2500");
    expect(result!.priorYearContribYear).toBe(new Date().getFullYear() - 1);
  });

  it("sets priorYearContribAmount for HSA account", async () => {
    const acct = await caller.settings.contributionAccounts.create({
      personId,
      accountType: "hsa",
      taxTreatment: "hsa",
      contributionMethod: "fixed_annual",
      contributionValue: "4150",
      employerMatchType: "none",
    });

    const result =
      await caller.settings.contributionAccounts.setPriorYearAmount({
        id: acct!.id,
        priorYearContribAmount: "1000",
      });

    expect(result!.priorYearContribAmount).toBe("1000");
  });

  it("throws for 401k (unsupported prior year)", async () => {
    const acct = await caller.settings.contributionAccounts.create({
      personId,
      accountType: "401k",
      taxTreatment: "pre_tax",
      contributionMethod: "percent_of_salary",
      contributionValue: "0.10",
      employerMatchType: "none",
    });

    await expect(
      caller.settings.contributionAccounts.setPriorYearAmount({
        id: acct!.id,
        priorYearContribAmount: "5000",
      }),
    ).rejects.toThrow(/prior-year contributions are not supported/i);
  });

  it("throws for non-existent contribution account", async () => {
    await expect(
      caller.settings.contributionAccounts.setPriorYearAmount({
        id: 99999,
        priorYearContribAmount: "100",
      }),
    ).rejects.toThrow(/not found/i);
  });
});

// ── Jobs with optional fields ────────────────────────────────────────────

describe("settings.jobs — optional fields", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;
  let personId: number;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;
    personId = await seedPerson(db, "Optional Fields", "1990-01-01");
  });

  afterAll(() => cleanup());

  it("creates a job with only title/startDate — payroll-config fields moved to the Salary Profile entry", async () => {
    // payPeriod/anchorPayDate/w4*/bonus-date/bonus-flags/
    // budgetPeriodsPerMonth all moved off `jobs` in Stage B — jobs.create's
    // input no longer accepts them at all (stripped, not rejected, since
    // jobInput isn't `.strict()`). See salary-profiles.test.ts for coverage
    // of those 11 fields on a Salary Profile entry instead.
    const job = await caller.settings.jobs.create({
      personId,
      employerName: "FullCo",
      title: "Senior Engineer",
      startDate: "2022-03-01",
    });

    expect(job).toBeDefined();
    expect(job!.title).toBe("Senior Engineer");
    expect(job).not.toHaveProperty("anchorPayDate");
    expect(job).not.toHaveProperty("w4FilingStatus");
  });
});
