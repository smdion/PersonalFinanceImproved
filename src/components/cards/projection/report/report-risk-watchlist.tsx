/** Risk-watchlist section of the advisor report: RMD shortfall/excise
 *  exposure + ACA/IRMAA cliff proximity, aggregated across years — see
 *  lib/pure/report/aca-irmaa-narrative.ts. Presentational only. */
import type { WatchlistSection } from "@/lib/pure/report/aca-irmaa-narrative";

export function ReportRiskWatchlistSection({
  watchlist,
}: {
  watchlist: WatchlistSection;
}) {
  return (
    <section className="mb-6" style={{ breakInside: "avoid" }}>
      <h2 className="mb-2 text-lg font-semibold">Watch List</h2>
      <p className="mb-3 text-sm leading-relaxed">{watchlist.narrative}</p>
      {watchlist.items.length > 0 && (
        <ul className="space-y-1 text-sm">
          {watchlist.items.map((item) => (
            <li
              key={`${item.startYear}-${item.endYear}-${item.detail.slice(0, 24)}`}
              className="flex gap-2"
            >
              <span className="text-muted shrink-0 whitespace-nowrap tabular-nums">
                {item.startYear === item.endYear
                  ? item.startYear
                  : `${item.startYear}–${item.endYear}`}
              </span>
              <span
                className={
                  item.severity === "warning" ? "text-amber-700" : undefined
                }
              >
                {item.detail}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
