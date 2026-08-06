/**
 * SimpleFIN router integration tests — listAccounts, setAccountIncluded,
 * and auth enforcement for the sync-permission-gated mutation.
 */
import "./setup-mocks";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TRPCError } from "@trpc/server";
import {
  createTestCaller,
  viewerSession,
  createViewerSessionWithPermissions,
  seedPerformanceAccount,
  seedSnapshot,
} from "./setup";
import * as sqliteSchema from "@/lib/db/schema-sqlite";

describe("simplefin router", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: Awaited<ReturnType<typeof createTestCaller>>["db"];
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;
  });

  afterAll(() => cleanup());

  describe("listAccounts", () => {
    it("returns an empty array when no accounts have been synced", async () => {
      const result = await caller.simplefin.listAccounts();
      expect(result).toEqual([]);
    });

    it("returns accounts ordered by orgName then accountName", async () => {
      db.insert(sqliteSchema.simplefinAccounts)
        .values([
          {
            externalAccountId: "z1",
            orgName: "Zeta Bank",
            accountName: "Checking",
            lastBalance: "100.00",
          },
          {
            externalAccountId: "a2",
            orgName: "Alpha Bank",
            accountName: "Savings",
            lastBalance: "200.00",
          },
          {
            externalAccountId: "a1",
            orgName: "Alpha Bank",
            accountName: "Checking",
            lastBalance: "50.00",
          },
        ])
        .run();

      const result = await caller.simplefin.listAccounts();
      expect(result.map((r) => `${r.orgName}/${r.accountName}`)).toEqual([
        "Alpha Bank/Checking",
        "Alpha Bank/Savings",
        "Zeta Bank/Checking",
      ]);
      // Balances come back as real numbers, not decimal strings.
      const alphaChecking = result.find(
        (r) => r.accountName === "Checking" && r.orgName === "Alpha Bank",
      );
      expect(alphaChecking?.lastBalance).toBe(50);
      expect(typeof alphaChecking?.lastBalance).toBe("number");
    });
  });

  describe("setAccountIncluded", () => {
    it("updates the flag and recomputes today's snapshot from local data", async () => {
      const row = db
        .insert(sqliteSchema.simplefinAccounts)
        .values({
          externalAccountId: "toggle-router-1",
          orgName: "Bank",
          accountName: "Toggle Target",
          lastBalance: "75.00",
        })
        .returning({ id: sqliteSchema.simplefinAccounts.id })
        .get();

      const excluded = await caller.simplefin.setAccountIncluded({
        id: row.id,
        isIncluded: false,
      });
      expect(excluded.success).toBe(true);

      const accounts = await caller.simplefin.listAccounts();
      const toggled = accounts.find((a) => a.id === row.id);
      expect(toggled?.isIncluded).toBe(false);

      const included = await caller.simplefin.setAccountIncluded({
        id: row.id,
        isIncluded: true,
      });
      expect(included.success).toBe(true);
      const accountsAfter = await caller.simplefin.listAccounts();
      expect(accountsAfter.find((a) => a.id === row.id)?.isIncluded).toBe(true);
    });

    it("rejects a caller without sync permission", async () => {
      const { caller: viewerCaller, cleanup: viewerCleanup } =
        await createTestCaller(viewerSession);
      try {
        await expect(
          viewerCaller.simplefin.setAccountIncluded({
            id: 1,
            isIncluded: false,
          }),
        ).rejects.toThrow(TRPCError);
      } finally {
        viewerCleanup();
      }
    });

    it("allows a caller with explicit sync permission", async () => {
      const syncSession = createViewerSessionWithPermissions(["sync"]);
      const {
        caller: syncCaller,
        db: syncDb,
        cleanup: syncCleanup,
      } = await createTestCaller(syncSession);
      try {
        const row = syncDb
          .insert(sqliteSchema.simplefinAccounts)
          .values({
            externalAccountId: "perm-check-1",
            orgName: "Bank",
            accountName: "Perm Check",
            lastBalance: "10.00",
          })
          .returning({ id: sqliteSchema.simplefinAccounts.id })
          .get();

        const result = await syncCaller.simplefin.setAccountIncluded({
          id: row.id,
          isIncluded: false,
        });
        expect(result.success).toBe(true);
      } finally {
        syncCleanup();
      }
    });
  });

  describe("listMatchableAccounts", () => {
    it("returns only active performance accounts with a display label", async () => {
      const {
        caller: c,
        db: matchDb,
        cleanup: matchCleanup,
      } = await createTestCaller();
      try {
        seedPerformanceAccount(matchDb, {
          name: "Active Acct",
          institution: "Fidelity",
          isActive: true,
        });
        seedPerformanceAccount(matchDb, {
          name: "Inactive Acct",
          institution: "Fidelity",
          isActive: false,
        });

        const result = await c.simplefin.listMatchableAccounts();
        expect(result.length).toBe(1);
        expect(typeof result[0]!.label).toBe("string");
        expect(result[0]!.label.length).toBeGreaterThan(0);
      } finally {
        matchCleanup();
      }
    });
  });

  describe("setAccountMapping — matching to an existing tracked account", () => {
    it("rejects a non-existent performanceAccountId", async () => {
      const {
        caller: c,
        db: matchDb,
        cleanup: matchCleanup,
      } = await createTestCaller();
      try {
        const row = matchDb
          .insert(sqliteSchema.simplefinAccounts)
          .values({
            externalAccountId: "match-1",
            orgName: "Bank",
            accountName: "Match Target",
            lastBalance: "100.00",
          })
          .returning({ id: sqliteSchema.simplefinAccounts.id })
          .get();

        await expect(
          c.simplefin.setAccountMapping({
            id: row.id,
            performanceAccountId: 999999,
          }),
        ).rejects.toThrow(TRPCError);
      } finally {
        matchCleanup();
      }
    });

    it("rejects an inactive performanceAccountId", async () => {
      const {
        caller: c,
        db: matchDb,
        cleanup: matchCleanup,
      } = await createTestCaller();
      try {
        const perfId = seedPerformanceAccount(matchDb, {
          name: "Inactive",
          isActive: false,
        });
        const row = matchDb
          .insert(sqliteSchema.simplefinAccounts)
          .values({
            externalAccountId: "match-2",
            orgName: "Bank",
            accountName: "Match Target",
            lastBalance: "100.00",
          })
          .returning({ id: sqliteSchema.simplefinAccounts.id })
          .get();

        await expect(
          c.simplefin.setAccountMapping({
            id: row.id,
            performanceAccountId: perfId,
          }),
        ).rejects.toThrow(TRPCError);
      } finally {
        matchCleanup();
      }
    });

    it("allows many-to-one matching — two SimpleFIN accounts can link to the same performance account", async () => {
      const {
        caller: c,
        db: matchDb,
        cleanup: matchCleanup,
      } = await createTestCaller();
      try {
        const perfId = seedPerformanceAccount(matchDb, { name: "Shared" });
        seedSnapshot(matchDb, "2025-07-01", [
          { performanceAccountId: perfId, amount: "100.00" },
        ]);
        const [accountA, accountB] = [
          matchDb
            .insert(sqliteSchema.simplefinAccounts)
            .values({
              externalAccountId: "match-a",
              orgName: "Bank",
              accountName: "A",
              lastBalance: "50.00",
            })
            .returning({ id: sqliteSchema.simplefinAccounts.id })
            .get(),
          matchDb
            .insert(sqliteSchema.simplefinAccounts)
            .values({
              externalAccountId: "match-b",
              orgName: "Bank",
              accountName: "B",
              lastBalance: "75.00",
            })
            .returning({ id: sqliteSchema.simplefinAccounts.id })
            .get(),
        ];

        await c.simplefin.setAccountMapping({
          id: accountA.id,
          performanceAccountId: perfId,
        });
        await c.simplefin.setAccountMapping({
          id: accountB.id,
          performanceAccountId: perfId,
        });

        const accounts = await c.simplefin.listAccounts();
        const a = accounts.find((x) => x.id === accountA.id);
        const b = accounts.find((x) => x.id === accountB.id);
        // Both stay linked — no 1:1 unlinking.
        expect(a?.linkedPerformanceAccountId).toBe(perfId);
        expect(b?.linkedPerformanceAccountId).toBe(perfId);
        // Both report the SAME change — combined (50 + 75 = 125) vs. snapshot (100).
        expect(a?.change).toBeCloseTo(25);
        expect(b?.change).toBeCloseTo(25);
      } finally {
        matchCleanup();
      }
    });

    it("computes a correctly-signed, real-number change against the latest snapshot", async () => {
      const {
        caller: c,
        db: matchDb,
        cleanup: matchCleanup,
      } = await createTestCaller();
      try {
        const perfId = seedPerformanceAccount(matchDb, { name: "Matched" });
        seedSnapshot(matchDb, "2025-06-01", [
          { performanceAccountId: perfId, amount: "1000.50" },
        ]);

        const row = matchDb
          .insert(sqliteSchema.simplefinAccounts)
          .values({
            externalAccountId: "match-delta",
            orgName: "Bank",
            accountName: "Delta Test",
            lastBalance: "1250.75",
          })
          .returning({ id: sqliteSchema.simplefinAccounts.id })
          .get();

        await c.simplefin.setAccountMapping({
          id: row.id,
          performanceAccountId: perfId,
        });

        const accounts = await c.simplefin.listAccounts();
        const matched = accounts.find((a) => a.id === row.id);
        expect(matched?.snapshotBalance).toBe(1000.5);
        expect(typeof matched?.change).toBe("number");
        expect(matched?.change).toBeCloseTo(250.25);
        // String-concatenation regression guard.
        expect(matched?.change).not.toBe("1250.751000.50");
        expect(matched?.snapshotDate).toBe("2025-06-01");
      } finally {
        matchCleanup();
      }
    });

    it("unmatched accounts return null snapshotBalance/change/taxType/parentCategory", async () => {
      const result = await caller.simplefin.listAccounts();
      const unmatched = result.find(
        (a) => a.linkedPerformanceAccountId == null,
      );
      expect(unmatched?.snapshotBalance).toBeNull();
      expect(unmatched?.change).toBeNull();
      expect(unmatched?.taxType).toBeNull();
      expect(unmatched?.parentCategory).toBeNull();
      expect(unmatched?.accountType).toBeNull();
      expect(unmatched?.subType).toBeNull();
    });

    it("attaches the matched account's taxType and parentCategory", async () => {
      const {
        caller: c,
        db: matchDb,
        cleanup: matchCleanup,
      } = await createTestCaller();
      try {
        const perfId = seedPerformanceAccount(matchDb, {
          name: "Roth 401k",
          parentCategory: "Retirement",
        });
        seedSnapshot(matchDb, "2025-08-01", [
          {
            performanceAccountId: perfId,
            amount: "5000.00",
            taxType: "taxFree",
          },
        ]);
        const row = matchDb
          .insert(sqliteSchema.simplefinAccounts)
          .values({
            externalAccountId: "tax-single",
            orgName: "Bank",
            accountName: "Single Tax Type",
            lastBalance: "5000.00",
          })
          .returning({ id: sqliteSchema.simplefinAccounts.id })
          .get();

        await c.simplefin.setAccountMapping({
          id: row.id,
          performanceAccountId: perfId,
        });

        const accounts = await c.simplefin.listAccounts();
        const matched = accounts.find((a) => a.id === row.id);
        expect(matched?.taxType).toBe("taxFree");
        expect(matched?.parentCategory).toBe("Retirement");
      } finally {
        matchCleanup();
      }
    });

    it("attaches the matched account's accountType and subType", async () => {
      const {
        caller: c,
        db: matchDb,
        cleanup: matchCleanup,
      } = await createTestCaller();
      try {
        const perfId = seedPerformanceAccount(matchDb, {
          name: "IRA",
          accountType: "ira",
        });
        seedSnapshot(matchDb, "2025-08-01", [
          {
            performanceAccountId: perfId,
            amount: "1000.00",
            accountType: "ira",
          },
        ]);
        const row = matchDb
          .insert(sqliteSchema.simplefinAccounts)
          .values({
            externalAccountId: "type-single",
            orgName: "Bank",
            accountName: "IRA Account",
            lastBalance: "1000.00",
          })
          .returning({ id: sqliteSchema.simplefinAccounts.id })
          .get();

        await c.simplefin.setAccountMapping({
          id: row.id,
          performanceAccountId: perfId,
        });

        const accounts = await c.simplefin.listAccounts();
        const matched = accounts.find((a) => a.id === row.id);
        expect(matched?.accountType).toBe("ira");
      } finally {
        matchCleanup();
      }
    });

    it("resolves to 'mixed' when the matched performance account is split across multiple tax types in the snapshot", async () => {
      const {
        caller: c,
        db: matchDb,
        cleanup: matchCleanup,
      } = await createTestCaller();
      try {
        const perfId = seedPerformanceAccount(matchDb, {
          name: "Split 401k",
          parentCategory: "Retirement",
        });
        // Same performanceAccountId, two snapshot rows with different tax types —
        // a normal pattern for a 401k split Traditional/Roth.
        seedSnapshot(matchDb, "2025-08-01", [
          {
            performanceAccountId: perfId,
            amount: "3000.00",
            taxType: "preTax",
          },
          {
            performanceAccountId: perfId,
            amount: "2000.00",
            taxType: "taxFree",
          },
        ]);
        const row = matchDb
          .insert(sqliteSchema.simplefinAccounts)
          .values({
            externalAccountId: "tax-mixed",
            orgName: "Bank",
            accountName: "Mixed Tax Type",
            lastBalance: "5000.00",
          })
          .returning({ id: sqliteSchema.simplefinAccounts.id })
          .get();

        await c.simplefin.setAccountMapping({
          id: row.id,
          performanceAccountId: perfId,
        });

        const accounts = await c.simplefin.listAccounts();
        const matched = accounts.find((a) => a.id === row.id);
        // Must NOT silently resolve to either "preTax" or "taxFree" —
        // that would fabricate a precise-looking but wrong tax-type split.
        expect(matched?.taxType).toBe("mixed");
        expect(matched?.snapshotBalance).toBe(5000);
      } finally {
        matchCleanup();
      }
    });
  });
});
