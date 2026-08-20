/**
 * Expenses server page (server-prefetch split, Phase 2 item 2i).
 *
 * Server-side prefetches budget.listApiCategories and budget.listApiActuals
 * — both take no input, so these prefetches always match the client's
 * eventual queries exactly. budget.computeActiveSummary, paycheck.
 * computeSummary, and sync.computeExpenseComparison aren't prefetched:
 * their inputs depend on client-resolved profile/scenario tiers or
 * period-selector state not available server-side.
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
import { ExpensesContent } from "./expenses-content";

export default async function ExpensesPage() {
  let dehydratedState: DehydratedState | undefined = undefined;
  try {
    const helpers = await createServerHelpers();
    await Promise.all([
      helpers.budget.listApiCategories.prefetch().catch(() => undefined),
      helpers.budget.listApiActuals.prefetch().catch(() => undefined),
    ]);
    dehydratedState = dehydrate(helpers.queryClient);
  } catch {
    dehydratedState = undefined;
  }

  return (
    <HydrationBoundary state={dehydratedState}>
      <ExpensesContent />
    </HydrationBoundary>
  );
}
