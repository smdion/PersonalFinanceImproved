/**
 * The tRPC rate-limit tiers (src/server/trpc.ts) count apart: a signed-in
 * viewer's requests keyed by address never spend the public tier's budget,
 * so the sign-in page's public queries aren't refused after 60 requests of
 * any kind in a minute.
 */
import "../routers/setup-mocks";
import { describe, it, expect, beforeEach, vi } from "vitest";
import * as limiter from "@/lib/rate-limit";
import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
  createCallerFactory,
  type Context,
} from "@/server/trpc";

const actual =
  await vi.importActual<typeof import("@/lib/rate-limit")>("@/lib/rate-limit");

const testRouter = createTRPCRouter({
  open: publicProcedure.query(() => "open"),
  signedIn: protectedProcedure.query(() => "signed in"),
});

/** A signed-in viewer with no user id: keyed by address, as the public tier is. */
function viewerWithoutId(): Context {
  return {
    db: {} as Context["db"],
    session: {
      user: {
        id: "",
        name: "Viewer",
        email: "v@v.com",
        role: "viewer",
        permissions: [],
      },
      expires: "2099-12-31T23:59:59.999Z",
    },
    demoSchema: null,
  };
}

describe("rate-limit tiers", () => {
  beforeEach(() => {
    vi.mocked(limiter.rateLimit).mockImplementation(actual.rateLimit);
    // Each case starts with fresh windows (headers are mocked: key "unknown").
    actual.clearRateLimit("public:unknown");
    actual.clearRateLimit("authenticated:unknown");
  });

  it("a signed-in viewer's 60 requests leave the public tier's budget whole", async () => {
    const caller = createCallerFactory(testRouter)(viewerWithoutId());
    for (let i = 0; i < 60; i++) await caller.signedIn();
    await expect(caller.open()).resolves.toBe("open");
  });

  it("the public tier still refuses its 61st request", async () => {
    const caller = createCallerFactory(testRouter)(viewerWithoutId());
    for (let i = 0; i < 60; i++) await caller.open();
    await expect(caller.open()).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
    });
  });
});
