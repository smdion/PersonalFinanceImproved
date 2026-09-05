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
import {
  HydrationBoundary,
  dehydrate,
  type DehydratedState,
} from "@tanstack/react-query";
import { createServerHelpers } from "@/server/helpers/server-trpc";
import { TaxOptimizationContent } from "./tax-optimization-content";

export default async function TaxOptimizationPage() {
  let dehydratedState: DehydratedState | undefined = undefined;
  try {
    const helpers = await createServerHelpers();
    await helpers.projection.projectTaxYears
      .prefetch({})
      .catch(() => undefined);
    dehydratedState = dehydrate(helpers.queryClient);
  } catch {
    dehydratedState = undefined;
  }

  return (
    <HydrationBoundary state={dehydratedState}>
      <TaxOptimizationContent />
    </HydrationBoundary>
  );
}
