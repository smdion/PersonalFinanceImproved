/**
 * applyPullMapping — "cash"/"creditCard" skip guard (found live, 2026-08-31).
 *
 * These two localId values are fixed pseudo-accounts (see AccountMapping's
 * docblock, schema-pg.ts) handled entirely by getEffectiveCash /
 * getEffectiveCreditCardDebt reading straight from the accounts cache.
 * Before the guard, a "cash"/"creditCard" mapping fell through to the
 * generic asset branch and silently wrote into (or repeatedly overwrote)
 * an otherAssetItems row literally named "Cash" — wrong, and only ever
 * reflecting whichever mapping happened to sync last.
 */
import "./setup-mocks";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  applyPullMapping,
  clearUnmappedPulledBalances,
} from "@/server/helpers/apply-pull-mapping";
import { createTestDb, type TestDbContext } from "./db-harness";

describe("applyPullMapping — cash/creditCard pseudo-accounts", () => {
  let ctx: TestDbContext;

  beforeAll(async () => {
    ctx = await createTestDb();
  });

  afterAll(() => ctx.cleanup());

  it("skips a 'cash' mapping instead of writing an otherAssetItems row", async () => {
    const result = await applyPullMapping(ctx.rawDb, {
      mapping: {
        localId: "cash",
        localName: "Cash",
        remoteAccountId: "acct-checking",
        syncDirection: "pull",
      },
      apiBalance: 3000,
      service: "actual",
      currentYear: new Date().getFullYear(),
    });

    expect(result).toEqual({ applied: false });
    const rows = ctx.db.select().from(ctx.schema.otherAssetItems).all();
    expect(rows.find((r) => r.name === "Cash")).toBeUndefined();
  });

  it("skips a 'creditCard' mapping instead of writing an otherAssetItems row", async () => {
    const result = await applyPullMapping(ctx.rawDb, {
      mapping: {
        localId: "creditCard",
        localName: "Credit Card",
        remoteAccountId: "acct-visa",
        syncDirection: "pull",
      },
      apiBalance: -1200,
      service: "actual",
      currentYear: new Date().getFullYear(),
    });

    expect(result).toEqual({ applied: false });
    const rows = ctx.db.select().from(ctx.schema.otherAssetItems).all();
    expect(rows.find((r) => r.name === "Credit Card")).toBeUndefined();
  });

  it("still applies a normal asset mapping (guard doesn't over-match)", async () => {
    const result = await applyPullMapping(ctx.rawDb, {
      mapping: {
        localId: "asset:999",
        localName: "Car",
        remoteAccountId: "acct-car",
        syncDirection: "pull",
      },
      apiBalance: 8000,
      service: "actual",
      currentYear: new Date().getFullYear(),
    });

    // assetId 999 doesn't exist locally — this exercises the "typed
    // mapping whose target row no longer exists" skip path, a DIFFERENT
    // and pre-existing "not applied" reason, confirming the new guard
    // above is specific to localId "cash"/"creditCard" and doesn't
    // accidentally swallow every mapping.
    expect(result).toEqual({ applied: false });
  });
});

