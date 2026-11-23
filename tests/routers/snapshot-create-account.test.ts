/** Adding an account row to a snapshot: only the latest snapshot, the
 *  master's parent category, and the year's Performance follows. */
import "./setup-mocks";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema-sqlite";
import {
  adminSession,
  createTestCaller,
  seedPerformanceAccount,
  seedSnapshot,
} from "./setup";

const row = {
  institution: "Fidelity",
  taxType: "preTax" as const,
  amount: "5000",
  accountType: "401k" as const,
};

describe("portfolioSnapshots.createAccount", () => {
  it("refuses an older snapshot", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const older = seedSnapshot(db, "2025-03-01", []);
      seedSnapshot(db, "2025-06-01", []);
      await expect(
        caller.netWorth.portfolioSnapshots.createAccount({
          ...row,
          snapshotId: older,
        }),
      ).rejects.toThrow(/most recent snapshot/);
    } finally {
      cleanup();
    }
  });

  it("a linked row takes the master's category and Performance follows", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const perfId = seedPerformanceAccount(db, {
        parentCategory: "Portfolio",
      });
      db.insert(schema.accountPerformance)
        .values({
          year: 2025,
          performanceAccountId: perfId,
          institution: "Fidelity",
          accountLabel: "401k",
          beginningBalance: "0",
          totalContributions: "0",
          yearlyGainLoss: "0",
          endingBalance: "0",
          employerContributions: "0",
          fees: "0",
          distributions: "0",
          isActive: true,
          parentCategory: "Portfolio",
        })
        .run();
      const snap = seedSnapshot(db, "2025-06-01", []);
      const created = await caller.netWorth.portfolioSnapshots.createAccount({
        ...row,
        snapshotId: snap,
        parentCategory: "Retirement",
        performanceAccountId: perfId,
      });
      expect(created.parentCategory).toBe("Portfolio");
      const [perf] = db
        .select()
        .from(schema.accountPerformance)
        .where(eq(schema.accountPerformance.performanceAccountId, perfId))
        .all();
      expect(Number(perf!.endingBalance)).toBe(5000);
    } finally {
      cleanup();
    }
  });
});

describe("a tax type the row's account type doesn't hold", () => {
  it("createAccount refuses it, naming the tax types the account takes", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const snap = seedSnapshot(db, "2025-06-01", []);
      await expect(
        caller.netWorth.portfolioSnapshots.createAccount({
          ...row,
          taxType: "afterTax",
          snapshotId: snap,
        }),
      ).rejects.toThrow(
        /401k balances can't be saved as After-tax\. Choose Traditional or Roth\./,
      );
      await expect(
        caller.netWorth.portfolioSnapshots.createAccount({
          ...row,
          accountType: "hsa",
          taxType: "hsa",
          snapshotId: snap,
        }),
      ).resolves.toMatchObject({ taxType: "hsa" });
    } finally {
      cleanup();
    }
  });

  it("a sub-type row is judged by its account's primary row", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const perfId = seedPerformanceAccount(db, {});
      const snap = seedSnapshot(db, "2025-06-01", [
        {
          performanceAccountId: perfId,
          amount: "100",
          accountType: "hsa",
          taxType: "hsa",
        },
      ]);
      await expect(
        caller.netWorth.portfolioSnapshots.createAccount({
          ...row,
          subType: "Rollover",
          performanceAccountId: perfId,
          snapshotId: snap,
        }),
      ).rejects.toThrow(
        /HSA balances can't be saved as Traditional\. Choose HSA\./,
      );
    } finally {
      cleanup();
    }
  });

  it("updateAccount refuses changing a row to it, and the row keeps its own", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const perfId = seedPerformanceAccount(db, {});
      seedSnapshot(db, "2025-06-01", [
        { performanceAccountId: perfId, amount: "100" },
      ]);
      const [stored] = db.select().from(schema.portfolioAccounts).all();
      await expect(
        caller.netWorth.portfolioSnapshots.updateAccount({
          id: stored!.id,
          taxType: "hsa",
        }),
      ).rejects.toThrow(/can't be saved as HSA/);
      await caller.netWorth.portfolioSnapshots.updateAccount({
        id: stored!.id,
        taxType: "taxFree",
      });
      const [after] = db.select().from(schema.portfolioAccounts).all();
      expect(after!.taxType).toBe("taxFree");
    } finally {
      cleanup();
    }
  });

  const mistypedBrokerage = {
    ...row,
    accountType: "brokerage" as const,
    taxType: "preTax" as const,
    ownerPersonId: null,
    parentCategory: "Portfolio" as const,
  };

  it("a new snapshot refuses a row entered with it", async () => {
    const { caller, cleanup } = await createTestCaller(adminSession);
    try {
      const create = caller.netWorth.portfolioSnapshots.create({
        snapshotDate: "2025-07-01",
        accounts: [
          { ...row, ownerPersonId: null, parentCategory: "Retirement" },
          mistypedBrokerage,
        ],
      });
      await expect(create).rejects.toThrow(
        /^Brokerage balances can't be saved as Traditional\. Choose After-tax\.$/,
      );
    } finally {
      cleanup();
    }
  });

  it("a new snapshot keeps a row carried over unchanged from the latest one", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const previous = seedSnapshot(db, "2025-06-01", []);
      db.insert(schema.portfolioAccounts)
        .values({ ...mistypedBrokerage, snapshotId: previous })
        .run();
      await expect(
        caller.netWorth.portfolioSnapshots.create({
          snapshotDate: "2025-07-01",
          accounts: [mistypedBrokerage],
        }),
      ).resolves.toBeDefined();
    } finally {
      cleanup();
    }
  });
});
