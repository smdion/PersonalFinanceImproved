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
 * Run a page's server prefetch and return the dehydrated cache for its
 * HydrationBoundary, or undefined so the client fetches for itself.
 *
 * Returns undefined without prefetching when privacy mode is on: prefetched
 * data would be rendered on the server, where the privacy flag is never set
 * (see setPrivacyMode), so real amounts would reach the first HTML before
 * the browser masks them. Skipping it costs a loading state on first paint.
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
    await prefetch(helpers);
    return dehydrate(helpers.queryClient);
  } catch {
    return undefined;
  }
}
