/**
 * Tax Buckets router integration tests — computeBreakdown, updateRothBasis,
 * batchUpdateRothBasis, updateSeparationDate.
 */
import "./setup-mocks";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createTestCaller,
  seedPerson,
  seedJob,
  seedPerformanceAccount,
  seedSnapshot,
  seedContributionAccount,
  adminSession,
  viewerSession,
} from "./setup";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type * as sqliteSchema from "@/lib/db/schema-sqlite";

describe("taxBuckets router", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let viewerCaller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;
  let viewerCleanup: () => void;

  beforeAll(async () => {
    const harness = await createTestCaller(adminSession);
    caller = harness.caller;
    db = harness.db;
    cleanup = harness.cleanup;
    const viewerHarness = await createTestCaller(viewerSession);
    viewerCaller = viewerHarness.caller;
    viewerCleanup = viewerHarness.cleanup;
  });

  afterAll(() => {
    cleanup();
    viewerCleanup();
  });

  it("returns real tax buckets from the latest snapshot, split by owner and tax type", async () => {
    const personId = await seedPerson(db, "Sean", "1987-03-28");
    const perfAcctId = seedPerformanceAccount(db, {
      institution: "Fidelity",
      accountType: "401k",
      ownerPersonId: personId,
      ownershipType: "individual",
    });
    seedSnapshot(db, "2026-01-01", [
      {
        performanceAccountId: perfAcctId,
        amount: "200000",
        taxType: "preTax",
        ownerPersonId: personId,
      },
      {
        performanceAccountId: perfAcctId,
        amount: "90000",
        taxType: "taxFree",
        ownerPersonId: personId,
      },
    ]);

    const result = await caller.taxBuckets.computeBreakdown({
      targetRetirementAges: [{ personId, age: 55 }],
    });

    expect(result.portfolioByTaxType.preTax).toBe(200000);
    expect(result.portfolioByTaxType.taxFree).toBe(90000);
    expect(result.accounts).toHaveLength(2);
    const preTaxEntry = result.accounts.find((a) => a.taxType === "preTax")!;
    expect(preTaxEntry.ownerPersonId).toBe(personId);
    expect(preTaxEntry.balance).toBe(200000);
  });

  it("resolves Rule of 55 from a linked job's real endDate — a dormant former-employer plan stays eligible", async () => {
    const personId = await seedPerson(db, "Joanna", "1960-01-10");
    const perfAcctId = seedPerformanceAccount(db, {
      institution: "Voya",
      accountType: "401k",
      ownerPersonId: personId,
      ownershipType: "individual",
    });
    // Joanna turned 55 in 2015. She separated from this job in 2020 — Rule
    // of 55 applies (permanently, once already separated), even though
    // this isn't her current job by the time we check. endDate must be a
    // real PAST date — resolveSeparationYear only derives from a job that
    // has actually already ended (never a future one, which would mean
    // assuming a not-yet-real separation).
    const jobId = seedJob(db, personId, { endDate: "2020-06-01" });
    seedContributionAccount(db, {
      jobId,
      performanceAccountId: perfAcctId,
      accountType: "401k",
      employerMatchType: "none",
    });
    seedSnapshot(db, "2026-01-02", [
      {
        performanceAccountId: perfAcctId,
        amount: "50000",
        taxType: "preTax",
        ownerPersonId: personId,
      },
    ]);

    const result = await caller.taxBuckets.computeBreakdown();

    const entry = result.accounts.find(
      (a) => a.performanceAccountId === perfAcctId,
    )!;
    expect(entry.ruleOf55?.eligible).toBe(true);
    expect(entry.ruleOf55?.source).toBe("derived");
    expect(entry.ruleOf55?.separationYear).toBe(2020);
  });

  it("updateRothBasis upserts and computeBreakdown reflects it on the next call", async () => {
    const personId = await seedPerson(db, "Basis Test", "1980-01-01");
    const perfAcctId = seedPerformanceAccount(db, {
      institution: "Vanguard",
      accountType: "ira",
      ownerPersonId: personId,
      ownershipType: "individual",
    });
    seedSnapshot(db, "2026-01-03", [
      {
        performanceAccountId: perfAcctId,
        amount: "100000",
        taxType: "taxFree",
        accountType: "ira",
        ownerPersonId: personId,
      },
    ]);

    await caller.taxBuckets.updateRothBasis({
      performanceAccountId: perfAcctId,
      ownerPersonId: personId,
      contributionBasis: "30000",
      conversionBasis: "0",
      latestConversionYear: null,
    });

    const first = await caller.taxBuckets.computeBreakdown({
      targetRetirementAges: [{ personId, age: 55 }],
    });
    const entry1 = first.accounts.find(
      (a) => a.performanceAccountId === perfAcctId,
    )!;
    expect(
      entry1.slices.find((s) => s.label === "Contribution basis")?.amount,
    ).toBe(30000);

    // Upsert again — same (account, owner) key, different amount.
    await caller.taxBuckets.updateRothBasis({
      performanceAccountId: perfAcctId,
      ownerPersonId: personId,
      contributionBasis: "45000",
      conversionBasis: "0",
      latestConversionYear: null,
    });

    const second = await caller.taxBuckets.computeBreakdown({
      targetRetirementAges: [{ personId, age: 55 }],
    });
    const entry2 = second.accounts.find(
      (a) => a.performanceAccountId === perfAcctId,
    )!;
    expect(
      entry2.slices.find((s) => s.label === "Contribution basis")?.amount,
    ).toBe(45000);
  });

  it("updateSeparationDate sets the explicit date, overriding any derived job link", async () => {
    const personId = await seedPerson(db, "Sep Test", "1980-01-01");
    const perfAcctId = seedPerformanceAccount(db, {
      institution: "Fidelity",
      accountType: "401k",
      ownerPersonId: personId,
      ownershipType: "individual",
    });
    seedSnapshot(db, "2026-01-04", [
      {
        performanceAccountId: perfAcctId,
        amount: "10000",
        taxType: "preTax",
        ownerPersonId: personId,
      },
    ]);

    await caller.taxBuckets.updateSeparationDate({
      performanceAccountId: perfAcctId,
      separationDate: "2030-01-01", // person is 50 that year — not Rule-of-55 eligible
    });

    const result = await caller.taxBuckets.computeBreakdown({
      targetRetirementAges: [{ personId, age: 65 }],
    });
    const entry = result.accounts.find(
      (a) => a.performanceAccountId === perfAcctId,
    )!;
    expect(entry.ruleOf55?.source).toBe("explicit");
    expect(entry.ruleOf55?.separationYear).toBe(2030);
    expect(entry.ruleOf55?.eligible).toBe(false);
  });

  it("batchUpdateRothBasis upserts multiple (account, owner) entries in one transaction, computeBreakdown reflects all of them", async () => {
    // Missing test coverage found in code review, 2026-08-27 — this
    // mutation shipped live in the UI's batch-save flow with no test at
    // all, auth or success-path, despite writing financial (tax-basis)
    // figures used by IRS-related calculations.
    const person1Id = await seedPerson(db, "Batch One", "1980-01-01");
    const person2Id = await seedPerson(db, "Batch Two", "1985-01-01");
    const acct1Id = seedPerformanceAccount(db, {
      institution: "Vanguard",
      accountType: "ira",
      ownerPersonId: person1Id,
      ownershipType: "individual",
    });
    const acct2Id = seedPerformanceAccount(db, {
      institution: "Fidelity",
      accountType: "ira",
      ownerPersonId: person2Id,
      ownershipType: "individual",
    });
    seedSnapshot(db, "2026-01-06", [
      {
        performanceAccountId: acct1Id,
        amount: "80000",
        taxType: "taxFree",
        accountType: "ira",
        ownerPersonId: person1Id,
      },
      {
        performanceAccountId: acct2Id,
        amount: "120000",
        taxType: "taxFree",
        accountType: "ira",
        ownerPersonId: person2Id,
      },
    ]);

    const result = await caller.taxBuckets.batchUpdateRothBasis({
      entries: [
        {
          performanceAccountId: acct1Id,
          ownerPersonId: person1Id,
          year: 2026,
          contributionBasis: "20000",
          conversionBasis: "0",
          latestConversionYear: null,
        },
        {
          performanceAccountId: acct2Id,
          ownerPersonId: person2Id,
          year: 2026,
          contributionBasis: "35000",
          conversionBasis: "10000",
          latestConversionYear: 2024,
        },
      ],
    });
    expect(result.success).toBe(true);

    const breakdown = await caller.taxBuckets.computeBreakdown({
      targetRetirementAges: [
        { personId: person1Id, age: 55 },
        { personId: person2Id, age: 55 },
      ],
    });
    const entry1 = breakdown.accounts.find(
      (a) => a.performanceAccountId === acct1Id,
    )!;
    const entry2 = breakdown.accounts.find(
      (a) => a.performanceAccountId === acct2Id,
    )!;
    expect(
      entry1.slices.find((s) => s.label === "Contribution basis")?.amount,
    ).toBe(20000);
    expect(
      entry2.slices.find((s) => s.label === "Contribution basis")?.amount,
    ).toBe(35000);
    expect(
      entry2.slices.find((s) => s.label === "Conversion basis")?.amount,
    ).toBe(10000);

    // Re-batch with revised amounts for the SAME (account, owner, year) key
    // -- proves the onConflictDoUpdate upsert path, not just insert.
    const revised = await caller.taxBuckets.batchUpdateRothBasis({
      entries: [
        {
          performanceAccountId: acct1Id,
          ownerPersonId: person1Id,
          year: 2026,
          contributionBasis: "25000",
          conversionBasis: "0",
          latestConversionYear: null,
        },
      ],
    });
    expect(revised.success).toBe(true);
    const afterUpdate = await caller.taxBuckets.computeBreakdown({
      targetRetirementAges: [{ personId: person1Id, age: 55 }],
    });
    const entry1Updated = afterUpdate.accounts.find(
      (a) => a.performanceAccountId === acct1Id,
    )!;
    expect(
      entry1Updated.slices.find((s) => s.label === "Contribution basis")
        ?.amount,
    ).toBe(25000);
  });

  it("rejects updateRothBasis, batchUpdateRothBasis, and updateSeparationDate for a viewer without the performance permission", async () => {
    await expect(
      viewerCaller.taxBuckets.updateRothBasis({
        performanceAccountId: 1,
        ownerPersonId: 1,
        contributionBasis: "1",
        conversionBasis: "0",
        latestConversionYear: null,
      }),
    ).rejects.toThrow(/permission/i);

    await expect(
      viewerCaller.taxBuckets.batchUpdateRothBasis({
        entries: [
          {
            performanceAccountId: 1,
            ownerPersonId: 1,
            year: 2026,
            contributionBasis: "1",
            conversionBasis: "0",
            latestConversionYear: null,
          },
        ],
      }),
    ).rejects.toThrow(/permission/i);

    await expect(
      viewerCaller.taxBuckets.updateSeparationDate({
        performanceAccountId: 1,
        separationDate: "2030-01-01",
      }),
    ).rejects.toThrow(/permission/i);
  });
});
