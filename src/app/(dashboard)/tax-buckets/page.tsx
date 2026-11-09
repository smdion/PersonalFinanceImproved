/**
 * Tax Buckets page: current tax-bucket breakdown and early-access analysis.
 * Prefetches taxBuckets.computeBreakdown (no input); the "At Retirement"
 * projection depends on client-resolved profiles, so it isn't prefetched.
 */
import { HydrationBoundary } from "@tanstack/react-query";
import { prefetchForPage } from "@/server/trpc-server";
import { TaxBucketsContent } from "./tax-buckets-content";

export default async function TaxBucketsPage() {
  const dehydratedState = await prefetchForPage(async (helpers) => {
    await helpers.taxBuckets.computeBreakdown.prefetch().catch(() => undefined);
  });

  return (
    <HydrationBoundary state={dehydratedState}>
      <TaxBucketsContent />
    </HydrationBoundary>
  );
}
