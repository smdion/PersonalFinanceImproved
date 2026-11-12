/**
 * `demo.activateProfile` rebuilds a demo profile's shared schema, so it
 * takes the expensive tier: 5 a minute per visitor. On SQLite each call is
 * refused for its dialect after the limiter, which is all this needs.
 */
import "./setup-mocks";
import { describe, it, expect, beforeEach, vi } from "vitest";
import * as limiter from "@/lib/rate-limit";
import { createCallerFactory, type Context } from "@/server/trpc";
import { demoRouter } from "@/server/routers/demo";

const actual =
  await vi.importActual<typeof import("@/lib/rate-limit")>("@/lib/rate-limit");

function visitor(id = "visitor-1"): Context {
  return {
    db: {} as Context["db"],
    session: {
      user: {
        id,
        name: "Visitor",
        email: "v@v.com",
        role: "viewer",
        permissions: [],
      },
      expires: "2099-12-31T23:59:59.999Z",
    },
    demoSchema: null,
  };
}

describe("demo.activateProfile's rate limit", () => {
  beforeEach(() => {
    vi.mocked(limiter.rateLimit).mockImplementation(actual.rateLimit);
  });

  it("refuses a visitor's sixth activation in a minute", async () => {
    const caller = createCallerFactory(demoRouter)(visitor());
    for (let i = 0; i < 5; i++)
      await expect(
        caller.activateProfile({ slug: "single-income" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.activateProfile({ slug: "single-income" }),
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });

  it("refuses a slug no demo profile has before it takes a token", async () => {
    const caller = createCallerFactory(demoRouter)(visitor("visitor-2"));
    for (let i = 0; i < 5; i++)
      await expect(
        // @ts-expect-error -- a slug outside the profiles' set, as a request could send
        caller.activateProfile({ slug: "no-such-profile" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // Five refused slugs spent no token: a real slug still reaches the
    // dialect check (BAD_REQUEST on SQLite), not the limit.
    await expect(
      caller.activateProfile({ slug: "single-income" }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("PostgreSQL"),
    });
  });
});
