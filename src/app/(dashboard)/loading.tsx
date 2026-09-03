import { Skeleton, SkeletonChart } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="w-full max-w-4xl space-y-4">
        <Skeleton className="h-8 w-1/3" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            // eslint-disable-next-line react/no-array-index-key -- skeleton placeholders are identical with no identity
            <SkeletonChart key={i} height={160} />
          ))}
        </div>
      </div>
    </div>
  );
}
