/**
 * Profiles page — Salary, Contribution, Savings and Retirement profiles and
 * the What-If sandbox (the profile tabs that used to sit on the Budget
 * page). Shares BudgetContent's queries; same prefetch as the Budget page.
 */
import { HydrationBoundary } from "@tanstack/react-query";
import { prefetchForPage } from "@/server/helpers/server-trpc";
import { BudgetContent } from "../budget/budget-content";

export default async function ProfilesPage() {
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
      <BudgetContent section="profiles" />
    </HydrationBoundary>
  );
}
