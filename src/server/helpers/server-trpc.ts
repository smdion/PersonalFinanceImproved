/**
 * Server-side tRPC caller for prefetching data in Server Components.
 *
 * Usage in a server component (layout or page wrapper):
 *
 *   import { prefetchForPage } from '@/server/helpers/server-trpc';
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
import { createContext } from "../trpc";
import { appRouter } from "../routers";

export async function createServerHelpers() {
  const ctx = await createContext();
  return createServerSideHelpers({
    router: appRouter,
    ctx,
  });
}

type ServerHelpers = Awaited<ReturnType<typeof createServerHelpers>>;

/**
 * The no-input queries the dashboard shell loads on every page — the
 * sidebar's data indicator (useDataSourceStatuses), the header's profile
 * pickers (scenario-bar), saved settings (usePersistedSetting). In the
 * browser they're cached before a page's own section hydrates, so a page
 * that reads one while rendering from prefetched data must have it on the
 * server too, or the two renders differ (a hydration mismatch).
 * tests/lint/shell-prefetch.test.ts keeps this list equal to what the shell
 * actually loads.
 */
function prefetchShellQueries(h: ServerHelpers): Promise<unknown>[] {
  return [
    h.settings.appSettings.list.prefetch(),
    h.settings.getDataFreshness.prefetch(),
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
 *
 * The shell's own queries are always prefetched too (prefetchShellQueries):
 * a page rendered from prefetched data that reads one — a saved choice, the
 * data-freshness dates — would otherwise render it empty on the server and
 * filled in the browser, a hydration mismatch.
 *
 * Prefetch failures never block rendering — any error also yields undefined.
 */
export async function prefetchForPage(
  prefetch: (helpers: ServerHelpers) => Promise<unknown>,
): Promise<DehydratedState | undefined> {
  const cookieStore = await cookies();
  if (cookieStore.get(PRIVACY_COOKIE)?.value === "1") return undefined;
  try {
    const helpers = await createServerHelpers();
    await Promise.all([prefetch(helpers), ...prefetchShellQueries(helpers)]);
    return dehydrate(helpers.queryClient);
  } catch {
    return undefined;
  }
}
