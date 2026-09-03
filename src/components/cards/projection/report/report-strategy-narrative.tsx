/** Withdrawal-strategy narrative section of the advisor report — renders
 *  what lib/pure/report/withdrawal-strategy-narrative.ts already built.
 *  Presentational only. */
import type { ReportWithdrawalStrategySection } from "@/lib/pure/report/types";

export function ReportStrategyNarrativeSection({
  strategy,
}: {
  strategy: ReportWithdrawalStrategySection;
}) {
  return (
    <section className="mb-6" style={{ breakInside: "avoid" }}>
      <h2 className="mb-2 text-lg font-semibold">Your Withdrawal Strategy</h2>
      <p className="mb-3 text-sm leading-relaxed">{strategy.narrative}</p>
      {strategy.highlights.length > 0 && (
        <ul className="space-y-1 text-sm">
          {strategy.highlights.map((h) => (
            <li key={h.year} className="flex gap-2">
              <span className="text-muted shrink-0 tabular-nums">{h.year}</span>
              <span>{h.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
