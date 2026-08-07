import "../helpers/setup-mocks";
import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
} from "vitest";
import { randomBytes } from "node:crypto";
import { createTestDb, type TestDbContext } from "../helpers/db-harness";

vi.mock("@/lib/simplefin/client", () => ({
  getAccounts: vi.fn(),
}));

// ENCRYPTION_KEY must be set before crypto.ts is imported (transitively via
// sync.ts) so encryptJson/readMaybeEncrypted have a real key to work with.
const TEST_ENCRYPTION_KEY = randomBytes(32).toString("base64");
let originalKey: string | undefined;
beforeAll(() => {
  originalKey = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
});
afterAll(() => {
  if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = originalKey;
});

import { getAccounts } from "@/lib/simplefin/client";
import { eq } from "drizzle-orm";
import {
  getSimplefinConnection,
  saveSimplefinConnection,
  removeSimplefinConnection,
  runSimplefinSync,
  upsertSimplefinAccounts,
  recomputeTodaySnapshotFromLocal,
  hasSyncedToday,
  getSimplefinLastError,
} from "@/lib/simplefin/sync";

const mockGetAccounts = vi.mocked(getAccounts);

describe("simplefin/sync", () => {
  let ctx: TestDbContext;

  beforeAll(async () => {
    ctx = await createTestDb();
  });

  afterAll(() => ctx.cleanup());

  beforeEach(() => {
    mockGetAccounts.mockReset();
  });

  describe("saveSimplefinConnection / getSimplefinConnection", () => {
    it("stores the access URL encrypted at rest and reads it back", async () => {
      await saveSimplefinConnection(
        ctx.rawDb,
        "https://user:pass@bridge.simplefin.org",
      );
      const conn = await getSimplefinConnection(ctx.rawDb);
      expect(conn).not.toBeNull();
      // Config column must never hold the plaintext access URL directly.
      expect(JSON.stringify(conn!.config)).not.toContain(
        "bridge.simplefin.org",
      );
      expect(conn!.config).toHaveProperty("v", 1);
    });

    it("upserts on a second save rather than creating a duplicate row", async () => {
      await saveSimplefinConnection(
        ctx.rawDb,
        "https://a:b@bridge.simplefin.org",
      );
      await saveSimplefinConnection(
        ctx.rawDb,
        "https://c:d@bridge.simplefin.org",
      );
      const rows = ctx.db
        .select()
        .from(ctx.schema.apiConnections)
        .all()
        .filter((r) => r.service === "simplefin");
      expect(rows).toHaveLength(1);
    });
  });

  describe("removeSimplefinConnection", () => {
    it("deletes the connection row", async () => {
      await saveSimplefinConnection(
        ctx.rawDb,
        "https://x:y@bridge.simplefin.org",
      );
      await removeSimplefinConnection(ctx.rawDb);
      expect(await getSimplefinConnection(ctx.rawDb)).toBeNull();
    });
  });

  describe("runSimplefinSync", () => {
    it("throws when no connection is configured", async () => {
      await removeSimplefinConnection(ctx.rawDb);
      await expect(runSimplefinSync(ctx.rawDb)).rejects.toThrow(
        /No SimpleFIN connection configured/,
      );
    });

    it("sums balances across accounts and writes a snapshot for today", async () => {
      await saveSimplefinConnection(
        ctx.rawDb,
        "https://u:p@bridge.simplefin.org",
      );
      mockGetAccounts.mockResolvedValueOnce({
        accounts: [
          { id: "a1", name: "Checking", balance: 1200.5, orgName: "Bank" },
          { id: "a2", name: "Savings", balance: 340.25, orgName: "Bank" },
        ],
        providerErrors: [],
      });

      const asOfDate = new Date(2026, 0, 15); // local Jan 15, 2026
      const result = await runSimplefinSync(ctx.rawDb, asOfDate);

      expect(result.accountCount).toBe(2);
      expect(result.totalBalance).toBeCloseTo(1540.75);
      expect(result.snapshotDate).toBe("2026-01-15");

      const rows = ctx.db
        .select()
        .from(ctx.schema.simplefinBalanceSnapshots)
        .all();
      expect(rows).toHaveLength(1);
      expect(Number(rows[0]!.totalBalance)).toBeCloseTo(1540.75);
      expect(rows[0]!.accountCount).toBe(2);
    });

    it("upserts the same day's row instead of duplicating on a second sync", async () => {
      await saveSimplefinConnection(
        ctx.rawDb,
        "https://u:p@bridge.simplefin.org",
      );
      const asOfDate = new Date(2026, 1, 1);

      mockGetAccounts.mockResolvedValueOnce({
        accounts: [
          { id: "a1", name: "Checking", balance: 100, orgName: "Bank" },
        ],
        providerErrors: [],
      });
      await runSimplefinSync(ctx.rawDb, asOfDate);

      mockGetAccounts.mockResolvedValueOnce({
        accounts: [
          { id: "a1", name: "Checking", balance: 250, orgName: "Bank" },
        ],
        providerErrors: [],
      });
      const second = await runSimplefinSync(ctx.rawDb, asOfDate);

      expect(second.totalBalance).toBe(250);
      const rows = ctx.db
        .select()
        .from(ctx.schema.simplefinBalanceSnapshots)
        .all()
        .filter((r) => r.snapshotDate === "2026-02-01");
      expect(rows).toHaveLength(1);
      expect(Number(rows[0]!.totalBalance)).toBe(250);
    });

    it("updates apiConnections.lastSyncedAt on success", async () => {
      await saveSimplefinConnection(
        ctx.rawDb,
        "https://u:p@bridge.simplefin.org",
      );
      mockGetAccounts.mockResolvedValueOnce({
        accounts: [],
        providerErrors: [],
      });

      await runSimplefinSync(ctx.rawDb, new Date(2026, 2, 1));

      const after = await getSimplefinConnection(ctx.rawDb);
      expect(after!.lastSyncedAt).not.toBeNull();
    });

    it("propagates a typed error from the SimpleFIN client without writing a snapshot", async () => {
      await saveSimplefinConnection(
        ctx.rawDb,
        "https://u:p@bridge.simplefin.org",
      );
      mockGetAccounts.mockRejectedValueOnce(
        new Error("Authentication failed (401)"),
      );

      await expect(
        runSimplefinSync(ctx.rawDb, new Date(2026, 3, 1)),
      ).rejects.toThrow(/Authentication failed/);

      const rows = ctx.db
        .select()
        .from(ctx.schema.simplefinBalanceSnapshots)
        .all()
        .filter((r) => r.snapshotDate === "2026-04-01");
      expect(rows).toHaveLength(0);
    });

    it("records the failure message via getSimplefinLastError, and clears it on the next successful sync", async () => {
      await saveSimplefinConnection(
        ctx.rawDb,
        "https://u:p@bridge.simplefin.org",
      );
      mockGetAccounts.mockRejectedValueOnce(new Error("Connection refused"));
      await expect(
        runSimplefinSync(ctx.rawDb, new Date(2026, 3, 2)),
      ).rejects.toThrow(/Connection refused/);
      expect(await getSimplefinLastError(ctx.rawDb)).toBe("Connection refused");

      mockGetAccounts.mockResolvedValueOnce({
        accounts: [],
        providerErrors: [],
      });
      await runSimplefinSync(ctx.rawDb, new Date(2026, 3, 3));
      expect(await getSimplefinLastError(ctx.rawDb)).toBeNull();
    });

    it("records non-fatal providerErrors even though the sync itself succeeds", async () => {
      await saveSimplefinConnection(
        ctx.rawDb,
        "https://u:p@bridge.simplefin.org",
      );
      mockGetAccounts.mockResolvedValueOnce({
        accounts: [
          { id: "a1", name: "Checking", balance: 10, orgName: "Bank" },
        ],
        providerErrors: ["Institution X needs re-authentication"],
      });

      const result = await runSimplefinSync(ctx.rawDb, new Date(2026, 3, 4));

      expect(result.providerErrors).toEqual([
        "Institution X needs re-authentication",
      ]);
      expect(await getSimplefinLastError(ctx.rawDb)).toBe(
        "Institution X needs re-authentication",
      );
    });

    // Critical assertion (per plan): this is the one test that would catch a
    // decimal-string-concatenation regression in the summation, since it
    // requires a real numeric sum across mixed included/excluded accounts
    // read back from the DB's decimal column rather than the client's number.
    it("sums only accounts currently marked included, as a real number not a concatenated string", async () => {
      await saveSimplefinConnection(
        ctx.rawDb,
        "https://u:p@bridge.simplefin.org",
      );
      const asOfDate = new Date(2026, 4, 1);

      // Seed: exclude "excluded-1" before the sync that would otherwise sum it in.
      await upsertSimplefinAccounts(ctx.rawDb, [
        {
          id: "excluded-1",
          name: "Old Credit Card",
          balance: 999.99,
          orgName: "Bank",
        },
      ]);
      await ctx.rawDb
        .update(ctx.schema.simplefinAccounts)
        .set({ isIncluded: false })
        .where(
          eq(ctx.schema.simplefinAccounts.externalAccountId, "excluded-1"),
        );

      mockGetAccounts.mockResolvedValueOnce({
        accounts: [
          {
            id: "excluded-1",
            name: "Old Credit Card",
            balance: 999.99,
            orgName: "Bank",
          },
          {
            id: "included-1",
            name: "Checking",
            balance: 100.5,
            orgName: "Bank",
          },
          {
            id: "included-2",
            name: "Savings",
            balance: 25.25,
            orgName: "Bank",
          },
        ],
        providerErrors: [],
      });

      const result = await runSimplefinSync(ctx.rawDb, asOfDate);

      expect(result.accountCount).toBe(2);
      expect(typeof result.totalBalance).toBe("number");
      expect(result.totalBalance).toBeCloseTo(125.75);
      expect(result.totalBalance).not.toBe("100.5025.25"); // string-concat regression guard
    });
  });

  describe("hasSyncedToday", () => {
    it("is false when there is no connection configured", async () => {
      await removeSimplefinConnection(ctx.rawDb);
      expect(await hasSyncedToday(ctx.rawDb, new Date(2026, 5, 10))).toBe(
        false,
      );
    });

    it("is false when the connection has never synced", async () => {
      await saveSimplefinConnection(
        ctx.rawDb,
        "https://u:p@bridge.simplefin.org",
      );
      expect(await hasSyncedToday(ctx.rawDb, new Date(2026, 5, 10))).toBe(
        false,
      );
    });

    it("is true only on the same local calendar day as the last real sync, and does not follow the zero-API-cost local-recompute path", async () => {
      await saveSimplefinConnection(
        ctx.rawDb,
        "https://u:p@bridge.simplefin.org",
      );
      mockGetAccounts.mockResolvedValueOnce({
        accounts: [],
        providerErrors: [],
      });
      const asOfDate = new Date(2026, 5, 10);
      await runSimplefinSync(ctx.rawDb, asOfDate);

      expect(await hasSyncedToday(ctx.rawDb, asOfDate)).toBe(true);
      expect(await hasSyncedToday(ctx.rawDb, new Date(2026, 5, 11))).toBe(
        false,
      );

      // recomputeTodaySnapshotFromLocal writes simplefin_balance_snapshots
      // but never touches api_connections.lastSyncedAt — hasSyncedToday
      // must not be fooled by that table into skipping a real sync.
      await recomputeTodaySnapshotFromLocal(ctx.rawDb, new Date(2026, 5, 11));
      expect(await hasSyncedToday(ctx.rawDb, new Date(2026, 5, 11))).toBe(
        false,
      );
    });
  });

  describe("upsertSimplefinAccounts", () => {
    it("defaults a brand-new account to included", async () => {
      const [row] = await upsertSimplefinAccounts(ctx.rawDb, [
        { id: "new-acct-1", name: "New Account", balance: 50, orgName: "Bank" },
      ]);
      expect(row!.isIncluded).toBe(true);
      expect(row!.lastBalance).toBe(50);
    });

    it("preserves a manually-excluded account's flag across re-upserts, but refreshes its balance", async () => {
      await upsertSimplefinAccounts(ctx.rawDb, [
        { id: "toggle-1", name: "Toggle Me", balance: 10, orgName: "Bank" },
      ]);
      await ctx.rawDb
        .update(ctx.schema.simplefinAccounts)
        .set({ isIncluded: false })
        .where(eq(ctx.schema.simplefinAccounts.externalAccountId, "toggle-1"));

      const [row] = await upsertSimplefinAccounts(ctx.rawDb, [
        { id: "toggle-1", name: "Toggle Me", balance: 99, orgName: "Bank" },
      ]);

      expect(row!.isIncluded).toBe(false);
      expect(row!.lastBalance).toBe(99);
    });
  });

  describe("recomputeTodaySnapshotFromLocal", () => {
    it("sums included accounts from local data without calling the SimpleFIN client", async () => {
      // Table is shared across this file's tests, so assert against a
      // delta rather than an absolute count: seed two new accounts, exclude
      // one, and confirm the total moves by exactly the included account's
      // balance relative to whatever was already in the table.
      const before = await recomputeTodaySnapshotFromLocal(
        ctx.rawDb,
        new Date(2026, 5, 1),
      );

      await upsertSimplefinAccounts(ctx.rawDb, [
        { id: "local-1", name: "A", balance: 40, orgName: "Bank" },
        { id: "local-2", name: "B", balance: 60, orgName: "Bank" },
      ]);
      await ctx.rawDb
        .update(ctx.schema.simplefinAccounts)
        .set({ isIncluded: false })
        .where(eq(ctx.schema.simplefinAccounts.externalAccountId, "local-2"));

      mockGetAccounts.mockReset();
      const asOfDate = new Date(2026, 5, 1);
      const result = await recomputeTodaySnapshotFromLocal(ctx.rawDb, asOfDate);

      expect(mockGetAccounts).not.toHaveBeenCalled();
      expect(result.accountCount).toBe(before.accountCount + 1);
      expect(result.totalBalance).toBeCloseTo(before.totalBalance + 40);
      expect(result.snapshotDate).toBe("2026-06-01");

      const rows = ctx.db
        .select()
        .from(ctx.schema.simplefinBalanceSnapshots)
        .all()
        .filter((r) => r.snapshotDate === "2026-06-01");
      expect(rows).toHaveLength(1);
      expect(Number(rows[0]!.totalBalance)).toBeCloseTo(
        before.totalBalance + 40,
      );
    });
  });
});
