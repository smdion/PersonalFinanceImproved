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
      <h2 className="text-lg font-semibold mb-2">Your Withdrawal Strategy</h2>
      <p className="text-sm leading-relaxed mb-3">{strategy.narrative}</p>
      {strategy.highlights.length > 0 && (
        <ul className="text-sm space-y-1">
          {strategy.highlights.map((h) => (
            <li key={h.year} className="flex gap-2">
              <span className="text-muted tabular-nums shrink-0">{h.year}</span>
              <span>{h.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
