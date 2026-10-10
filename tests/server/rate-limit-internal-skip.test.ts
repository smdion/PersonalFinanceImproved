/**
 * authenticatedRateLimitMiddleware's `internal` skip (src/server/trpc.ts) —
 * exercised end-to-end through a real protectedProcedure-based caller, not
 * just read from the source, so a regression that stops checking
 * `ctx.internal` (or checks it on the wrong middleware) would actually
 * fail this test.
 */
import "../routers/setup-mocks";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { rateLimit } from "@/lib/rate-limit";
import {
  createTRPCRouter,
  protectedProcedure,
  createCallerFactory,
  internalCtx,
  type Context,
} from "@/server/trpc";

const mockedRateLimit = vi.mocked(rateLimit);

const testRouter = createTRPCRouter({
  ping: protectedProcedure.query(() => "pong"),
});

function fakeCtx(): Context {
  return {
    db: {} as Context["db"],
    session: {
      user: {
        id: "1",
        name: "Test",
        email: "t@t.com",
        role: "viewer",
        permissions: [],
      },
      expires: "2099-12-31T23:59:59.999Z",
    },
    demoSchema: null,
  };
}

describe("authenticatedRateLimitMiddleware — internal skip", () => {
  beforeEach(() => {
    mockedRateLimit.mockClear();
  });

  it("a normal (non-internal) call goes through the rate limiter", async () => {
    const caller = createCallerFactory(testRouter)(fakeCtx());
    const result = await caller.ping();
    expect(result).toBe("pong");
    expect(mockedRateLimit).toHaveBeenCalledTimes(1);
  });

  it("internalCtx() exempts a nested call from the rate limiter entirely", async () => {
    const caller = createCallerFactory(testRouter)(internalCtx(fakeCtx()));
    const result = await caller.ping();
    expect(result).toBe("pong");
    expect(mockedRateLimit).not.toHaveBeenCalled();
  });

  it("internalCtx() does not disable the auth check itself — an internal call with no session still gets rejected", async () => {
    const ctxNoSession: Context = {
      db: {} as Context["db"],
      session: null,
      demoSchema: null,
    };
    const caller = createCallerFactory(testRouter)(internalCtx(ctxNoSession));
    await expect(caller.ping()).rejects.toThrow();
  });
});
