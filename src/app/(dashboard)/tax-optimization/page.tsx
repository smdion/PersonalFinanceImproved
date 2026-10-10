/**
 * Tax Optimization page — server shell.
 *
 * Mirrors `tax-buckets/page.tsx`: prefetch the default view on the server,
 * dehydrate, hand off to the client content component. The default
 * `projectTaxYears` input is `{}` — every field on `taxOptimizationBaseInput`
 * is optional or defaulted, and this matches the client's first query
 * exactly (no profile-resolution mismatch), so the prefetch is never
 * wasted. It powers the IRMAA-exposure callout and the brackets note; the
 * strategy-comparison and Roth what-if tabs are profile/selection-dependent
 * and load on the client when opened.
 */
import { HydrationBoundary } from "@tanstack/react-query";
import { prefetchForPage } from "@/server/helpers/server-trpc";
import { TaxOptimizationContent } from "./tax-optimization-content";

export default async function TaxOptimizationPage() {
  const dehydratedState = await prefetchForPage(async (helpers) => {
    await helpers.projection.projectTaxYears
      .prefetch({})
      .catch(() => undefined);
  });

  return (
    <HydrationBoundary state={dehydratedState}>
      <TaxOptimizationContent />
    </HydrationBoundary>
  );
}
