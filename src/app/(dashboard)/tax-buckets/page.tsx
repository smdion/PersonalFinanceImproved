/**
 * Tax Buckets page — real current-state tax-bucket breakdown, Rule of 55 /
 * Roth-basis-driven early-access analysis. Standalone tool, independent of
 * the Retirement page's own scenario/profile system.
 */
import {
  HydrationBoundary,
  dehydrate,
  type DehydratedState,
} from "@tanstack/react-query";
import { createServerHelpers } from "@/server/helpers/server-trpc";
import { TaxBucketsContent } from "./tax-buckets-content";

export default async function TaxBucketsPage() {
  let dehydratedState: DehydratedState | undefined = undefined;
  try {
    const helpers = await createServerHelpers();
    await Promise.all([
      helpers.projection.computeProjection
        .prefetch({ metadataOnly: true })
        .catch(() => undefined),
    ]);
    dehydratedState = dehydrate(helpers.queryClient);
  } catch {
    dehydratedState = undefined;
  }

  return (
    <HydrationBoundary state={dehydratedState}>
      <TaxBucketsContent />
    </HydrationBoundary>
  );
}
