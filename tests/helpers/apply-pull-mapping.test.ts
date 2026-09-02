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
import { applyPullMapping } from "@/server/helpers/apply-pull-mapping";
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
