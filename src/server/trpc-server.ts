/**
 * Server-side tRPC caller for prefetching in Server Components: a page passes
 * `await prefetchForPage(async (helpers) => ...)` to its `<HydrationBoundary state>`.
 */
import { dehydrate, type DehydratedState } from "@tanstack/react-query";
import { createServerSideHelpers } from "@trpc/react-query/server";
import { cookies } from "next/headers";
import { PRIVACY_COOKIE } from "@/lib/utils/format";
import { createContext, internalCtx, takeAuthenticatedRateToken } from "./trpc";
import { appRouter } from "./routers";

/**
 * Server helpers for a page render. Its queries run as internal calls (no
 * per-query throttle): prefetchForPage charges the page load once instead,
 * so a page that prefetches a dozen queries costs one request, not twelve.
 */
async function createServerHelpers() {
  const ctx = await createContext();
  return {
    ctx,
    helpers: createServerSideHelpers({
      router: appRouter,
      ctx: internalCtx(ctx),
    }),
  };
}

type ServerHelpers = Awaited<ReturnType<typeof createServerHelpers>>["helpers"];

/**
 * The no-input queries the dashboard shell loads on every page (data indicator, profile pickers,
 * saved settings), prefetched only by the layout (prefetchForShell).
 * tests/lint/shell-prefetch.test.ts keeps this list equal to what the shell loads.
 */
function prefetchShellQueries(h: ServerHelpers): Promise<unknown>[] {
  return [
    h.settings.appSettings.list.prefetch(),
    h.settings.getDataFreshness.prefetch(),
    h.settings.taxData.getStatus.prefetch(),
    h.settings.scenarios.list.prefetch(),
    h.sync.getActiveBudgetApiLink.prefetch(),
    h.sync.getSyncStatus.prefetch(),
    h.simplefin.getStatus.prefetch(),
    h.sec.getStatus.prefetch(),
    h.investments.computeHealth.prefetch(),
    h.contributionProfile.list.prefetch(),
    h.contributionProfile.compareData.prefetch(),
    h.salaryProfile.list.prefetch(),
    h.retirement.retirementProfiles.list.prefetch(),
    h.budget.listProfiles.prefetch(),
  ].map((p) => p.catch(() => undefined));
}

/**
 * Run a page's server prefetch and return the dehydrated cache for its HydrationBoundary, or
 * undefined (client fetches) on any error or in privacy mode, where server-rendered data would put
 * real amounts in the first HTML. The shell's queries come from prefetchForShell, not here.
 */
export async function prefetchForPage(
  prefetch: (helpers: ServerHelpers) => Promise<unknown>,
): Promise<DehydratedState | undefined> {
  return prefetchDehydrated("page.prefetch", prefetch);
}

/** The shell's queries, hydrated by the dashboard layout above the shell and
 *  the page, so both render them from the same data on the server and in the
 *  browser. */
export async function prefetchForShell(): Promise<DehydratedState | undefined> {
  return prefetchDehydrated("shell.prefetch", (helpers) =>
    Promise.all(prefetchShellQueries(helpers)),
  );
}

async function prefetchDehydrated(
  path: string,
  run: (helpers: ServerHelpers) => Promise<unknown>,
): Promise<DehydratedState | undefined> {
  const cookieStore = await cookies();
  if (cookieStore.get(PRIVACY_COOKIE)?.value === "1") return undefined;
  try {
    const { ctx, helpers } = await createServerHelpers();
    // One load = one request against the user's rate limit; when it's
    // spent, skip the prefetch and let the browser's own fetch report it.
    if (!(await takeAuthenticatedRateToken(ctx, path)).ok) return undefined;
    await run(helpers);
    return dehydrate(helpers.queryClient);
  } catch {
    return undefined;
  }
}
