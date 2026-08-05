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
import {
  getSimplefinConnection,
  saveSimplefinConnection,
  removeSimplefinConnection,
  runSimplefinSync,
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
      mockGetAccounts.mockResolvedValueOnce([
        { id: "a1", name: "Checking", balance: 1200.5, orgName: "Bank" },
        { id: "a2", name: "Savings", balance: 340.25, orgName: "Bank" },
      ]);

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

      mockGetAccounts.mockResolvedValueOnce([
        { id: "a1", name: "Checking", balance: 100, orgName: "Bank" },
      ]);
      await runSimplefinSync(ctx.rawDb, asOfDate);

      mockGetAccounts.mockResolvedValueOnce([
        { id: "a1", name: "Checking", balance: 250, orgName: "Bank" },
      ]);
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
      mockGetAccounts.mockResolvedValueOnce([]);

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
  });
});
