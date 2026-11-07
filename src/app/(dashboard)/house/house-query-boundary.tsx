"use client";

import { Skeleton, SkeletonChart } from "@/components/ui/skeleton";
import {
  QueryBoundary,
  type QueryBoundaryProps,
} from "@/components/ui/query-boundary";

/** The House page while its queries load or after one fails. */
export function HouseQueryBoundary({
  query,
}: {
  query: QueryBoundaryProps["query"];
}) {
  return (
    <QueryBoundary
      query={query}
      what="house data"
      fallback={
        <div className="space-y-4">
          <Skeleton className="h-8 w-1/3" />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <SkeletonChart key={i} height={112} />
            ))}
          </div>
          <SkeletonChart height={256} />
        </div>
      }
    />
  );
}

export { queryPending } from "@/components/ui/query-boundary";
