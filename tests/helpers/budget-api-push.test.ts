import "./setup-mocks";
import { describe, it, expect, vi } from "vitest";
import {
  pushSnapshotToBudgetApi,
  snapshotMemoTag,
} from "@/server/helpers/budget-api-push";
import type { AccountMapping } from "@/lib/db/schema";
import type { BudgetAPIClient } from "@/lib/budget-api/interface";
import type { BudgetTransaction } from "@/lib/budget-api/types";
import type { Db } from "@/server/helpers/transforms";

/** Fake db exposing only the select().from().where() chain the helper
 *  uses to load portfolioAccounts for a snapshot. */
function makeFakeDb(
  accounts: { performanceAccountId: number | null; amount: string }[],
): Db {
  return {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(accounts),
      }),
    }),
    // Db is a full Drizzle instance; this test only exercises the
    // select/from/where chain used by pushSnapshotToBudgetApi, so a
    // minimal stub cast is unavoidable.
    // eslint-disable-next-line no-restricted-syntax
  } as unknown as Db;
}

function makeMapping(overrides: Partial<AccountMapping> = {}): AccountMapping {
  return {
    localName: "Checking",
    remoteAccountId: "remote-1",
    syncDirection: "push",
    performanceAccountId: 1,
    ...overrides,
  };
}

function makeTransaction(
  overrides: Partial<BudgetTransaction> = {},
): BudgetTransaction {
  return {
    id: "tx-1",
    accountId: "remote-1",
    accountName: "Remote",
    date: "2026-01-01",
    amount: 0,
    payeeName: "Portfolio Sync",
    categoryId: null,
    categoryName: null,
    memo: null,
    cleared: true,
    approved: true,
    deleted: false,
    ...overrides,
  };
}

function makeFakeClient(
  overrides: Partial<BudgetAPIClient> = {},
): BudgetAPIClient {
  return {
    testConnection: vi.fn(),
    getBudgetName: vi.fn(),
    getAccounts: vi.fn(),
    getAccountBalance: vi.fn().mockResolvedValue(0),
    getCategories: vi.fn(),
    getMonths: vi.fn(),
    getMonthDetail: vi.fn(),
    updateCategoryBudgeted: vi.fn(),
    updateCategoryGoalTarget: vi.fn(),
    updateCategoryTargetBalance: vi.fn(),
    getTransactions: vi.fn(),
    createTransaction: vi.fn().mockResolvedValue("new-tx-id"),
    updateTransaction: vi.fn(),
    deleteTransaction: vi.fn().mockResolvedValue(undefined),
    getAccountTransactions: vi.fn().mockResolvedValue([]),
    getExcludedCategoryNames: vi.fn().mockReturnValue(new Set()),
    ...overrides,
    // Stub implements only the methods pushSnapshotToBudgetApi actually
    // calls; the full interface has many more.
    // eslint-disable-next-line no-restricted-syntax
  } as unknown as BudgetAPIClient;
}

describe("snapshotMemoTag", () => {
  it("builds the idempotency tag from the snapshot id", () => {
    expect(snapshotMemoTag(42)).toBe("snapshot:42");
  });
});

