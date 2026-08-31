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
      <h2 className="text-lg font-semibold mb-2">Watch List</h2>
      <p className="text-sm leading-relaxed mb-3">{watchlist.narrative}</p>
      {watchlist.items.length > 0 && (
        <ul className="text-sm space-y-1">
          {watchlist.items.map((item) => (
            <li
              key={`${item.startYear}-${item.endYear}-${item.detail.slice(0, 24)}`}
              className="flex gap-2"
            >
              <span className="text-muted tabular-nums shrink-0 whitespace-nowrap">
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
