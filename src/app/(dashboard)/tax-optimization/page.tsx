/**
 * Tax Optimization server page: prefetches `computeTaxProjection({})`, which matches the
 * client's first query (IRMAA callout, brackets note). The strategy and Roth tabs
 * depend on profiles/selection and load on the client.
 */
import { HydrationBoundary } from "@tanstack/react-query";
import { prefetchForPage } from "@/server/trpc-server";
import { TaxOptimizationContent } from "./tax-optimization-content";

export default async function TaxOptimizationPage() {
  const dehydratedState = await prefetchForPage(async (helpers) => {
    await helpers.projection.computeTaxProjection
      .prefetch({})
      .catch(() => undefined);
  });

  return (
    <HydrationBoundary state={dehydratedState}>
      <TaxOptimizationContent />
    </HydrationBoundary>
  );
}
