/**
 * Budget server page: prefetches budget.listProfiles and
 * budget.computeActiveSummary (column 0, no profileId: the persisted column is
 * unknown on the server). Prefetch errors fall back to the client fetch.
 */

import { HydrationBoundary } from "@tanstack/react-query";
import { redirect } from "next/navigation";
import { prefetchForPage } from "@/server/trpc-server";
import { BudgetContent } from "./budget-content";
import { PROFILE_TABS, profilesHref } from "@/lib/config/profile-tabs";

export default async function BudgetPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // The profile tabs moved to /profiles — keep old links (?tab=whatif,
  // bookmarks) working.
  const { tab } = await searchParams;
  const profileTab = PROFILE_TABS.find((t) => t.key === tab);
  if (profileTab) redirect(profilesHref(profileTab.key));
  const dehydratedState = await prefetchForPage(async (helpers) => {
    await Promise.all([
      helpers.budget.listProfiles.prefetch().catch(() => undefined),
      helpers.budget.computeActiveSummary
        .prefetch({ selectedColumn: 0 })
        .catch(() => undefined),
    ]);
  });

  return (
    <HydrationBoundary state={dehydratedState}>
      <BudgetContent section="budget" />
    </HydrationBoundary>
  );
}
