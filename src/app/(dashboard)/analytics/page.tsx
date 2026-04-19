/**
 * Analytics page — per-account holdings, allocation vs. glide-path target, drift, and blended ER.
 */

import {
  HydrationBoundary,
  dehydrate,
  type DehydratedState,
} from "@tanstack/react-query";
import { createServerHelpers } from "@/server/helpers/server-trpc";
import { AnalyticsContent } from "./analytics-content";

export default async function AnalyticsPage() {
  let dehydratedState: DehydratedState | undefined = undefined;
  try {
    const helpers = await createServerHelpers();
    await Promise.all([
      helpers.analytics.getAccounts.prefetch().catch(() => undefined),
      helpers.analytics.getSnapshots.prefetch().catch(() => undefined),
      helpers.analytics.getAssetClasses.prefetch().catch(() => undefined),
      helpers.analytics.hasFmpKey.prefetch().catch(() => undefined),
    ]);
    dehydratedState = dehydrate(helpers.queryClient);
  } catch {
    dehydratedState = undefined;
  }

  return (
    <HydrationBoundary state={dehydratedState}>
      <AnalyticsContent />
    </HydrationBoundary>
  );
}
