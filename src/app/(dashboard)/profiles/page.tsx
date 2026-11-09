/**
 * Profiles page: Salary, Contribution, Savings and Retirement profiles plus
 * the What-If sandbox. Shares BudgetContent's queries and the Budget prefetch.
 */
import { HydrationBoundary } from "@tanstack/react-query";
import { prefetchForPage } from "@/server/trpc-server";
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
