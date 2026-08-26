/**
 * Tax Buckets page — real current-state tax-bucket breakdown, Rule of 55 /
 * Roth-basis-driven early-access analysis. Standalone tool, independent of
 * the Retirement page's own scenario/profile system.
 *
 * Server-side prefetches taxBuckets.computeBreakdown — takes no input, so
 * this prefetch always matches the client's eventual default ("now") view
 * query exactly (no profile-resolution mismatch risk). Previously
 * prefetched `projection.computeProjection` instead, which the client
 * never calls with matching cache-key input (code review, 2026-08-27) —
 * every visit paid for an unused server round-trip while the real data
 * still did a full client-side waterfall. The "At Retirement" view's
 * `projection.computeProjection` call (profile-dependent input) is
 * deliberately NOT prefetched here, same reasoning as
 * contributions/page.tsx: a guessed input wouldn't match either.
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
    await helpers.taxBuckets.computeBreakdown.prefetch().catch(() => undefined);
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
