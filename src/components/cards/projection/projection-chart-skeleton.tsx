/** Loading skeleton for ProjectionChart — extracted into its own module so
 *  it can serve as the next/dynamic loading fallback without dragging
 *  recharts into the parent bundle.
 *
 *  The optional `phase` prop controls the overlay label:
 *    "engine"     → "Running projection engine..."  (blue, initial load)
 *    "simulation" → "Simulating 1,000 scenarios..." (purple, MC prefetch)
 *    undefined    → no overlay (used as dynamic import fallback only)
 */

const BAR_HEIGHTS = [
  18, 24, 30, 38, 46, 55, 62, 70, 78, 84, 88, 92, 95, 90, 85, 80, 74, 68, 60,
  52, 44, 36, 28, 20,
];

export function ProjectionChartSkeleton({
  phase,
}: {
  phase?: "engine" | "simulation";
} = {}) {
  return (
    <div className="bg-surface-sunken rounded-lg p-3">
      <h5 className="text-muted mb-2 text-xs font-medium uppercase">
        Balance Projection
        {phase === "simulation" && (
          <span className="text-micro ml-2 animate-pulse font-normal text-purple-600 normal-case">
            Running simulation...
          </span>
        )}
        {phase === "engine" && (
          <span className="text-micro ml-2 animate-pulse font-normal text-blue-400 normal-case">
            Running projection engine...
          </span>
        )}
      </h5>
      <div className="relative h-[320px] overflow-hidden">
        <div className="absolute inset-0 flex items-end gap-1.5 px-8 pt-4 pb-8">
          {BAR_HEIGHTS.map((h, i) => (
            <div
              key={h}
              className="bg-surface-strong flex-1 animate-pulse rounded-t"
              style={{
                height: `${h}%`,
                animationDelay: `${i * 60}ms`,
              }}
            />
          ))}
        </div>
        {phase && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div
              className={`bg-surface-sunken/80 animate-pulse rounded-full px-3 py-1.5 text-xs ${
                phase === "engine" ? "text-blue-400" : "text-faint"
              }`}
            >
              {phase === "engine"
                ? "Running projection engine..."
                : "Simulating scenarios..."}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
