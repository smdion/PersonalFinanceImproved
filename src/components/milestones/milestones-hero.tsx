"use client";

import { Card, ProgressBar } from "@/components/ui/card";
import { formatCurrency, formatNumber } from "@/lib/utils/format";
import {
  milestoneTimeline,
  nextUpMilestones,
  sinceLastYear,
  type MilestoneInput,
  type MilestoneResult,
} from "@/lib/pure/milestones";
import { STATUS_STYLE } from "./milestone-row";

/** What's next, what's been reached, and the year's progress. */
export function MilestonesHero({
  results,
  input,
}: {
  results: MilestoneResult[];
  input: MilestoneInput;
}) {
  const next = nextUpMilestones(results);
  const timeline = milestoneTimeline(results);
  const since = sinceLastYear(input.years);
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
      <Card title="Next up" className="lg:col-span-2">
        {next.length === 0 ? (
          <p className="text-muted text-sm">
            Every wealth milestone is reached — add a goal of your own below.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {next.map((r) => (
              <div key={r.id}>
                <div className="text-primary text-sm font-medium">
                  {r.title}
                </div>
                <div className="text-secondary text-xs">{r.headline}</div>
                <ProgressBar
                  value={r.progress ?? 0}
                  variant={STATUS_STYLE[r.status].bar}
                  small
                />
                <div className="text-micro text-faint">
                  {[r.note, r.nextStep].filter(Boolean).join(" · ")}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
      <Card title={since ? `Since ${since.fromYear}` : "This year"}>
        {since ? (
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between gap-2">
              <dt className="text-muted">Net worth</dt>
              <dd>
                {formatCurrency(since.netWorth[0])} →{" "}
                <span className="text-primary font-medium">
                  {formatCurrency(since.netWorth[1])}
                </span>
              </dd>
            </div>
            {since.liquidMultiple && (
              <div className="flex justify-between gap-2">
                <dt className="text-muted">Liquid ÷ income</dt>
                <dd>
                  {formatNumber(since.liquidMultiple[0], 1)}× →{" "}
                  <span className="text-primary font-medium">
                    {formatNumber(since.liquidMultiple[1], 1)}×
                  </span>
                </dd>
              </div>
            )}
            <div className="flex justify-between gap-2">
              <dt className="text-muted">Wealth score</dt>
              <dd>
                {formatNumber(since.wealthScore[0], 2)}× →{" "}
                <span className="text-primary font-medium">
                  {formatNumber(since.wealthScore[1], 2)}×
                </span>
              </dd>
            </div>
          </dl>
        ) : (
          <p className="text-muted text-sm">
            Finalize a year on the Historical page to compare against it.
          </p>
        )}
      </Card>
      {timeline.length > 0 && (
        <Card
          title={`Reached so far · ${timeline.length}`}
          className="lg:col-span-3"
        >
          <ol className="flex flex-wrap gap-1.5">
            {timeline.map((t) => (
              <li
                key={`${t.id}-${t.label}`}
                className={`text-caption rounded-full px-2 py-0.5 ${STATUS_STYLE.reached.chip}`}
              >
                <span className="font-semibold">{t.year}</span> · {t.label}
              </li>
            ))}
          </ol>
        </Card>
      )}
    </div>
  );
}
