/** SEC router: contact handling, status and refresh limits. SEC is mocked. */
import "./setup-mocks";
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import * as sqliteSchema from "@/lib/db/schema-sqlite";
import { userMessageFor } from "@/lib/budget-api/errors";

const mocks = vi.hoisted(() => ({ refuse: false, bad: false }));
vi.mock("@/lib/sec/client", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/sec/client")>(
      "@/lib/sec/client",
    );
  return {
    ...actual,
    testSecContact: vi.fn(async () => {
      if (mocks.refuse)
        throw new actual.SecRateLimitError("SEC declined the request (403)");
      if (mocks.bad) {
        const { serviceError } = await import("@/lib/budget-api/errors");
        const e = serviceError("SEC", "SEC: tickers: not JSON", "bad-response");
        e.field = "fields";
        throw e;
      }
      return 1234;
    }),
  };
});
vi.mock("@/lib/sec/facts-sync", async () => {
  const actual = await vi.importActual<typeof import("@/lib/sec/facts-sync")>(
    "@/lib/sec/facts-sync",
  );
  return {
    ...actual,
    syncSecurityFacts: vi.fn(async () => ({
      checked: 0,
      updated: 0,
      unresolved: 0,
      stoppedBySec: false,
      errors: [],
    })),
  };
});

const KEY = randomBytes(32).toString("base64");
let originalKey: string | undefined;
beforeAll(() => {
  originalKey = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = KEY;
});
afterAll(() => {
  if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = originalKey;
});

import {
  createTestCaller,
  createViewerSessionWithPermissions,
  viewerSession,
} from "./setup";

describe("sec router", () => {
  let ctx: Awaited<ReturnType<typeof createTestCaller>>;
  beforeAll(async () => {
    ctx = await createTestCaller();
  });
  afterAll(() => ctx.cleanup());

  it("rejects something that isn't an email", async () => {
    await expect(
      ctx.caller.sec.saveContact({ contactEmail: "not-an-email" }),
    ).rejects.toThrow();
  });

  it("doesn't save a contact SEC refuses", async () => {
    mocks.refuse = true;
    await expect(
      ctx.caller.sec.saveContact({ contactEmail: "person@example.com" }),
    ).rejects.toThrow(/declined/);
    expect((await ctx.caller.sec.getStatus()).connected).toBe(false);
    mocks.refuse = false;
  });

  it("a bad answer from SEC says so, keeps the cause, and saves nothing", async () => {
    mocks.bad = true;
    const error = await ctx.caller.sec
      .saveContact({ contactEmail: "person@example.com" })
      .then(
        () => null,
        (e: unknown) => e,
      );
    const said =
      "SEC sent something Ledgr doesn't understand (fields). Nothing was changed.";
    expect((error as Error).message).toBe(said);
    expect(userMessageFor(error)).toBe(said);
    expect((await ctx.caller.sec.getStatus()).connected).toBe(false);
    mocks.bad = false;
  });

  it("saves an accepted contact and never returns it", async () => {
    await ctx.caller.sec.saveContact({ contactEmail: "person@example.com" });
    const status = await ctx.caller.sec.getStatus();
    expect(status.connected).toBe(true);
    expect(JSON.stringify(status)).not.toContain("person@example.com");
    const stored = ctx.db.select().from(sqliteSchema.apiConnections).all();
    expect(JSON.stringify(stored)).not.toContain("person@example.com"); // encrypted at rest
  });

  it("testConnection words a bad answer as one, not as unreachable", async () => {
    mocks.bad = true;
    expect(await ctx.caller.sec.testConnection()).toEqual({
      success: false,
      error: "SEC sent something Ledgr doesn't understand (fields).",
    });
    mocks.bad = false;
  });

  it("limits manual refreshes", async () => {
    await ctx.caller.sec.refreshNow();
    await expect(ctx.caller.sec.refreshNow()).rejects.toThrow(/moments ago/);
  });

  it("needs the sync permission to change anything", async () => {
    for (const session of [
      viewerSession,
      createViewerSessionWithPermissions(["portfolio"]),
    ]) {
      const other = await createTestCaller(session);
      try {
        await expect(
          other.caller.sec.saveContact({ contactEmail: "a@b.co" }),
        ).rejects.toThrow();
        await expect(other.caller.sec.removeConnection()).rejects.toThrow();
      } finally {
        other.cleanup();
      }
    }
  });
});
