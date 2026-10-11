/**
 * SimpleFIN investment ingest (holdings, balances, transactions) against a
 * real SQLite test database. All accounts and rows are invented.
 */
import "../helpers/setup-mocks";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDbContext } from "../helpers/db-harness";
import {
  ingestInvestmentData,
  REDACTED_MEDICAL_DESCRIPTION,
} from "@/lib/simplefin/ingest";
import type { SimplefinAccount } from "@/lib/simplefin/client";

const at = (iso: string) => Math.floor(Date.parse(iso) / 1000);

function account(
  over: Partial<SimplefinAccount> & { id: string },
): SimplefinAccount {
  return {
    name: "Example Account",
    balance: 10_000,
    orgName: "Example Brokerage",
    balanceDate: new Date("2026-05-16T08:00:00Z"), // Saturday → Friday May 15 close
    holdings: [],
    transactions: [],
    ...over,
  };
}

describe("ingestInvestmentData", () => {
  let ctx: TestDbContext;
  let brokerageId: number;
  let hsaId: number;
  let checkingId: number;
  let registry: Map<
    string,
    { id: number; linkedPerformanceAccountId: number | null }
  >;

  beforeAll(async () => {
    ctx = await createTestDb();
    const perf = (accountType: string, label: string) =>
      ctx.db
        .insert(ctx.schema.performanceAccounts)
        .values({
          institution: "Example Brokerage",
          accountType,
          accountLabel: label,
          ownershipType: "individual",
          parentCategory: "Retirement",
        })
        .returning()
        .get().id;
    const iraPerf = perf("ira", "Example IRA");
    const hsaPerf = perf("hsa", "Example HSA");
    const sf = (externalAccountId: string, linked: number | null) =>
      ctx.db
        .insert(ctx.schema.simplefinAccounts)
        .values({
          externalAccountId,
          orgName: "Example Brokerage",
          accountName: externalAccountId,
          lastBalance: "0",
          linkedPerformanceAccountId: linked,
        })
        .returning()
        .get().id;
    brokerageId = sf("sf-ira", iraPerf);
    hsaId = sf("sf-hsa", hsaPerf);
    checkingId = sf("sf-checking", null);
    registry = new Map([
      ["sf-ira", { id: brokerageId, linkedPerformanceAccountId: iraPerf }],
      ["sf-hsa", { id: hsaId, linkedPerformanceAccountId: hsaPerf }],
      ["sf-checking", { id: checkingId, linkedPerformanceAccountId: null }],
    ]);
  });

  afterAll(() => ctx.cleanup());

  const run = (
    accounts: SimplefinAccount[],
    accountIdsWithErrors: string[] = [],
  ) =>
    ingestInvestmentData(ctx.rawDb, {
      accounts,
      registry,
      windowStart: "2026-05-01",
      accountIdsWithErrors: new Set(accountIdsWithErrors),
    });

  const observations = (simplefinAccountId: number) =>
    ctx.db
      .select()
      .from(ctx.schema.holdingObservations)
      .where(
        eq(
          ctx.schema.holdingObservations.simplefinAccountId,
          simplefinAccountId,
        ),
      )
      .all();

  const transactions = (simplefinAccountId: number) =>
    ctx.db
      .select()
      .from(ctx.schema.investmentTransactions)
      .where(
        eq(
          ctx.schema.investmentTransactions.simplefinAccountId,
          simplefinAccountId,
        ),
      )
      .all();

  it("stores holdings on the trading day the balance reflects", async () => {
    const summary = await run([
      account({
        id: "sf-ira",
        holdings: [
          {
            id: "h1",
            symbol: "EXMPX",
            description: "Example Index Fund",
            shares: 10,
            marketValue: 1000,
            costBasisPerShare: 80,
          },
          {
            id: "h2",
            symbol: "EXMXX",
            description: "Example Money Market Fund",
            shares: 5,
            marketValue: 5,
            costBasisPerShare: null,
          },
        ],
      }),
    ]);
    const rows = observations(brokerageId);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.asOf === "2026-05-15")).toBe(true);
    expect(summary.holdingsRecorded).toBe(2);
    expect(
      ctx.db.select().from(ctx.schema.simplefinAccountBalances).all(),
    ).toHaveLength(1);
  });

  it("re-running the same sync is idempotent", async () => {
    await run([
      account({
        id: "sf-ira",
        holdings: [
          {
            id: "h1",
            symbol: "EXMPX",
            description: "Example Index Fund",
            shares: 10,
            marketValue: 1000,
            costBasisPerShare: 80,
          },
          {
            id: "h2",
            symbol: "EXMXX",
            description: "Example Money Market Fund",
            shares: 5,
            marketValue: 5,
            costBasisPerShare: null,
          },
        ],
      }),
    ]);
    expect(observations(brokerageId)).toHaveLength(2);
    expect(ctx.db.select().from(ctx.schema.securities).all()).toHaveLength(2);
  });

  it("records a fund that disappeared from a later non-empty list as 0 shares", async () => {
    await run([
      account({
        id: "sf-ira",
        balanceDate: new Date("2026-05-19T08:00:00Z"), // Tuesday → Monday May 18
        holdings: [
          {
            id: "h2",
            symbol: "EXMXX",
            description: "Example Money Market Fund",
            shares: 1010,
            marketValue: 1010,
            costBasisPerShare: null,
          },
        ],
      }),
    ]);
    const sold = observations(brokerageId).find(
      (r) => r.asOf === "2026-05-18" && Number(r.shares) === 0,
    );
    expect(sold).toBeDefined();
  });

  it("treats an empty holdings list as unknown — nothing written, a warning raised", async () => {
    const before = observations(brokerageId).length;
    const summary = await run([
      account({
        id: "sf-ira",
        balanceDate: new Date("2026-05-20T08:00:00Z"),
        holdings: [],
      }),
    ]);
    expect(observations(brokerageId)).toHaveLength(before);
    expect(summary.warnings[0]).toMatch(/no holdings reported/);
  });

  it("never stores an unlinked account with no invested holdings (e.g. checking)", async () => {
    const summary = await run([
      account({
        id: "sf-checking",
        holdings: [],
        transactions: [
          {
            id: "c1",
            posted: at("2026-05-10T12:00:00Z"),
            transactedAt: null,
            amount: -25,
            description: "COFFEE SHOP",
            pending: false,
          },
        ],
      }),
    ]);
    expect(summary.accountsStored).toBe(0);
    expect(transactions(checkingId)).toHaveLength(0);
  });

  it("stores transactions as sent and is idempotent", async () => {
    const tx = {
      id: "t1",
      posted: at("2026-05-08T12:00:00Z"),
      transactedAt: null,
      amount: 500,
      description: "CONTRIBUTION",
      pending: false,
    };
    await run([account({ id: "sf-ira", transactions: [tx] })]);
    await run([account({ id: "sf-ira", transactions: [tx] })]);
    const rows = transactions(brokerageId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      amount: "500.00",
      description: "CONTRIBUTION",
      posted: "2026-05-08",
      kindOverride: null,
    });
  });

  it("redacts HSA card spending at ingest and locks the kind", async () => {
    await run([
      account({
        id: "sf-hsa",
        orgName: "Fidelity Investments",
        holdings: [
          {
            id: "x",
            symbol: "EXHSX",
            description: "Example HSA Fund",
            shares: 3,
            marketValue: 300,
            costBasisPerShare: null,
          },
        ],
        transactions: [
          {
            id: "m1",
            posted: at("2026-05-09T12:00:00Z"),
            transactedAt: null,
            amount: -80,
            description: "DEBIT CARD PURCHASE EXAMPLE CLINIC (Cash)",
            pending: false,
          },
        ],
      }),
    ]);
    const [row] = transactions(hsaId);
    expect(row).toMatchObject({
      description: REDACTED_MEDICAL_DESCRIPTION,
      kindOverride: "withdrawal",
      kindOverrideSource: "ingest_redacted",
    });
    expect(JSON.stringify(transactions(hsaId))).not.toContain("CLINIC");
  });

  it("does not redact card spending on an account linked to a non-HSA type", async () => {
    await run([
      account({
        id: "sf-ira",
        orgName: "Fidelity Investments",
        transactions: [
          {
            id: "m2",
            posted: at("2026-05-09T12:00:00Z"),
            transactedAt: null,
            amount: -40,
            description: "DEBIT CARD PURCHASE EXAMPLE STORE",
            pending: false,
          },
        ],
      }),
    ]);
    const row = transactions(brokerageId).find((r) => r.externalId === "m2");
    expect(row?.description).toBe("DEBIT CARD PURCHASE EXAMPLE STORE");
  });

  it("never duplicates rows older than the requested window (provider ignored start-date)", async () => {
    const old = {
      id: "old-1",
      posted: at("2026-03-02T12:00:00Z"),
      transactedAt: null,
      amount: 75,
      description: "CONTRIBUTION",
      pending: false,
    };
    const sync = (windowStart: string) =>
      ingestInvestmentData(ctx.rawDb, {
        accounts: [account({ id: "sf-ira", transactions: [old] })],
        registry,
        windowStart,
        accountIdsWithErrors: new Set(),
      });
    await sync("2026-03-01");
    const summary = await sync("2026-05-01"); // later sync, narrower window, same old row sent again
    expect(summary.warnings).toEqual([]);
    expect(
      transactions(brokerageId).filter((r) => r.externalId === "old-1"),
    ).toHaveLength(1);
  });

  it("never voids when the response named the account in an error", async () => {
    const voidedBefore = transactions(brokerageId).filter(
      (r) => r.voidedAt !== null,
    ).length;
    const summary = await run(
      [account({ id: "sf-ira", transactions: [] })],
      ["sf-ira"],
    );
    expect(summary.transactionsVoided).toBe(0);
    expect(
      transactions(brokerageId).filter((r) => r.voidedAt !== null),
    ).toHaveLength(voidedBefore);
  });
});
