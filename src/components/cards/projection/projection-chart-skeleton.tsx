/** Loading skeleton for ProjectionChart — extracted into its own module so
 *  it can serve as the next/dynamic loading fallback without dragging
 *  recharts into the parent bundle (v0.5 expert-review M8).
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
      <h5 className="text-xs font-medium text-muted uppercase mb-2">
        Balance Projection
        {phase === "simulation" && (
          <span className="text-[9px] text-purple-400 animate-pulse ml-2 normal-case font-normal">
            Running simulation...
          </span>
        )}
        {phase === "engine" && (
          <span className="text-[9px] text-blue-400 animate-pulse ml-2 normal-case font-normal">
            Running projection engine...
          </span>
        )}
      </h5>
      <div className="h-[320px] relative overflow-hidden">
        <div className="absolute inset-0 flex items-end gap-1.5 px-8 pb-8 pt-4">
          {BAR_HEIGHTS.map((h, i) => (
            <div
              key={h}
              className="flex-1 rounded-t bg-surface-strong animate-pulse"
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
              className={`text-xs bg-surface-sunken/80 px-3 py-1.5 rounded-full animate-pulse ${
                phase === "engine" ? "text-blue-400" : "text-faint"
              }`}
            >
              {phase === "engine"
                ? "Running projection engine..."
                : "Simulating 1,000 scenarios..."}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
