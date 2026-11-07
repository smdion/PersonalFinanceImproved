"use client";

import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import {
  QueryBoundary,
  type BoundaryQuery,
} from "@/components/ui/query-boundary";

/** The Contributions page while its summary loads or after it fails. */
export function ContributionsQueryBoundary({
  query,
}: {
  query: BoundaryQuery;
}) {
  return (
    <QueryBoundary
      query={query}
      frame={(body) => (
        <div>
          <PageHeader
            title="Contributions"
            subtitle="Household contribution breakdown and savings rates"
          />
          {body}
        </div>
      )}
      fallback={
        <>
          <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
          </div>
          <Skeleton className="h-64" />
        </>
      }
    />
  );
}

export { queryPending } from "@/components/ui/query-boundary";
