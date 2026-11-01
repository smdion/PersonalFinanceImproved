"use client";

import Link from "next/link";
import { Card, ProgressBar } from "@/components/ui/card";
import { formatCurrency, formatNumber } from "@/lib/utils/format";
import {
  milestoneTimeline,
  nextUpMilestones,
  sinceLastYear,
  type MilestoneInput,
  type MilestoneResult,
} from "@/lib/pure/milestones";
import { MILESTONE_STATUS_LABELS } from "@/lib/config/display-labels";
import { STATUS_STYLE, StatusIcon } from "./milestone-row";

/** Status counts over every milestone (the FOO steps repeat other rows),
 *  wins first. */
const COUNT_ORDER = ["reached", "onTrack", "unknown", "behind"] as const;

/** Where you stand, wins first: how many reached, what's been reached and
 *  when, what's next, and the year's progress. What needs doing lives on
 *  Recommendations. */
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
  const counted = results.filter((r) => r.group !== "foo");
  const counts = COUNT_ORDER.map((status) => ({
    status,
    n: counted.filter((r) => r.status === status).length,
  })).filter((c) => c.n > 0);
  return (
    <Card title="Where you stand">
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        {counts.map((c) => (
          <span key={c.status} className="flex items-center gap-1.5">
            <StatusIcon status={c.status} />
            <span className="text-primary font-medium tabular-nums">{c.n}</span>
            <span className="text-muted">
              {MILESTONE_STATUS_LABELS[c.status].toLowerCase()}
            </span>
          </span>
        ))}
      </div>

      {timeline.length > 0 && (
        <div className="mb-4">
          <h3 className="text-caption text-muted mb-1.5 font-medium tracking-wide uppercase">
            Reached so far · {timeline.length}
          </h3>
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
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <section>
            <h3 className="text-caption text-muted mb-1.5 font-medium tracking-wide uppercase">
              Next up
            </h3>
            {/* Ties the dates to the plan they come from. */}
            <p className="text-caption text-muted mb-2">
              &ldquo;On pace for&rdquo; dates come from your retirement
              projection —{" "}
              <Link
                href="/retirement"
                className="text-blue-600 hover:underline"
              >
                see its assumptions on Retirement
              </Link>
              .
            </p>
            {next.length === 0 ? (
              <p className="text-muted text-sm">
                Every wealth milestone is reached — add a goal of your own
                below.
              </p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {next.map((r) => (
                  <div key={r.id}>
                    <div className="text-primary text-sm font-medium">
                      {r.title}
                    </div>
                    <div className="text-secondary text-xs tabular-nums">
                      {r.headline}
                    </div>
                    <div className="my-1">
                      <ProgressBar
                        value={r.progress ?? 0}
                        variant={STATUS_STYLE[r.status].bar}
                        small
                        inline
                      />
                    </div>
                    <div className="text-caption text-muted">
                      {[r.note, r.nextStep].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <section className="lg:border-subtle lg:border-l lg:pl-4">
          <h3 className="text-caption text-muted mb-1.5 font-medium tracking-wide uppercase">
            {since ? `Since ${since.fromYear}` : "This year"}
          </h3>
          {since ? (
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-muted">Net worth</dt>
                <dd className="tabular-nums">
                  {formatCurrency(since.netWorth[0])} →{" "}
                  <span className="text-primary font-medium">
                    {formatCurrency(since.netWorth[1])}
                  </span>
                </dd>
              </div>
              {since.liquidMultiple && (
                <div className="flex justify-between gap-2">
                  <dt className="text-muted">Liquid ÷ income</dt>
                  <dd className="tabular-nums">
                    {formatNumber(since.liquidMultiple[0], 1)}× →{" "}
                    <span className="text-primary font-medium">
                      {formatNumber(since.liquidMultiple[1], 1)}×
                    </span>
                  </dd>
                </div>
              )}
              <div className="flex justify-between gap-2">
                <dt className="text-muted">Wealth score</dt>
                <dd className="tabular-nums">
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
        </section>
      </div>
    </Card>
  );
}
