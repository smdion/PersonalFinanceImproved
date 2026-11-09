/**
 * Server-side tRPC caller for prefetching data in Server Components.
 *
 * Usage in a server component (layout or page wrapper):
 *
 *   import { prefetchForPage } from '@/server/trpc-server';
 *
 *   export default async function Page() {
 *     const dehydratedState = await prefetchForPage(async (helpers) => {
 *       await helpers.networth.computeSummary.prefetch().catch(() => undefined);
 *     });
 *     return (
 *       <HydrationBoundary state={dehydratedState}>
 *         <ClientPage />
 *       </HydrationBoundary>
 *     );
 *   }
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
 * The no-input queries the dashboard shell loads on every page — the
 * sidebar's data indicator (useDataSourceStatuses), the header's profile
 * pickers (scenario-bar), saved settings (usePersistedSetting). Only the
 * layout loads them (prefetchForShell), above the shell and the page.
 * tests/lint/shell-prefetch.test.ts keeps this list equal to what the shell
 * actually loads.
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
    h.investments.getHealth.prefetch(),
    h.contributionProfile.list.prefetch(),
    h.contributionProfile.compareData.prefetch(),
    h.salaryProfile.list.prefetch(),
    h.retirement.retirementProfiles.list.prefetch(),
    h.budget.listProfiles.prefetch(),
  ].map((p) => p.catch(() => undefined));
}

/**
 * Run a page's server prefetch and return the dehydrated cache for its
 * HydrationBoundary, or undefined so the client fetches for itself.
 *
 * Returns undefined without prefetching when privacy mode is on: prefetched
 * data would be rendered on the server, where the privacy flag is never set
 * (see setPrivacyMode), so real amounts would reach the first HTML before
 * the browser masks them. Skipping it costs a loading state on first paint.
 * The shell's queries come from the layout (prefetchForShell), not here.
 *
 * Prefetch failures never block rendering — any error also yields undefined.
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
