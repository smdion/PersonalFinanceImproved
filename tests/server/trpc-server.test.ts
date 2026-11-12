/**
 * prefetchForShell loads the dashboard shell's queries for the layout, so
 * the shell and the page read the same saved settings and freshness dates
 * on the server as in the browser (no hydration mismatch); a shell query
 * failing never costs the others. prefetchForPage loads only the page's own
 * data. Each load is one request against the rate limit — its queries run
 * as internal calls.
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
  (): {
    tokensLeft: number;
    charged: string[];
    helperCtx: unknown;
    user: { id: string; role: string; permissions: string[] };
  } => ({
    tokensLeft: Infinity,
    charged: [],
    helperCtx: null,
    user: { id: "1", role: "admin", permissions: [] },
  }),
);
vi.mock("../../src/server/trpc", () => ({
  createContext: async () => ({ session: { user: state.user } }),
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
vi.mock("../../src/server/routers", () => ({ appRouter: {} }));

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

import { prefetchForPage, prefetchForShell } from "@/server/trpc-server";

type Helpers = { page: { prefetch: () => Promise<void> } };
const pagePrefetch = (h: unknown) => (h as Helpers).page.prefetch();

beforeEach(() => {
  privacy = false;
  state.tokensLeft = Infinity;
  state.charged.length = 0;
  state.user = { id: "1", role: "admin", permissions: [] };
  shellCalls.length = 0;
  settingsPrefetch = async () => undefined;
});

describe("prefetchForPage", () => {
  it("prefetches only the page's own data", async () => {
    const state = await prefetchForPage(pagePrefetch);
    expect(shellCalls).toEqual([]);
    expect(state?.queries.map((q) => q.queryKey)).toEqual([["page"]]);
  });

  it("privacy mode prefetches nothing", async () => {
    privacy = true;
    const page = vi.fn(pagePrefetch);
    expect(await prefetchForPage(page)).toBeUndefined();
    expect(page).not.toHaveBeenCalled();
  });

  it("a page load costs one rate-limit token; its queries run as internal calls", async () => {
    await prefetchForPage(pagePrefetch);
    expect(state.charged).toEqual(["page.prefetch"]);
    expect(state.helperCtx).toMatchObject({ internal: true });
  });

  it("when the budget is spent, prefetches nothing (the browser's fetch reports it)", async () => {
    state.tokensLeft = 0;
    const page = vi.fn(pagePrefetch);
    expect(await prefetchForPage(page)).toBeUndefined();
    expect(page).not.toHaveBeenCalled();
  });
});

describe("prefetchForShell", () => {
  it("prefetches the shell's queries and nothing else", async () => {
    const state = await prefetchForShell();
    expect(shellCalls).toEqual(
      expect.arrayContaining([
        "settings.appSettings.list",
        "simplefin.getStatus",
        "contributionProfile.list",
      ]),
    );
    expect(state?.queries).toEqual([]);
  });

  it("loads the holdings checks only for a viewer who may see them", async () => {
    state.user = { id: "2", role: "viewer", permissions: ["budget"] };
    await prefetchForShell();
    expect(shellCalls).not.toContain("investments.computeHealth");
    expect(shellCalls).toContain("simplefin.getStatus");
    shellCalls.length = 0;
    state.user = { id: "2", role: "viewer", permissions: ["portfolio"] };
    await prefetchForShell();
    expect(shellCalls).toContain("investments.computeHealth");
  });

  it("a shell query failing still returns a state", async () => {
    settingsPrefetch = async () => {
      throw new Error("down");
    };
    expect(await prefetchForShell()).toBeDefined();
  });

  it("privacy mode prefetches nothing", async () => {
    privacy = true;
    expect(await prefetchForShell()).toBeUndefined();
    expect(shellCalls).toEqual([]);
  });

  it("costs one rate-limit token; when it's spent, prefetches nothing", async () => {
    await prefetchForShell();
    expect(state.charged).toEqual(["shell.prefetch"]);
    expect(state.helperCtx).toMatchObject({ internal: true });
    shellCalls.length = 0;
    state.tokensLeft = 0;
    expect(await prefetchForShell()).toBeUndefined();
    expect(shellCalls).toEqual([]);
  });
});
