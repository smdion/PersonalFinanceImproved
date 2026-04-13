/**
 * Dashboard server page (v0.5 expert-review M7).
 *
 * Server-side prefetches the most expensive dashboard queries so the
 * cards hydrate with data immediately on first paint instead of
 * waterfalling through useQuery on the client. The DashboardContent
 * client component consumes the same queries via tRPC hooks — they
 * read prefetched data from the React Query cache.
 *
 * Prefetch failures don't block the page render — the cards fall
 * back to client-side fetching, which is the previous v0.4 behavior.
 */

import {
  HydrationBoundary,
  dehydrate,
  type DehydratedState,
} from "@tanstack/react-query";
import { createServerHelpers } from "@/server/helpers/server-trpc";
import { DashboardContent } from "./dashboard-content";

export default async function DashboardPage() {
  let dehydratedState: DehydratedState | undefined = undefined;
  try {
    const helpers = await createServerHelpers();
    // Prefetch the queries the dashboard cards consume. Each Promise.all
    // member is independent — one failure doesn't block the others.
    // We prefetch the high-traffic networth + onboarding queries; other
    // cards still client-fetch (incremental rollout).
    await Promise.all([
      helpers.networth.computeSummary.prefetch().catch(() => undefined),
      helpers.settings.isOnboardingComplete.prefetch().catch(() => undefined),
    ]);
    dehydratedState = dehydrate(helpers.queryClient);
  } catch {
    // Swallow — fall back to pure client-side fetching.
    dehydratedState = undefined;
  }

  return (
    <HydrationBoundary state={dehydratedState}>
      <DashboardContent />
    </HydrationBoundary>
  );
}
