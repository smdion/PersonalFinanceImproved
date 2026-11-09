/**
 * Expenses server page: prefetches the input-free budget.listApiCategories and
 * listApiActuals; the rest depend on client-resolved profiles or period state.
 */

import { HydrationBoundary } from "@tanstack/react-query";
import { prefetchForPage } from "@/server/trpc-server";
import { ExpensesContent } from "./expenses-content";

export default async function ExpensesPage() {
  const dehydratedState = await prefetchForPage(async (helpers) => {
    await Promise.all([
      helpers.budget.listApiCategories.prefetch().catch(() => undefined),
      helpers.budget.listApiActuals.prefetch().catch(() => undefined),
    ]);
  });

  return (
    <HydrationBoundary state={dehydratedState}>
      <ExpensesContent />
    </HydrationBoundary>
  );
}
