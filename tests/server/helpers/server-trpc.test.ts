/**
 * prefetchForPage always carries the dashboard shell's queries, so a page
 * rendered from prefetched data reads the same saved settings and freshness
 * dates on the server as in the browser (no hydration mismatch); a shell
 * query failing never costs the page its own data. A page load is one
 * request against the rate limit — its queries run as internal calls.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";

let privacy = false;
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (privacy ? { value: "1" } : undefined),
  }),
}));
const state = vi.hoisted(
  (): { tokensLeft: number; charged: string[]; helperCtx: unknown } => ({
    tokensLeft: Infinity,
    charged: [],
    helperCtx: null,
  }),
);
vi.mock("../../../src/server/trpc", () => ({
  createContext: async () => ({ session: { user: { id: "1" } } }),
  internalCtx: (ctx: object) => ({ ...ctx, internal: true }),
  takeAuthenticatedRateToken: async (_ctx: unknown, path: string) => {
    state.charged.push(path);
    state.tokensLeft -= 1;
    return {
      ok: state.tokensLeft >= 0,
      remaining: Math.max(0, state.tokensLeft),
    };
  },
}));
vi.mock("../../../src/server/routers", () => ({ appRouter: {} }));

let settingsPrefetch: () => Promise<void>;
const shellCalls: string[] = [];
/** Any `helpers.a.b.prefetch()` records its path; settings use the test's. */
function procedures(queryClient: QueryClient, path: string[] = []): unknown {
  return new Proxy(() => undefined, {
    get: (_t, key: string) => {
      if (key === "then") return undefined; // not a promise
      if (key === "queryClient") return queryClient;
      if (key === "prefetch")
        return async () => {
          const name = path.join(".");
          if (name === "page")
            return queryClient.setQueryData(["page"], { rows: 1 });
          shellCalls.push(name);
          if (name === "settings.appSettings.list") return settingsPrefetch();
        };
      return procedures(queryClient, [...path, key]);
    },
  });
}
vi.mock("@trpc/react-query/server", () => ({
  createServerSideHelpers: ({ ctx }: { ctx: unknown }) => {
    state.helperCtx = ctx;
    return procedures(new QueryClient());
  },
}));

import { prefetchForPage } from "@/server/helpers/server-trpc";

type Helpers = { page: { prefetch: () => Promise<void> } };
const pagePrefetch = (h: unknown) => (h as Helpers).page.prefetch();

beforeEach(() => {
  privacy = false;
  state.tokensLeft = Infinity;
  state.charged.length = 0;
  shellCalls.length = 0;
  settingsPrefetch = async () => undefined;
});

describe("prefetchForPage", () => {
  it("prefetches the shell's queries alongside the page's own data", async () => {
    const called = vi.fn(async () => undefined);
    settingsPrefetch = called;
    const state = await prefetchForPage(pagePrefetch);
    expect(called).toHaveBeenCalledTimes(1);
    expect(shellCalls).toEqual(
      expect.arrayContaining([
        "settings.appSettings.list",
        "settings.getDataFreshness",
        "contributionProfile.list",
      ]),
    );
    expect(state?.queries.map((q) => q.queryKey)).toEqual([["page"]]);
  });

  it("a shell query failing still returns the page's data", async () => {
    settingsPrefetch = async () => {
      throw new Error("down");
    };
    const state = await prefetchForPage(pagePrefetch);
    expect(state?.queries).toHaveLength(1);
  });

  it("privacy mode prefetches nothing", async () => {
    privacy = true;
    const called = vi.fn(async () => undefined);
    settingsPrefetch = called;
    expect(await prefetchForPage(pagePrefetch)).toBeUndefined();
    expect(called).not.toHaveBeenCalled();
    expect(shellCalls).toEqual([]);
  });

  it("a page load costs one rate-limit token; its queries run as internal calls", async () => {
    await prefetchForPage(pagePrefetch);
    expect(state.charged).toEqual(["page.prefetch"]);
    expect(state.helperCtx).toMatchObject({ internal: true });
  });

  it("when the budget is spent, prefetches nothing (the browser's fetch reports it)", async () => {
    state.tokensLeft = 0;
    expect(await prefetchForPage(pagePrefetch)).toBeUndefined();
    expect(shellCalls).toEqual([]);
  });
});
