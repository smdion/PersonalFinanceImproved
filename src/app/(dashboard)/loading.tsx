import { Skeleton, SkeletonChart } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="space-y-4 w-full max-w-4xl">
        <Skeleton className="h-8 w-1/3" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            // eslint-disable-next-line react/no-array-index-key
            <SkeletonChart key={i} height={160} />
          ))}
        </div>
      </div>
    </div>
  );
}