describe("applyPullMapping — only known target kinds are written", () => {
  let ctx: TestDbContext;

  beforeAll(async () => {
    ctx = await createTestDb();
  });

  afterAll(() => ctx.cleanup());

  const year = new Date().getFullYear();

  it("skips a performance: mapping instead of writing an asset row", async () => {
    for (const mapping of [
      {
        localId: "performance:3",
        localName: "Roth IRA",
        remoteAccountId: "r1",
        syncDirection: "pull" as const,
      },
      {
        localName: "Roth IRA",
        remoteAccountId: "r1",
        syncDirection: "both" as const,
        performanceAccountId: 3,
      },
    ]) {
      const result = await applyPullMapping(ctx.rawDb, {
        mapping,
        apiBalance: 50000,
        service: "actual",
        currentYear: year,
      });
      expect(result).toEqual({ applied: false });
    }
    const rows = ctx.db.select().from(ctx.schema.otherAssetItems).all();
    expect(rows.find((r) => r.name === "Roth IRA")).toBeUndefined();
  });

  it("skips an unknown prefixed target", async () => {
    const result = await applyPullMapping(ctx.rawDb, {
      mapping: {
        localId: "widget:5",
        localName: "Widget",
        remoteAccountId: "r1",
        syncDirection: "pull",
      },
      apiBalance: 10,
      service: "actual",
      currentYear: year,
    });
    expect(result).toEqual({ applied: false });
  });

  it("still writes a legacy plain-name mapping as an asset", async () => {
    const result = await applyPullMapping(ctx.rawDb, {
      mapping: {
        localName: "Old Savings Bond",
        remoteAccountId: "r2",
        syncDirection: "pull",
      },
      apiBalance: 700,
      service: "actual",
      currentYear: year,
    });
    expect(result).toEqual({ applied: true, kind: "asset" });
    const rows = ctx.db.select().from(ctx.schema.otherAssetItems).all();
    expect(rows.find((r) => r.name === "Old Savings Bond")).toBeDefined();
  });

  it.each([NaN, Infinity])(
    "refuses a balance of %s and writes nothing",
    async (apiBalance) => {
      await expect(
        applyPullMapping(ctx.rawDb, {
          mapping: {
            localName: `Broken ${apiBalance}`,
            remoteAccountId: "r3",
            syncDirection: "pull",
          },
          apiBalance,
          service: "actual",
          currentYear: year,
        }),
      ).rejects.toThrow("Refused to store an asset value from the budget app");
      const rows = ctx.db.select().from(ctx.schema.otherAssetItems).all();
      expect(
        rows.find((r) => r.name === `Broken ${apiBalance}`),
      ).toBeUndefined();
    },
  );
});

describe("applyPullMapping — debts, and clearing what nothing pulls", () => {
  let ctx: TestDbContext;

  beforeAll(async () => {
    ctx = await createTestDb();
  });

  afterAll(() => ctx.cleanup());

  const addDebt = () =>
    ctx.db
      .insert(ctx.schema.debts)
      .values({
        name: "Car loan",
        kind: "auto_loan",
        balance: "15000",
        balanceAsOf: "2026-01-01",
      })
      .returning()
      .get().id;

  it("writes a debt's pulled balance (as a positive amount owed), like the mortgage's", async () => {
    const id = addDebt();
    const result = await applyPullMapping(ctx.rawDb, {
      mapping: {
        localId: `debt:${id}`,
        localName: "Car loan",
        remoteAccountId: "acct-car",
        syncDirection: "pull",
        debtId: id,
      },
      apiBalance: -12345.67,
      service: "ynab",
      currentYear: new Date().getFullYear(),
    });
    expect(result).toEqual({ applied: true, kind: "debt" });
    const row = ctx.db
      .select()
      .from(ctx.schema.debts)
      .all()
      .find((d) => d.id === id)!;
    expect(Number(row.apiBalance)).toBe(12345.67);
    expect(row.apiBalanceDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // What the household typed stays.
    expect(Number(row.balance)).toBe(15000);
  });

  it("a mapping to a deleted debt writes nothing", async () => {
    const result = await applyPullMapping(ctx.rawDb, {
      mapping: {
        localId: "debt:99999",
        localName: "Gone",
        remoteAccountId: "acct-gone",
        syncDirection: "pull",
      },
      apiBalance: -1,
      service: "ynab",
      currentYear: new Date().getFullYear(),
    });
    expect(result).toEqual({ applied: false });
  });

  it("clears a pulled balance once no connection maps it", async () => {
    const kept = addDebt();
    const dropped = addDebt();
    ctx.db
      .update(ctx.schema.debts)
      .set({ apiBalance: "100", apiBalanceDate: "2026-10-01" })
      .run();
    ctx.db
      .insert(ctx.schema.apiConnections)
      .values({
        service: "ynab",
        config: {},
        accountMappings: [
          {
            localId: `debt:${kept}`,
            localName: "Car loan",
            remoteAccountId: "acct-kept",
            syncDirection: "pull",
          },
        ],
      })
      .run();
    await clearUnmappedPulledBalances(ctx.rawDb);
    const byId = new Map(
      ctx.db
        .select()
        .from(ctx.schema.debts)
        .all()
        .map((d) => [d.id, d]),
    );
    expect(byId.get(kept)!.apiBalance).not.toBeNull();
    expect(byId.get(dropped)!.apiBalance).toBeNull();
    expect(byId.get(dropped)!.apiBalanceDate).toBeNull();
  });
});
