/**
 * An institution deleted and re-added in SimpleFIN Bridge: its accounts come
 * back under new SimpleFIN ids. Through the real sync on a SQLite test
 * database, each account keeps its row, links and history, and a copy an
 * earlier sync already stored is merged into it. Invented accounts only.
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
  afterEach,
} from "vitest";
import { randomBytes } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { createTestDb, type TestDbContext } from "../helpers/db-harness";

vi.mock("@/lib/simplefin/client", () => ({
  getAccounts: vi.fn(),
  isSimplefinReplayMode: () => true, // quota ledger out of the way
}));

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

import { getAccounts, type SimplefinAccount } from "@/lib/simplefin/client";
import {
  getSimplefinLastError,
  runSimplefinSync,
  saveSimplefinConnection,
} from "@/lib/simplefin/sync";

const mockGetAccounts = vi.mocked(getAccounts);

const ORG = "Example Retirement Co";
const PLAN = "Example 401(k) Plan (1111)";
const HSA = "Example Health Savings (2222)";
/** A day after the old ids last answered (GONE_AFTER_HOURS). */
const AS_OF = new Date("2026-11-07T15:00:00Z");
const REPORTED_AT = new Date("2026-11-06T09:00:00Z");
const day = (iso: string) => new Date(`${iso}T21:00:00Z`);
/** The old ids' last answer, and when the copies' history was first stored. */
const OLD_SEEN = new Date("2026-11-06T08:49:00Z");
const COPY_STORED = new Date("2026-11-06T09:04:00Z");

function account(id: string, name: string, balance: number): SimplefinAccount {
  return {
    id,
    name,
    balance,
    orgName: ORG,
    balanceDate: REPORTED_AT,
    holdings: null,
    transactions: [],
  };
}

function answer(
  accounts: SimplefinAccount[],
  over: Partial<Awaited<ReturnType<typeof getAccounts>>> = {},
) {
  return {
    accounts,
    providerErrors: [],
    accountIdsWithErrors: [],
    errorScope: [],
    ...over,
  };
}

