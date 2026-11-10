/**
 * What the fund mutations that ask SEC tell a user when SEC fails, and
 * that it's true: before any write "Nothing was changed."; after one, what
 * was saved. SEC is mocked; funds are invented.
 */
import "./setup-mocks";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import * as sqliteSchema from "@/lib/db/schema-sqlite";
import { userMessageFor } from "@/lib/budget-api/errors";

const sec = vi.hoisted(() => ({
  tickersFail: false,
  syncFails: false,
}));
const badAnswer = async () => {
  const { serviceError } = await import("@/lib/budget-api/errors");
  const e = serviceError("SEC", "SEC: registry: bad", "bad-response");
  e.field = "0.seriesId";
  return e;
};
vi.mock("@/lib/sec/client", async (orig) => ({
  ...(await orig<typeof import("@/lib/sec/client")>()),
  fetchFundTickers: vi.fn(async () => {
    if (sec.tickersFail) throw await badAnswer();
    return new Map([["NEWFX", { seriesId: "S1", classId: "C1" }]]);
  }),
}));
vi.mock("@/server/services/investments/sec-facts", () => ({
  syncSecurityFacts: vi.fn(async () => {
    if (sec.syncFails) throw await badAnswer();
    return {
      checked: 1,
      updated: 0,
      unresolved: 0,
      stoppedBySec: false,
      errors: [],
    };
  }),
}));

import { createTestCaller } from "./setup";
import { saveSecConnection } from "@/lib/sec/connection";

const KEY = randomBytes(32).toString("base64");
let t: Awaited<ReturnType<typeof createTestCaller>>;
let originalKey: string | undefined;
beforeEach(async () => {
  originalKey = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = KEY;
  t = await createTestCaller();
  await saveSecConnection(t.rawDb, "person@example.com");
  sec.tickersFail = false;
  sec.syncFails = false;
});
afterEach(() => {
  t.cleanup();
  if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = originalKey;
});

const failure = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => e,
  );
const securities = () => t.db.select().from(sqliteSchema.securities).all();
const security = (id: number) =>
  t.db
    .select()
    .from(sqliteSchema.securities)
    .where(eq(sqliteSchema.securities.id, id))
    .get()!;
const SAID = "SEC sent something Ledgr doesn't understand (0.seriesId).";

describe("addFundByTicker when SEC fails", () => {
  it("before the fund is added: nothing was changed, and nothing was", async () => {
    sec.tickersFail = true;
    const before = securities();
    const error = await failure(
      t.caller.investments.addFundByTicker({ ticker: "NEWFX" }),
    );
    expect(userMessageFor(error)).toBe(`${SAID} Nothing was changed.`);
    expect(securities()).toEqual(before);
  });

  it("after the fund is added: says it was added, and it was", async () => {
    sec.syncFails = true;
    const error = await failure(
      t.caller.investments.addFundByTicker({ ticker: "NEWFX" }),
    );
    expect(userMessageFor(error)).toBe(
      `${SAID} Added the fund; its facts will be fetched on the next refresh.`,
    );
    const added = securities().find((s) => s.ticker === "NEWFX");
    // Unchecked, so the next refresh picks it up.
    expect(added).toMatchObject({ factsCheckedAt: null });
  });
});

describe("stand-in mutations when SEC fails", () => {
  const seed = (values: Partial<typeof sqliteSchema.securities.$inferInsert>) =>
    t.db
      .insert(sqliteSchema.securities)
      .values({
        name: "Example Plan Fund",
        kind: "mutual_fund",
        sourceSymbol: "ZZPQ",
        factsSeriesId: "S4",
        factsSeriesName: "Example LifeStage Fund",
        ...values,
      })
      .returning()
      .get().id;

  it("confirmStandIn says the stand-in is confirmed, and it is", async () => {
    const id = seed({ factsBasis: "standin" });
    sec.syncFails = true;
    const error = await failure(
      t.caller.investments.confirmStandIn({ securityId: id }),
    );
    expect(userMessageFor(error)).toBe(
      `${SAID} The stand-in is confirmed; its facts will be fetched on the next refresh.`,
    );
    expect(security(id).standinConfirmedAt).not.toBeNull();
    expect(security(id).factsCheckedAt).toBeNull();
  });

  it("findStandIn after 'not a match' says it will look again, and it will", async () => {
    const id = seed({ factsBasis: "none", factsCheckedAt: new Date() });
    sec.syncFails = true;
    const error = await failure(
      t.caller.investments.findStandIn({ securityId: id }),
    );
    expect(userMessageFor(error)).toBe(
      `${SAID} Ledgr will look for a stand-in on the next refresh.`,
    );
    expect(security(id)).toMatchObject({
      factsBasis: null,
      factsCheckedAt: null,
    });
  });

  it("findStandIn on a fund it didn't reopen claims nothing", async () => {
    const id = seed({ factsBasis: "exact" });
    sec.syncFails = true;
    const error = await failure(
      t.caller.investments.findStandIn({ securityId: id }),
    );
    expect(userMessageFor(error)).toBe(SAID);
    expect(security(id).factsBasis).toBe("exact");
  });
});
