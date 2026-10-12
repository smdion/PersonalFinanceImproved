"use client";

/**
 * Saved so far this year against the paycheck plan — the household and
 * each tracked account, with where the plan says you should be by today.
 * Needs the portfolio permission (built from transaction-level detail);
 * hidden without it.
 */
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { safeDivide } from "@/lib/utils/math";
import type { PaceStatus } from "@/lib/pure/savings-pace";
import { LoadingCard } from "./utils";

const STATUS_TEXT: Record<PaceStatus, string> = {
  met: "Plan met",
  on_pace: "On pace",
  behind: "Behind",
  no_plan: "No paycheck plan",
};

const STATUS_CLASS: Record<PaceStatus, string> = {
  met: "text-green-600 dark:text-green-400",
  on_pace: "text-green-600 dark:text-green-400",
  behind: "text-amber-600",
  no_plan: "text-faint",
};

/** Saved as a share of the year's plan, with a tick where today's pace sits. */
function PaceBar({
  saved,
  planYear,
  planToDate,
  thin = false,
}: {
  saved: number;
  planYear: number;
  planToDate: number;
  thin?: boolean;
}) {
  const of = (v: number) =>
    planYear > 0 ? Math.min(100, Math.max(0, (v / planYear) * 100)) : 0;
  return (
    <div
      className={`bg-surface-strong relative rounded ${thin ? "h-1.5" : "h-2.5"}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(of(saved))}
      aria-label="Saved of this year's plan"
    >
      <div
        className={`rounded bg-blue-600 ${thin ? "h-1.5" : "h-2.5"}`}
        style={{ width: `${of(saved)}%` }}
      />
      {planYear > 0 && (
        <div
          className="bg-primary absolute -top-0.5 w-0.5"
          style={{ left: `${of(planToDate)}%`, height: thin ? 10 : 14 }}
          title="Where the plan says you'd be today"
        />
      )}
    </div>
  );
}

export function SavingsThisYearCard() {
  const { data, isLoading, error } =
    trpc.investments.getSavingsThisYear.useQuery(undefined, { retry: false });
  if (isLoading) return <LoadingCard title="Saved This Year" />;
  // No portfolio permission (or no data): the card stays out of the way.
  if (error || !data || data.accounts.length === 0) return null;
  const { total } = data;
  return (
    <Card title="Saved This Year">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-primary text-2xl font-semibold">
          {formatCurrency(total.saved)}
        </p>
        <span className={`text-sm font-medium ${STATUS_CLASS[total.status]}`}>
          {STATUS_TEXT[total.status]}
        </span>
      </div>
      {total.planYear > 0 && (
        <p className="text-muted mb-2 text-xs">
          of {formatCurrency(total.planYear)} planned (
          {formatPercent(safeDivide(total.saved, total.planYear), 0)}) — the
          plan would have you at {formatCurrency(total.planToDate)} by today
        </p>
      )}
      <PaceBar
        saved={total.saved}
        planYear={total.planYear}
        planToDate={total.planToDate}
      />
      <div className="mt-3 space-y-2">
        {data.accounts.map((a) => (
          <div key={a.performanceAccountId} className="text-xs">
            <div className="flex justify-between gap-2">
              <span className="text-secondary truncate">{a.label}</span>
              <span className="text-muted whitespace-nowrap">
                {formatCurrency(a.saved)}
                {a.planYear > 0 && ` / ${formatCurrency(a.planYear)}`}{" "}
                <span className={STATUS_CLASS[a.status]}>
                  · {STATUS_TEXT[a.status]}
                </span>
              </span>
            </div>
            {a.planYear > 0 && (
              <div className="mt-0.5">
                <PaceBar
                  saved={a.saved}
                  planYear={a.planYear}
                  planToDate={a.planToDate}
                  thin
                />
              </div>
            )}
          </div>
        ))}
      </div>
      <p className="text-caption text-faint mt-3">
        What Performance records for this year plus deposits SimpleFIN has seen
        since your last update
        {total.estimated
          ? ", with paycheck estimates for accounts that send only a balance"
          : ""}
        . The plan is your paycheck setup, spread evenly over the year.
      </p>
    </Card>
  );
}