describe("an account SimpleFIN reports under a new id", () => {
  let ctx: TestDbContext;
  let planPerf: number;
  let hsaPerf: number;

  const feed = (values: {
    externalAccountId: string;
    accountName: string;
    lastBalance: string;
    linkedPerformanceAccountId?: number | null;
    lastSeenAt?: Date;
  }) =>
    ctx.db
      .insert(ctx.schema.simplefinAccounts)
      .values({ orgName: ORG, ...values })
      .returning()
      .get().id;

  const feeds = () =>
    ctx.db
      .select()
      .from(ctx.schema.simplefinAccounts)
      .orderBy(asc(ctx.schema.simplefinAccounts.id))
      .all();

  beforeEach(async () => {
    ctx = await createTestDb();
    await saveSimplefinConnection(ctx.rawDb, "https://u:p@bridge.example");
    const perf = (accountType: string, label: string) =>
      ctx.db
        .insert(ctx.schema.performanceAccounts)
        .values({
          institution: ORG,
          accountType,
          accountLabel: label,
          ownershipType: "individual",
          parentCategory: "Retirement",
        })
        .returning()
        .get().id;
    planPerf = perf("401k", "Example 401k");
    hsaPerf = perf("hsa", "Example HSA");
  });
  afterEach(() => ctx.cleanup());

  it("keeps its row when no copy was stored yet: no second row, no missing warning", async () => {
    const id = feed({
      externalAccountId: "old-plan",
      accountName: PLAN,
      lastBalance: "50000",
      linkedPerformanceAccountId: planPerf,
      lastSeenAt: OLD_SEEN,
    });
    mockGetAccounts.mockResolvedValueOnce(
      answer([account("new-plan", PLAN, 51000)]),
    );
    const result = await runSimplefinSync(ctx.rawDb, AS_OF);

    const rows = feeds();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id,
      externalAccountId: "new-plan",
      linkedPerformanceAccountId: planPerf,
      isIncluded: true,
    });
    expect(Number(rows[0]!.lastBalance)).toBe(51000);
    expect(result.totalBalance).toBe(51000);
    expect(await getSimplefinLastError(ctx.rawDb)).toBeNull();
    const balances = ctx.db
      .select()
      .from(ctx.schema.simplefinAccountBalances)
      .all();
    expect(balances.map((b) => b.simplefinAccountId)).toEqual([id]);
  });

  it("waits a day before a missing row counts as gone: a silent drop may clear", async () => {
    feed({
      externalAccountId: "old-plan",
      accountName: PLAN,
      lastBalance: "50000",
      linkedPerformanceAccountId: planPerf,
      lastSeenAt: new Date(AS_OF.getTime() - 2 * 3_600_000),
    });
    mockGetAccounts.mockResolvedValueOnce(
      answer([account("new-plan", PLAN, 51000)]),
    );
    await runSimplefinSync(ctx.rawDb, AS_OF);
    expect(feeds().map((r) => r.externalAccountId)).toEqual([
      "old-plan",
      "new-plan",
    ]);
  });

  it("waits while an error covers its institution: the old row may only be missing", async () => {
    feed({
      externalAccountId: "old-plan",
      accountName: PLAN,
      lastBalance: "50000",
      linkedPerformanceAccountId: planPerf,
      lastSeenAt: OLD_SEEN,
    });
    mockGetAccounts.mockResolvedValueOnce(
      answer([account("new-plan", PLAN, 51000)], {
        providerErrors: ["Sign in again"],
        errorScope: [ORG],
      }),
    );
    await runSimplefinSync(ctx.rawDb, AS_OF);
    expect(feeds().map((r) => r.externalAccountId)).toEqual([
      "old-plan",
      "new-plan",
    ]);

    // The next clean answer merges the copy that sync stored.
    mockGetAccounts.mockResolvedValueOnce(
      answer([account("new-plan", PLAN, 51000)]),
    );
    const result = await runSimplefinSync(
      ctx.rawDb,
      new Date("2026-11-08T15:00:00Z"),
    );
    expect(feeds().map((r) => r.externalAccountId)).toEqual(["new-plan"]);
    expect(result.totalBalance).toBe(51000);
  });

  describe("a copy already stored, as an earlier sync left it", () => {
    let planId: number;
    let hsaId: number;
    let planCopy: number;

    beforeEach(() => {
      // Linked rows with history, SimpleFIN's old ids; unlinked copies
      // under the new ids, both included: every dollar counted twice.
      planId = feed({
        externalAccountId: "old-plan",
        accountName: PLAN,
        lastBalance: "50000",
        linkedPerformanceAccountId: planPerf,
        lastSeenAt: OLD_SEEN,
      });
      hsaId = feed({
        externalAccountId: "old-hsa",
        accountName: HSA,
        lastBalance: "8000",
        linkedPerformanceAccountId: hsaPerf,
        lastSeenAt: OLD_SEEN,
      });
      planCopy = feed({
        externalAccountId: "new-plan",
        accountName: PLAN,
        lastBalance: "50500",
      });
      feed({
        externalAccountId: "new-hsa",
        accountName: HSA,
        lastBalance: "8100",
      });

      const b = ctx.schema.simplefinAccountBalances;
      ctx.db
        .insert(b)
        .values([
          {
            simplefinAccountId: planId,
            balanceDate: day("2026-11-04"),
            balance: "49000",
          },
          {
            simplefinAccountId: planId,
            balanceDate: day("2026-11-05"),
            balance: "50000",
          },
          // Same report time on both: the kept row's stays.
          {
            simplefinAccountId: planCopy,
            balanceDate: day("2026-11-05"),
            balance: "50000.01",
            createdAt: COPY_STORED,
          },
          {
            simplefinAccountId: planCopy,
            balanceDate: day("2026-11-06"),
            balance: "50500",
            createdAt: COPY_STORED,
          },
        ])
        .run();
      const securityId = ctx.db
        .insert(ctx.schema.securities)
        .values({
          name: "Example Target 2050",
          kind: "plan_fund",
          institution: ORG,
          sourceDescription: "Example Target 2050",
        })
        .returning()
        .get().id;
      const h = ctx.schema.holdingObservations;
      const obs = (simplefinAccountId: number, at: string, shares: string) => ({
        createdAt: simplefinAccountId === planCopy ? COPY_STORED : OLD_SEEN,
        simplefinAccountId,
        securityId,
        balanceDate: day(at),
        asOf: at,
        shares,
        source: "simplefin" as const,
      });
      ctx.db
        .insert(h)
        .values([
          obs(planId, "2026-11-05", "100"),
          obs(planCopy, "2026-11-05", "100.5"),
          obs(planCopy, "2026-11-06", "101"),
        ])
        .run();
      const t = ctx.schema.investmentTransactions;
      const txn = (
        simplefinAccountId: number,
        externalId: string,
        description: string,
        amount = "250",
      ) => ({
        firstSeenAt: simplefinAccountId === planCopy ? COPY_STORED : OLD_SEEN,
        simplefinAccountId,
        externalId,
        posted: "2026-01-15",
        amount,
        description,
      });
      ctx.db
        .insert(t)
        .values([
          txn(planId, "T-1", "Contribution (kept)"),
          txn(planCopy, "T-1", "Contribution (copy)"),
          txn(planCopy, "T-2", "Contribution"),
          // The same dividend under the re-added connection's new id.
          txn(planId, "T-OLD-3", "Dividend", "12.34"),
          txn(planCopy, "T-NEW-3", "Dividend", "12.34"),
        ])
        .run();
    });

    const answerBoth = () =>
      answer([account("new-plan", PLAN, 51000), account("new-hsa", HSA, 8200)]);

    it("merges each copy into its row: one row each, links and history kept, counted once", async () => {
      mockGetAccounts.mockResolvedValueOnce(answerBoth());
      const result = await runSimplefinSync(ctx.rawDb, AS_OF);

      expect(
        feeds().map((r) => [
          r.id,
          r.externalAccountId,
          r.linkedPerformanceAccountId,
          r.isIncluded,
          Number(r.lastBalance),
        ]),
      ).toEqual([
        [planId, "new-plan", planPerf, true, 51000],
        [hsaId, "new-hsa", hsaPerf, true, 8200],
      ]);
      expect(result.totalBalance).toBe(59200);
      expect(result.accountCount).toBe(2);
      expect(await getSimplefinLastError(ctx.rawDb)).toBeNull();

      const b = ctx.schema.simplefinAccountBalances;
      expect(
        ctx.db
          .select({
            id: b.simplefinAccountId,
            at: b.balanceDate,
            balance: b.balance,
          })
          .from(b)
          .where(eq(b.simplefinAccountId, planId))
          .orderBy(asc(b.balanceDate))
          .all()
          .map((r) => [r.at.toISOString(), Number(r.balance)]),
      ).toEqual([
        ["2026-11-04T21:00:00.000Z", 49000],
        ["2026-11-05T21:00:00.000Z", 50000],
        ["2026-11-06T09:00:00.000Z", 51000], // this sync's report
        ["2026-11-06T21:00:00.000Z", 50500], // moved from the copy
      ]);
      const h = ctx.schema.holdingObservations;
      expect(
        ctx.db
          .select({
            acct: h.simplefinAccountId,
            asOf: h.asOf,
            shares: h.shares,
          })
          .from(h)
          .orderBy(asc(h.asOf))
          .all()
          .map((r) => ({ ...r, shares: Number(r.shares) })),
      ).toEqual([
        { acct: planId, asOf: "2026-11-05", shares: 100 },
        { acct: planId, asOf: "2026-11-06", shares: 101 },
      ]);
      const t = ctx.schema.investmentTransactions;
      expect(
        ctx.db
          .select({
            acct: t.simplefinAccountId,
            ext: t.externalId,
            d: t.description,
          })
          .from(t)
          .orderBy(asc(t.externalId))
          .all(),
      ).toEqual([
        { acct: planId, ext: "T-1", d: "Contribution (kept)" },
        { acct: planId, ext: "T-2", d: "Contribution" },
        { acct: planId, ext: "T-NEW-3", d: "Dividend" },
      ]);
    });

    it("changes nothing on a second sync", async () => {
      mockGetAccounts.mockResolvedValueOnce(answerBoth());
      await runSimplefinSync(ctx.rawDb, AS_OF);
      const tables = () => ({
        feeds: feeds(),
        balances: ctx.db
          .select()
          .from(ctx.schema.simplefinAccountBalances)
          .all(),
        holdings: ctx.db.select().from(ctx.schema.holdingObservations).all(),
        transactions: ctx.db
          .select()
          .from(ctx.schema.investmentTransactions)
          .all()
          .map(({ updatedAt: _u, ...r }) => r),
      });
      const before = tables();
      mockGetAccounts.mockResolvedValueOnce(answerBoth());
      await runSimplefinSync(ctx.rawDb, AS_OF);
      const after = tables();
      expect({
        ...after,
        feeds: after.feeds.map(({ lastSeenAt: _s, ...r }) => r),
      }).toEqual({
        ...before,
        feeds: before.feeds.map(({ lastSeenAt: _s, ...r }) => r),
      });
    });

    it("leaves both rows when the copy has history from while the old one was reported", async () => {
      const b = ctx.schema.simplefinAccountBalances;
      ctx.db
        .update(b)
        .set({ createdAt: new Date("2026-10-01T00:00:00Z") })
        .where(eq(b.simplefinAccountId, planCopy))
        .run();
      mockGetAccounts.mockResolvedValueOnce(answerBoth());
      await runSimplefinSync(ctx.rawDb, AS_OF);
      // The plan copy stays; the HSA copy (no history) still merges.
      expect(feeds().map((r) => r.externalAccountId)).toEqual([
        "old-plan",
        "new-hsa",
        "new-plan",
      ]);
    });

    it("leaves both rows while the old one may be missing behind an error", async () => {
      mockGetAccounts.mockResolvedValueOnce(
        answer(answerBoth().accounts, { errorScope: "any" }),
      );
      const result = await runSimplefinSync(ctx.rawDb, AS_OF);
      expect(feeds()).toHaveLength(4);
      expect(result.accountCount).toBe(4);
    });
  });
});
