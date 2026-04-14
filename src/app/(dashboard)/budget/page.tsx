/**
 * Budget server page (v0.5.2 file-split refactor).
 *
 * Server-side prefetches the two heavy queries the budget client needs
 * on first paint:
 *   - budget.listProfiles      (drives the profile sidebar rail)
 *   - budget.computeActiveSummary (drives the main budget table +
 *     summary bar + payroll breakdown; uses default column 0 + no
 *     profileId override because we don't know the user's
 *     persisted activeColumn selection on the server)
 *
 * Prefetch failures don't block rendering — wrapped in try/catch so
 * the client falls back to its own fetch on error. Matches the
 * portfolio / retirement prefetch-shell pattern.
 */

import {
  HydrationBoundary,
  dehydrate,
  type DehydratedState,
} from "@tanstack/react-query";
import { createServerHelpers } from "@/server/helpers/server-trpc";
import { BudgetContent } from "./budget-content";

export default async function BudgetPage() {
  let dehydratedState: DehydratedState | undefined = undefined;
  try {
    const helpers = await createServerHelpers();
    await Promise.all([
      helpers.budget.listProfiles.prefetch().catch(() => undefined),
      helpers.budget.computeActiveSummary
        .prefetch({ selectedColumn: 0 })
        .catch(() => undefined),
    ]);
    dehydratedState = dehydrate(helpers.queryClient);
  } catch {
    dehydratedState = undefined;
  }

  return (
    <HydrationBoundary state={dehydratedState}>
      <BudgetContent />
    </HydrationBoundary>
  );
}
