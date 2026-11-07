"use client";

import { Skeleton, SkeletonChart } from "@/components/ui/skeleton";
import {
  QueryBoundary,
  type QueryBoundaryProps,
} from "@/components/ui/query-boundary";

/** The Utilities page while its summary loads or after it fails. */
export function UtilitiesQueryBoundary({
  query,
}: {
  query: QueryBoundaryProps["query"];
}) {
  return (
    <QueryBoundary
      query={query}
      what="utility data"
      fallback={
        <div className="space-y-4">
          <Skeleton className="h-8 w-1/3" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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
