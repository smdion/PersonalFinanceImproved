/**
 * runSimplefinSync through the real client (fetch stubbed): an account
 * SimpleFIN sends in a shape Ledgr can't read is an errored account, its
 * balance kept as it was; a broken envelope fails the sync, nothing written.
 */
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
import {
  getSimplefinConnection,
  getSimplefinLastError,
  runSimplefinSync,
  saveSimplefinConnection,
} from "@/lib/simplefin/sync";
import {
  sfAccount,
  sfAccountSet,
  sfHolding,
  sfTransaction,
} from "../fixtures/simplefin-protocol";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);
const respond = (body: unknown) =>
  mockFetch.mockReturnValueOnce(
    Promise.resolve({
      ok: true,
      status: 200,
      statusText: "OK",
      text: () => Promise.resolve(JSON.stringify(body)),
    }),
  );

const TEST_ENCRYPTION_KEY = randomBytes(32).toString("base64");
let originalKey: string | undefined;
let ctx: TestDbContext;

beforeAll(async () => {
  originalKey = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
  ctx = await createTestDb();
  await saveSimplefinConnection(ctx.rawDb, "https://u:p@bridge.simplefin.org");
});
afterAll(() => {
  ctx.cleanup();
  if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = originalKey;
});
beforeEach(() => mockFetch.mockReset());

const balances = () =>
  Object.fromEntries(
    ctx.db
      .select()
      .from(ctx.schema.simplefinAccounts)
      .all()
      .map((r) => [r.externalAccountId, Number(r.lastBalance)]),
  );
const snapshots = () =>
  ctx.db.select().from(ctx.schema.simplefinBalanceSnapshots).all();

const good = () =>
  sfAccountSet({
    accounts: [
      sfAccount({ id: "A", name: "Checking", holdings: undefined }),
      sfAccount({ id: "B", name: "Savings", holdings: undefined }),
    ],
  });

describe("runSimplefinSync with an answer Ledgr can't fully read", () => {
  it("one broken account is errored and keeps its balance; the others are written", async () => {
    respond(good());
    await runSimplefinSync(ctx.rawDb, new Date(2026, 6, 1));
    expect(balances()).toEqual({ A: 100.23, B: 100.23 });
    const syncedAt = (await getSimplefinConnection(ctx.rawDb))!.lastSyncedAt;

    respond(
      sfAccountSet({
        accounts: [
          sfAccount({ id: "A", name: "Checking", balance: "200.00" }),
          sfAccount({ id: "B", name: "Savings", balance: "Infinity" }),
        ],
      }),
    );
    const r = await runSimplefinSync(ctx.rawDb, new Date(2026, 6, 2));

    expect(balances()).toEqual({ A: 200, B: 100.23 });
    // B counts at its last good balance, and the sync retries.
    expect(r.totalBalance).toBeCloseTo(300.23);
    expect(r.providerErrors).toEqual([
      'SimpleFIN: /accounts: balance: Must be a valid number (account "Savings", not updated this sync)',
      "1 of 2 linked accounts didn't respond this sync (will retry): My Bank Savings",
    ]);
    expect((await getSimplefinConnection(ctx.rawDb))!.lastSyncedAt).toEqual(
      syncedAt,
    );
  });

  it("a broken envelope fails the sync and writes nothing", async () => {
    const before = { balances: balances(), snapshots: snapshots() };
    const conn = await getSimplefinConnection(ctx.rawDb);

    respond({ ...good(), errors: "Bridge is down" });
    await expect(
      runSimplefinSync(ctx.rawDb, new Date(2026, 6, 3)),
    ).rejects.toMatchObject({
      code: "bad-response",
      message: "SimpleFIN: /accounts: errors: expected array, received string",
    });

    expect(balances()).toEqual(before.balances);
    expect(snapshots()).toEqual(before.snapshots);
    expect(await getSimplefinConnection(ctx.rawDb)).toEqual(conn);
    expect(await getSimplefinLastError(ctx.rawDb)).toBe(
      "SimpleFIN: /accounts: errors: expected array, received string",
    );
    const log = ctx.db.select().from(ctx.schema.syncRequestLog).all();
    expect(log.at(-1)).toMatchObject({ outcome: "error", httpStatus: null });
  });

  describe("a broken holding or transaction on a good account", () => {
    const DAY = 86_400;
    const withH = (h: Record<string, unknown>) =>
      sfAccountSet({
        accounts: [
          sfAccount({ id: "A", name: "Checking", holdings: undefined }),
          sfAccount({ id: "B", name: "Savings", holdings: undefined }),
          sfAccount({ id: "H", name: "IRA", ...h }),
        ],
      });
    const observations = () =>
      ctx.db.select().from(ctx.schema.holdingObservations).all();
    const transactionIds = () =>
      ctx.db
        .select()
        .from(ctx.schema.investmentTransactions)
        .all()
        .map((t) => t.externalId)
        .sort();

    it("a bad holding: balance written, holdings unknown, nothing recorded as sold", async () => {
      respond(
        withH({
          holdings: [
            sfHolding(),
            sfHolding({ symbol: "OTHER", description: "Other Fund" }),
          ],
          transactions: [],
        }),
      );
      const earlier = observations().length;
      await runSimplefinSync(ctx.rawDb, new Date(2026, 6, 4));
      const before = observations();
      expect(before.slice(earlier).map((o) => Number(o.shares))).toEqual([
        10.5, 10.5,
      ]);

      respond(
        withH({
          balance: "999.00",
          "balance-date": 1778000000 + DAY,
          holdings: [
            sfHolding({ shares: "Infinity" }),
            sfHolding({ symbol: "OTHER", description: "Other Fund" }),
          ],
          transactions: [],
        }),
      );
      const r = await runSimplefinSync(ctx.rawDb, new Date(2026, 6, 5));

      expect(balances().H).toBe(999);
      expect(observations()).toEqual(before);
      expect(r.providerErrors).toEqual([
        'SimpleFIN: /accounts: holdings.0.shares: Must be a valid number (account "IRA": holdings kept as last known)',
      ]);
    });

    it("a bad transaction: only that row left out, balance written", async () => {
      respond(
        withH({
          balance: "1000.00",
          "balance-date": 1778000000 + 2 * DAY,
          transactions: [
            sfTransaction({ id: "TRN-H1" }),
            sfTransaction({ id: "TRN-H2", amount: "" }),
          ],
        }),
      );
      const r = await runSimplefinSync(ctx.rawDb, new Date(2026, 6, 6));

      expect(balances().H).toBe(1000);
      expect(transactionIds()).toContain("TRN-H1");
      expect(transactionIds()).not.toContain("TRN-H2");
      expect(r.providerErrors).toEqual([
        'SimpleFIN: /accounts: transactions.1.amount: Must be a valid number (account "IRA": those transactions left out)',
      ]);
    });
  });
});