describe("pushSnapshotToBudgetApi — aggregation + create mode", () => {
  it("sums balances per remoteAccountId and posts the delta vs live balance", async () => {
    const db = makeFakeDb([
      { performanceAccountId: 1, amount: "1000.00" },
      { performanceAccountId: 2, amount: "500.00" },
    ]);
    const client = makeFakeClient({
      getAccountBalance: vi.fn().mockResolvedValue(1200),
    });
    const mappings = [
      makeMapping({
        localName: "Checking",
        remoteAccountId: "remote-1",
        performanceAccountId: 1,
      }),
      makeMapping({
        localName: "Savings",
        remoteAccountId: "remote-1",
        performanceAccountId: 2,
      }),
    ];

    const result = await pushSnapshotToBudgetApi({
      db,
      snapshotId: 7,
      snapshotDate: "2026-01-01",
      mappings,
      client,
      mode: "create",
      asOfDate: new Date("2026-01-01"),
    });

    expect(result).toEqual({
      groupsPosted: 1,
      groupsSkipped: 0,
      groupsCleaned: 0,
    });
    expect(client.createTransaction).toHaveBeenCalledTimes(1);
    const call = (client.createTransaction as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    // total 1500 - live 1200 = 300
    expect(call.amount).toBe(300);
    expect(call.memo).toContain("snapshot:7");
    expect(call.memo).toContain("Checking");
    expect(call.memo).toContain("Savings");
  });

  it("dedupes a performance account referenced by two mappings in the same group, summing its balance once", async () => {
    const db = makeFakeDb([{ performanceAccountId: 1, amount: "1000.00" }]);
    const client = makeFakeClient();
    const mappings = [
      makeMapping({
        localName: "Alice IRA",
        remoteAccountId: "shared-remote",
        performanceAccountId: 1,
      }),
      makeMapping({
        localName: "Bob IRA",
        remoteAccountId: "shared-remote",
        performanceAccountId: 1,
      }),
    ];

    await pushSnapshotToBudgetApi({
      db,
      snapshotId: 8,
      snapshotDate: "2026-01-01",
      mappings,
      client,
      mode: "create",
      asOfDate: new Date("2026-01-01"),
    });

    const call = (client.createTransaction as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    // Not double-counted: 1000, not 2000.
    expect(call.amount).toBe(1000);
    expect(call.memo).toContain("Alice IRA");
    expect(call.memo).toContain("Bob IRA");
  });

  it("skips mappings with syncDirection 'pull' and no matching local balance", async () => {
    const db = makeFakeDb([{ performanceAccountId: 1, amount: "1000.00" }]);
    const client = makeFakeClient();
    const mappings = [
      makeMapping({ syncDirection: "pull", performanceAccountId: 1 }),
      makeMapping({
        remoteAccountId: "remote-2",
        performanceAccountId: 99, // no matching snapshot balance
      }),
    ];

    const result = await pushSnapshotToBudgetApi({
      db,
      snapshotId: 9,
      snapshotDate: "2026-01-01",
      mappings,
      client,
      mode: "create",
      asOfDate: new Date("2026-01-01"),
    });

    expect(result).toEqual({
      groupsPosted: 0,
      groupsSkipped: 0,
      groupsCleaned: 0,
    });
    expect(client.createTransaction).not.toHaveBeenCalled();
  });

  it("create mode skips a group whose remoteAccountId already has a snapshot tag, without deleting anything", async () => {
    const db = makeFakeDb([{ performanceAccountId: 1, amount: "1000.00" }]);
    const client = makeFakeClient({
      getAccountTransactions: vi
        .fn()
        .mockResolvedValue([
          makeTransaction({ id: "existing-1", memo: "Ledgr snapshot:10 - x" }),
        ]),
    });
    const mappings = [makeMapping({ performanceAccountId: 1 })];

    const result = await pushSnapshotToBudgetApi({
      db,
      snapshotId: 10,
      snapshotDate: "2026-01-01",
      mappings,
      client,
      mode: "create",
      asOfDate: new Date("2026-01-01"),
    });

    expect(result).toEqual({
      groupsPosted: 0,
      groupsSkipped: 1,
      groupsCleaned: 0,
    });
    expect(client.deleteTransaction).not.toHaveBeenCalled();
    expect(client.createTransaction).not.toHaveBeenCalled();
  });

  it("uses exact memo-token matching so snapshot:1 does not match snapshot:10", async () => {
    const db = makeFakeDb([{ performanceAccountId: 1, amount: "1000.00" }]);
    const client = makeFakeClient({
      getAccountTransactions: vi
        .fn()
        .mockResolvedValue([
          makeTransaction({ id: "existing-1", memo: "Ledgr snapshot:10 - x" }),
        ]),
      getAccountBalance: vi.fn().mockResolvedValue(0),
    });
    const mappings = [makeMapping({ performanceAccountId: 1 })];

    // Pushing snapshot 1 - "snapshot:1" is a substring of "snapshot:10" but
    // must not match via the split/includes exact-token check.
    const result = await pushSnapshotToBudgetApi({
      db,
      snapshotId: 1,
      snapshotDate: "2026-01-01",
      mappings,
      client,
      mode: "create",
      asOfDate: new Date("2026-01-01"),
    });

    expect(result.groupsSkipped).toBe(0);
    expect(result.groupsPosted).toBe(1);
  });
});

describe("pushSnapshotToBudgetApi — resync mode", () => {
  it("deletes existing tagged transactions before posting a fresh one", async () => {
    const db = makeFakeDb([{ performanceAccountId: 1, amount: "1000.00" }]);
    const client = makeFakeClient({
      getAccountTransactions: vi
        .fn()
        .mockResolvedValue([
          makeTransaction({ id: "old-1", memo: "Ledgr snapshot:5 - x" }),
        ]),
      getAccountBalance: vi.fn().mockResolvedValue(200),
    });
    const mappings = [makeMapping({ performanceAccountId: 1 })];

    const result = await pushSnapshotToBudgetApi({
      db,
      snapshotId: 5,
      snapshotDate: "2026-01-01",
      mappings,
      client,
      mode: "resync",
      asOfDate: new Date("2026-01-01"),
    });

    expect(client.deleteTransaction).toHaveBeenCalledWith("old-1");
    expect(result).toEqual({
      groupsPosted: 1,
      groupsSkipped: 0,
      groupsCleaned: 1,
    });
  });

  it("throws with a reconciliation message and does not post when a cleanup delete fails", async () => {
    const db = makeFakeDb([{ performanceAccountId: 1, amount: "1000.00" }]);
    const client = makeFakeClient({
      getAccountTransactions: vi
        .fn()
        .mockResolvedValue([
          makeTransaction({ id: "old-1", memo: "Ledgr snapshot:5 - x" }),
        ]),
      deleteTransaction: vi.fn().mockRejectedValue(new Error("network down")),
    });
    const mappings = [makeMapping({ performanceAccountId: 1 })];

    await expect(
      pushSnapshotToBudgetApi({
        db,
        snapshotId: 5,
        snapshotDate: "2026-01-01",
        mappings,
        client,
        mode: "resync",
        asOfDate: new Date("2026-01-01"),
      }),
    ).rejects.toThrow(/could not be deleted.*old-1.*network down/s);

    expect(client.createTransaction).not.toHaveBeenCalled();
  });
});

describe("pushSnapshotToBudgetApi — post-failure rollback", () => {
  it("rolls back transactions created earlier in the same run when a later post fails", async () => {
    const db = makeFakeDb([
      { performanceAccountId: 1, amount: "1000.00" },
      { performanceAccountId: 2, amount: "500.00" },
    ]);
    const client = makeFakeClient({
      getAccountBalance: vi.fn().mockResolvedValue(0),
      createTransaction: vi
        .fn()
        .mockResolvedValueOnce("created-1")
        .mockRejectedValueOnce(new Error("api rate limited")),
    });
    const mappings = [
      makeMapping({ remoteAccountId: "remote-a", performanceAccountId: 1 }),
      makeMapping({ remoteAccountId: "remote-b", performanceAccountId: 2 }),
    ];

    await expect(
      pushSnapshotToBudgetApi({
        db,
        snapshotId: 11,
        snapshotDate: "2026-01-01",
        mappings,
        client,
        mode: "create",
        asOfDate: new Date("2026-01-01"),
      }),
    ).rejects.toThrow(/api rate limited/);

    expect(client.deleteTransaction).toHaveBeenCalledWith("created-1");
  });

  it("surfaces transactions that could not be rolled back in the error message", async () => {
    const db = makeFakeDb([
      { performanceAccountId: 1, amount: "1000.00" },
      { performanceAccountId: 2, amount: "500.00" },
    ]);
    const client = makeFakeClient({
      getAccountBalance: vi.fn().mockResolvedValue(0),
      createTransaction: vi
        .fn()
        .mockResolvedValueOnce("created-1")
        .mockRejectedValueOnce(new Error("api rate limited")),
      deleteTransaction: vi.fn().mockRejectedValue(new Error("also down")),
    });
    const mappings = [
      makeMapping({ remoteAccountId: "remote-a", performanceAccountId: 1 }),
      makeMapping({ remoteAccountId: "remote-b", performanceAccountId: 2 }),
    ];

    await expect(
      pushSnapshotToBudgetApi({
        db,
        snapshotId: 12,
        snapshotDate: "2026-01-01",
        mappings,
        client,
        mode: "create",
        asOfDate: new Date("2026-01-01"),
      }),
    ).rejects.toThrow(/could not be rolled back.*created-1.*also down/s);
  });
});
