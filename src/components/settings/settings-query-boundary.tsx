"use client";

import { Skeleton } from "@/components/ui/skeleton";
import {
  QueryBoundary,
  type QueryBoundaryProps,
} from "@/components/ui/query-boundary";

/** A settings table while its query loads or after it fails. */
export function SettingsQueryBoundary({
  query,
}: {
  query: QueryBoundaryProps["query"];
}) {
  return (
    <QueryBoundary query={query} fallback={<Skeleton className="h-6 w-48" />} />
  );
}

export { queryPending } from "@/components/ui/query-boundary";
