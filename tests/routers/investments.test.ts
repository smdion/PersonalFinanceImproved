/**
 * Investments router: holdings, transactions with read-time kinds, the
 * review queue and household rules. Invented accounts and rows only.
 */
import "./setup-mocks";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import {
  createTestCaller,
  createViewerSessionWithPermissions,
  viewerSession,
} from "./setup";
import * as sqliteSchema from "@/lib/db/schema-sqlite";
import { REDACTED_MEDICAL_DESCRIPTION } from "@/lib/simplefin/ingest";

const daysAgo = (n: number) =>
  new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10); // lint-violation-ok: test fixture dates, compared only to each other

describe("investments router", () => {
  let ctx: Awaited<ReturnType<typeof createTestCaller>>;
  let brokerageId: number;
  let hsaId: number;
  const tx: Record<string, number> = {};

  beforeAll(async () => {
    ctx = await createTestCaller();
    const db = ctx.db;
    const perf = (accountType: string, label: string) =>
      db
        .insert(sqliteSchema.performanceAccounts)
        .values({
          institution: "Example Bank",
          accountType,
          accountLabel: label,
          ownershipType: "individual",
          parentCategory: "Retirement",
        })
        .returning()
        .get().id;
    const sf = (externalAccountId: string, linked: number) =>
      db
        .insert(sqliteSchema.simplefinAccounts)
        .values({
          externalAccountId,
          orgName: "Example Bank",
          accountName: externalAccountId,
          lastBalance: "10000",
          linkedPerformanceAccountId: linked,
        })
        .returning()
        .get().id;
    brokerageId = sf("sf-ira", perf("ira", "Example IRA"));
    hsaId = sf("sf-hsa", perf("hsa", "Example HSA"));

    const insert = (
      key: string,
      account: number,
      description: string,
      amount: number,
      extra: Partial<
        typeof sqliteSchema.investmentTransactions.$inferInsert
      > = {},
    ) => {
      tx[key] = db
        .insert(sqliteSchema.investmentTransactions)
        .values({
          simplefinAccountId: account,
          externalId: key,
          posted: daysAgo(3),
          amount: amount.toFixed(2),
          description,
          pending: false,
          ...extra,
        })
        .returning()
        .get().id;
    };
    insert("div", brokerageId, "DIVIDEND", 12);
    insert("mystery1", brokerageId, "ZZZ PAYROLL 01", 250);
    insert("mystery2", brokerageId, "ZZZ PAYROLL 02", 250);
    insert("hsa-out", hsaId, "ZZZ TRANSFER EXAMPLE CLINIC", -60);
    insert("locked", hsaId, REDACTED_MEDICAL_DESCRIPTION, -40, {
      kindOverride: "withdrawal",
      kindOverrideSource: "ingest_redacted",
    });
    insert("old-voided", brokerageId, "ZZZ OLD", 5, { voidedAt: new Date() });

    const sec = (ticker: string, name: string) =>
      db
        .insert(sqliteSchema.securities)
        .values({ ticker, name, kind: "mutual_fund" })
        .returning()
        .get().id;
    const fund = sec("EXMPX", "Example Index Fund");
    const sold = sec("EXSLX", "Example Sold Fund");
    const obs = (securityId: number, asOf: string, shares: string) =>
      db
        .insert(sqliteSchema.holdingObservations)
        .values({
          simplefinAccountId: brokerageId,
          securityId,
          asOf,
          shares,
          reportedMarketValue: "100.00",
          source: "simplefin",
        })
        .run();
    obs(fund, "2026-05-14", "9");
    obs(fund, "2026-05-15", "10");
    obs(sold, "2026-05-14", "4");
    obs(sold, "2026-05-15", "0");
  });

  afterAll(() => ctx.cleanup());

  it("lists the latest holdings per account, leaving out sold funds", async () => {
    const holdings = await ctx.caller.investments.listHoldings();
    expect(holdings).toHaveLength(1);
    expect(holdings[0]).toMatchObject({
      symbol: "EXMPX",
      shares: 10,
      asOf: "2026-05-15",
      accountName: "sf-ira",
    });
  });

  it("lists transactions with their read-time kind, hiding voided rows", async () => {
    const rows = await ctx.caller.investments.listTransactions({});
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(tx.div!)).toMatchObject({
      kind: "dividend",
      source: "built_in",
    });
    expect(byId.get(tx.locked!)).toMatchObject({
      kind: "withdrawal",
      source: "locked",
    });
    expect(byId.has(tx["old-voided"]!)).toBe(false);
  });

  it("queues unmatched rows for review", async () => {
    const queue = await ctx.caller.investments.listReviewQueue();
    expect(queue.map((r) => r.id).sort()).toEqual(
      [tx.mystery1!, tx.mystery2!, tx["hsa-out"]!].sort(),
    );
  });

  it("previews then saves a rule that reclassifies matching rows", async () => {
    const rule = {
      institutionContains: "example bank",
      descriptionContains: "zzz payroll",
      kind: "contribution" as const,
    };
    expect(await ctx.caller.investments.previewRule(rule)).toEqual({
      matched: 2,
      changed: 2,
    });
    const saved = await ctx.caller.investments.createRule({
      ...rule,
      fromTransactionId: tx.mystery1,
    });
    expect(saved.rule.sampleDescription).toBe("ZZZ PAYROLL 01");
    const queue = await ctx.caller.investments.listReviewQueue();
    expect(queue.map((r) => r.id)).toEqual([tx["hsa-out"]!]);
    const rows = await ctx.caller.investments.listTransactions({});
    expect(rows.find((r) => r.id === tx.mystery2)).toMatchObject({
      kind: "contribution",
      source: "user_rule",
    });
  });

  it("never copies text from an HSA row into a rule", async () => {
    const saved = await ctx.caller.investments.createRule({
      institutionContains: "Example Bank",
      descriptionContains: "ZZZ TRANSFER",
      kind: "other",
      priority: -1,
      fromTransactionId: tx["hsa-out"],
    });
    expect(saved.rule.sampleDescription).toBeNull();
    await ctx.caller.investments.deleteRule({ id: saved.rule.id });
  });

  it("refuses to change a redacted row", async () => {
    await expect(
      ctx.caller.investments.setTransactionKind({
        id: tx.locked!,
        kind: "trade",
      }),
    ).rejects.toThrow(/fixed/);
  });

  it("redacts an HSA row the user marks as a withdrawal", async () => {
    const result = await ctx.caller.investments.setTransactionKind({
      id: tx["hsa-out"]!,
      kind: "withdrawal",
    });
    expect(result.redacted).toBe(true);
    const row = ctx.db
      .select()
      .from(sqliteSchema.investmentTransactions)
      .where(eq(sqliteSchema.investmentTransactions.id, tx["hsa-out"]!))
      .get();
    expect(row).toMatchObject({
      description: REDACTED_MEDICAL_DESCRIPTION,
      kindOverrideSource: "ingest_redacted",
    });
    // The lock isn't a user choice, so it can't be cleared.
    expect(
      await ctx.caller.investments.clearTransactionKind({ id: tx["hsa-out"]! }),
    ).toEqual({ cleared: false });
  });

  it("sets and clears a user choice", async () => {
    await ctx.caller.investments.setTransactionKind({
      id: tx.div!,
      kind: "interest",
    });
    let rows = await ctx.caller.investments.listTransactions({});
    expect(rows.find((r) => r.id === tx.div)).toMatchObject({
      kind: "interest",
      source: "override",
    });
    expect(
      await ctx.caller.investments.clearTransactionKind({ id: tx.div! }),
    ).toEqual({ cleared: true });
    rows = await ctx.caller.investments.listTransactions({});
    expect(rows.find((r) => r.id === tx.div)?.kind).toBe("dividend");
  });

  it("judges a small fee against the balance at the time, not today's", async () => {
    const plan = ctx.db
      .insert(sqliteSchema.simplefinAccounts)
      .values({
        externalAccountId: "sf-plan",
        orgName: "Voya Financial",
        accountName: "Example Plan",
        lastBalance: "1000",
      })
      .returning()
      .get().id;
    const balance = (day: string, amount: string) =>
      ctx.db
        .insert(sqliteSchema.simplefinAccountBalances)
        .values({
          simplefinAccountId: plan,
          balanceDate: new Date(`${day}T12:00:00Z`),
          balance: amount,
        })
        .run();
    balance(daysAgo(10), "100000"); // fee was 0.05% of the balance then
    balance(daysAgo(1), "1000"); // 5% of today's balance
    const fee = ctx.db
      .insert(sqliteSchema.investmentTransactions)
      .values({
        simplefinAccountId: plan,
        externalId: "fee",
        posted: daysAgo(5),
        amount: "-50.00",
        description: "Example Target Fund",
        pending: false,
      })
      .returning()
      .get().id;
    const rows = await ctx.caller.investments.listTransactions({});
    const row = rows.find((r) => r.id === fee);
    expect(row).toMatchObject({ kind: "fee", needsReview: false });
    expect(row).not.toHaveProperty("balanceForRules");
  });

  it("reports holdings an account stopped sending", async () => {
    const health = await ctx.caller.investments.getHealth();
    expect(health.issues).toContainEqual(
      expect.objectContaining({
        account: "Example Bank sf-ira",
        kind: "holdings_stale",
      }),
    );
    expect(typeof health.needsReview).toBe("number");
  });

  it("splits only when stored transactions reach back to the snapshot", async () => {
    // No complete ingest recorded yet → coverage unknown.
    expect(
      (await ctx.caller.investments.getSnapshotFlows({ since: daysAgo(10) }))
        .covered,
    ).toBe(false);
    ctx.db
      .insert(sqliteSchema.appSettings)
      .values({
        key: "simplefin_investments_first_synced_at",
        value: new Date().toISOString(),
      })
      .run();
    const recent = await ctx.caller.investments.getSnapshotFlows({
      since: daysAgo(10),
    });
    expect(recent.covered).toBe(true);
    expect(recent.recent.length).toBeLessThanOrEqual(3);
    expect(
      recent.recent.every((r) => !("description" in r) && r.label.length > 0),
    ).toBe(true);
    // A snapshot older than SimpleFIN's 90-day window can't be split.
    expect(
      (await ctx.caller.investments.getSnapshotFlows({ since: daysAgo(120) }))
        .covered,
    ).toBe(false);
  });

  it("pairs a move between two of the household's accounts as a transfer", async () => {
    const db = ctx.db;
    const account = (externalAccountId: string, label: string) => {
      const perf = db
        .insert(sqliteSchema.performanceAccounts)
        .values({
          institution: "Example Broker",
          accountType: "brokerage",
          accountLabel: label,
          ownershipType: "individual",
          parentCategory: "Portfolio",
        })
        .returning()
        .get().id;
      return db
        .insert(sqliteSchema.simplefinAccounts)
        .values({
          externalAccountId,
          orgName: "Example Broker",
          accountName: externalAccountId,
          lastBalance: "5000",
          linkedPerformanceAccountId: perf,
        })
        .returning()
        .get().id;
    };
    const from = account("sf-move-plan", "Example Plan");
    const to = account("sf-move-taxable", "Example Taxable");
    const row = (
      simplefinAccountId: number,
      externalId: string,
      posted: string,
      amount: string,
      description: string,
    ) =>
      db
        .insert(sqliteSchema.investmentTransactions)
        .values({
          simplefinAccountId,
          externalId,
          posted,
          amount,
          description,
          pending: false,
        })
        .returning()
        .get().id;
    const out = row(from, "t-out", daysAgo(6), "-1234.56", "TRANSFER OUT");
    const into = row(to, "t-in", daysAgo(4), "1234.56", "TRANSFER IN");
    const other = row(to, "t-dep", daysAgo(4), "99.00", "DEPOSIT");

    const rows = await ctx.caller.investments.listTransactions({});
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(out)).toMatchObject({
      kind: "transfer",
      source: "transfer_match",
      transfer: { pairId: into, conversion: false },
    });
    expect(byId.get(into)).toMatchObject({
      kind: "transfer",
      transfer: { pairId: out },
    });
    expect(byId.get(other)).toMatchObject({
      kind: "contribution",
      transfer: null,
    });

    // The pair still holds when only the receiving account is listed.
    const recent = await ctx.caller.investments.listTransactions({
      simplefinAccountId: to,
    });
    expect(recent.find((r) => r.id === into)?.kind).toBe("transfer");
    expect(recent.some((r) => r.id === out)).toBe(false);

    // A choice the household made by hand is never re-labelled.
    await ctx.caller.investments.setTransactionKind({
      id: out,
      kind: "withdrawal",
    });
    const after = await ctx.caller.investments.listTransactions({});
    expect(after.find((r) => r.id === into)?.kind).toBe("contribution");
    expect(after.find((r) => r.id === out)?.source).toBe("override");
  });

  it("requires the portfolio permission to read or change anything", async () => {
    for (const session of [
      viewerSession,
      createViewerSessionWithPermissions(["sync"]),
    ]) {
      const other = await createTestCaller(session);
      try {
        await expect(other.caller.investments.listHoldings()).rejects.toThrow();
        await expect(
          other.caller.investments.listTransactions({}),
        ).rejects.toThrow();
        await expect(other.caller.investments.listRules()).rejects.toThrow();
        await expect(other.caller.investments.getHealth()).rejects.toThrow();
        await expect(
          other.caller.investments.getSnapshotFlows({ since: "2026-01-01" }),
        ).rejects.toThrow();
        await expect(
          other.caller.investments.setTransactionKind({ id: 1, kind: "other" }),
        ).rejects.toThrow();
      } finally {
        other.cleanup();
      }
    }
    const allowed = await createTestCaller(
      createViewerSessionWithPermissions(["portfolio"]),
    );
    try {
      await expect(allowed.caller.investments.listRules()).resolves.toEqual([]);
    } finally {
      allowed.cleanup();
    }
  });
});
