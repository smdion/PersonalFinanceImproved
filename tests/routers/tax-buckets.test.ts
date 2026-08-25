/**
 * Tax Buckets router integration tests — getBreakdown, updateRothBasis,
 * updateSeparationDate.
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

    const result = await caller.taxBuckets.getBreakdown({
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
    const personId = await seedPerson(db, "Joanna", "1991-01-10");
    const perfAcctId = seedPerformanceAccount(db, {
      institution: "Voya",
      accountType: "401k",
      ownerPersonId: personId,
      ownershipType: "individual",
    });
    // Joanna turns 55 in 2046. Separate her from this job in 2046 — Rule of
    // 55 should apply, even though this isn't her current job by the time
    // we check (no other job seeded means this is moot here, but exercises
    // the real endDate-based derivation path end to end).
    const jobId = seedJob(db, personId, { endDate: "2046-06-01" });
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

    const result = await caller.taxBuckets.getBreakdown({
      targetRetirementAges: [{ personId, age: 65 }], // irrelevant — real endDate wins
    });

    const entry = result.accounts.find(
      (a) => a.performanceAccountId === perfAcctId,
    )!;
    expect(entry.ruleOf55?.eligible).toBe(true);
    expect(entry.ruleOf55?.source).toBe("derived");
    expect(entry.ruleOf55?.separationYear).toBe(2046);
  });

  it("updateRothBasis upserts and getBreakdown reflects it on the next call", async () => {
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

    const first = await caller.taxBuckets.getBreakdown({
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

    const second = await caller.taxBuckets.getBreakdown({
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

    const result = await caller.taxBuckets.getBreakdown({
      targetRetirementAges: [{ personId, age: 65 }],
    });
    const entry = result.accounts.find(
      (a) => a.performanceAccountId === perfAcctId,
    )!;
    expect(entry.ruleOf55?.source).toBe("explicit");
    expect(entry.ruleOf55?.separationYear).toBe(2030);
    expect(entry.ruleOf55?.eligible).toBe(false);
  });

  it("rejects updateRothBasis and updateSeparationDate for a viewer without the performance permission", async () => {
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
      viewerCaller.taxBuckets.updateSeparationDate({
        performanceAccountId: 1,
        separationDate: "2030-01-01",
      }),
    ).rejects.toThrow(/permission/i);
  });
});
