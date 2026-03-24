/**
 * Composable skeleton loading primitives.
 *
 * Use these to show content-shaped placeholders while data loads.
 * Replaces ad-hoc `animate-pulse` divs scattered across components.
 */

type SkeletonProps = {
  className?: string;
};

/** Base pulse bar — a single rounded rectangle. */
export function Skeleton({ className = "h-4 w-full" }: SkeletonProps) {
  return (
    <div
      className={`animate-pulse bg-surface-strong rounded ${className}`}
      aria-hidden="true"
    />
  );
}

/** Skeleton for a dashboard-style metric card (value + label). */
export function SkeletonMetric({ className = "" }: SkeletonProps) {
  return (
    <div className={`space-y-2 ${className}`} aria-hidden="true">
      <div className="animate-pulse h-8 bg-surface-strong rounded w-1/2" />
      <div className="animate-pulse h-4 bg-surface-elevated rounded w-3/4" />
    </div>
  );
}

/** Skeleton for a table with configurable row count. */
export function SkeletonTable({
  rows = 5,
  columns = 4,
  className = "",
}: {
  rows?: number;
  columns?: number;
  className?: string;
}) {
  return (
    <div className={`space-y-2 ${className}`} aria-hidden="true">
      {/* Header row */}
      <div className="flex gap-3">
        {[...Array(columns)].map((_, i) => (
          <div
            // eslint-disable-next-line react/no-array-index-key -- skeleton placeholders
            key={i}
            className="animate-pulse h-6 bg-surface-strong rounded flex-1"
          />
        ))}
      </div>
      {/* Data rows */}
      {[...Array(rows)].map((_, i) => (
        // eslint-disable-next-line react/no-array-index-key -- skeleton placeholders
        <div key={i} className="flex gap-3">
          {[...Array(columns)].map((_, j) => (
            <div
              // eslint-disable-next-line react/no-array-index-key -- skeleton placeholders
              key={j}
              className="animate-pulse h-8 bg-surface-elevated rounded flex-1"
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Skeleton for a chart area with configurable aspect ratio. */
export function SkeletonChart({
  height = 250,
  className = "",
}: {
  height?: number;
  className?: string;
}) {
  return (
    <div
      className={`animate-pulse bg-surface-elevated rounded ${className}`}
      style={{ height }}
      aria-hidden="true"
    />
  );
}
