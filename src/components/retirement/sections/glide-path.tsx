/**
 * Investment Returns Glide Path panel. Shows
 * Now/At-Retirement/Post-Retirement/Avg rates plus a
 * darker-is-higher gradient bar summarising the age-based glide path.
 *
 * The entire panel is guarded on `returnRateSummary` being truthy (same guard
 * as the original inline `{returnRateSummary && (...)}` — kept inside the
 * component so the parent can still pass the possibly-null field directly).
 */
"use client";

import { HelpTip } from "@/components/ui/help-tip";
import { Badge } from "@/components/ui/badge";
import { formatPercent } from "@/lib/utils/format";
import { glidePathHsl } from "@/lib/utils/colors";
import type { ReturnRateSummary } from "./types";

type Props = {
  returnRateSummary: ReturnRateSummary;
};

export function GlidePathSection({ returnRateSummary }: Props) {
  if (!returnRateSummary) return null;
  return (
    <div className="bg-surface-sunken rounded-lg p-3">
      <div className="mb-2 flex items-center gap-2">
        <h4 className="text-label text-muted font-semibold tracking-wider uppercase">
          Returns
        </h4>
        <span className="text-caption text-faint">age-based glide path</span>
        <HelpTip text="Your portfolio return rate shifts with age based on the glide path configured in Settings. Deterministic mode uses these rates directly as fixed annual returns. Simulation (Simple + Advanced) uses them as the mean of a probability distribution — each trial samples random returns around these rates, capturing real-world volatility and sequence-of-returns risk. Darker segments in the bar below indicate higher return rates (younger, more aggressive allocation)." />
        <Badge color="indigo">Baseline + Simulation</Badge>
        <div className="flex-1 border-t" />
      </div>
      <div className="mb-2 grid grid-cols-2 gap-x-4 text-sm sm:grid-cols-4">
        <div>
          <span className="text-muted">Now</span>
          <div className="font-medium text-blue-600">
            {returnRateSummary.currentRate != null
              ? formatPercent(returnRateSummary.currentRate, 1)
              : "—"}
          </div>
        </div>
        <div>
          <span className="text-muted">At Retirement</span>
          <div className="font-medium text-blue-600">
            {returnRateSummary.retirementRate != null
              ? formatPercent(returnRateSummary.retirementRate, 1)
              : "—"}
          </div>
        </div>
        <div>
          <span className="text-muted">Post-Retirement</span>
          <div className="font-medium text-blue-600">
            {returnRateSummary.postRetirementRate != null
              ? formatPercent(returnRateSummary.postRetirementRate, 1)
              : "—"}
          </div>
        </div>
        <div>
          <span className="text-muted">Avg (Accumulation)</span>
          <div className="font-medium text-blue-600">
            {formatPercent(returnRateSummary.avgAccumulation, 1)}
          </div>
        </div>
      </div>
      {/* Glide path bar */}
      <div className="text-caption text-faint flex items-center gap-2">
        <span>{returnRateSummary.schedule[0]?.age ?? "—"}</span>
        <div className="bg-surface-strong flex h-2.5 flex-1 overflow-hidden rounded-full">
          {(() => {
            const sched = returnRateSummary.schedule;
            if (sched.length === 0) return null;
            const minRate = Math.min(...sched.map((s) => s.rate));
            const maxRate = Math.max(...sched.map((s) => s.rate));
            const range = maxRate - minRate || 1;
            const samples = sched.filter(
              (_, i) => i === 0 || i === sched.length - 1 || i % 5 === 0,
            );
            return samples.map((s) => {
              const intensity = (s.rate - minRate) / range;
              return (
                <div
                  key={s.age}
                  className="flex-1 transition-all"
                  style={{
                    backgroundColor: glidePathHsl(intensity),
                  }}
                  title={`Age ${s.age}: ${formatPercent(s.rate, 1)}`}
                />
              );
            });
          })()}
        </div>
        <span>
          {returnRateSummary.schedule[returnRateSummary.schedule.length - 1]
            ?.age ?? "—"}
        </span>
      </div>
      <div className="text-caption text-faint mt-0.5 flex justify-between px-6">
        <span>
          {returnRateSummary.currentRate != null
            ? formatPercent(returnRateSummary.currentRate, 1)
            : "—"}
        </span>
        <span>darker = higher return</span>
        <span>
          {(() => {
            const lastRate =
              returnRateSummary.schedule[returnRateSummary.schedule.length - 1]
                ?.rate;
            return lastRate != null ? formatPercent(lastRate, 1) : "—";
          })()}
        </span>
      </div>
    </div>
  );
}
