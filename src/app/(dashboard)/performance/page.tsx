/**
 * Performance server page (server-prefetch split, R5).
 *
 * Server-side prefetches the two no-input queries PerformanceContent needs
 * on first paint:
 *   - performance.computeSummary — the source of truth for the page's
 *     annual/account performance tables. Takes no input, so the prefetch
 *     cache key matches the client's eventual query exactly (same as
 *     brokerage.computeSummary).
 *   - settings.appSettings.list — read by the six usePersistedSetting()
 *     calls in PerformanceContent (basis/unrealized/only-basis column
 *     toggles, custom-filter enable, account ids, year range). Without it
 *     the table renders with all six defaults, then snaps to persisted
 *     state on hydration. The hook is hydration-safe by design (it
 *     deliberately starts at defaultValue), so seeding its query is purely
 *     additive.
 *
 * Prefetch failures don't block rendering — wrapped in try/catch so the
 * client falls back to its own fetch on error.
 */

import {
  HydrationBoundary,
  dehydrate,
  type DehydratedState,
} from "@tanstack/react-query";
import { createServerHelpers } from "@/server/helpers/server-trpc";
import { PerformanceContent } from "./performance-content";

export default async function PerformancePage() {
  let dehydratedState: DehydratedState | undefined = undefined;
  try {
    const helpers = await createServerHelpers();
    await Promise.all([
      helpers.performance.computeSummary.prefetch().catch(() => undefined),
      helpers.settings.appSettings.list.prefetch().catch(() => undefined),
    ]);
    dehydratedState = dehydrate(helpers.queryClient);
  } catch {
    dehydratedState = undefined;
  }

  return (
    <HydrationBoundary state={dehydratedState}>
      <PerformanceContent />
    </HydrationBoundary>
  );
}
