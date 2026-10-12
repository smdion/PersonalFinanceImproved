"use client";

/**
 * Saved so far this year against the paycheck plan — the household and
 * each tracked account. Follows the global View toggle the way the
 * Contributions card does: Current Salary (the full year's plan),
 * Year-End Estimate (saved + the rest of the year at today's rate), and
 * Actual YTD (the plan through your latest contribution). Needs the
 * portfolio permission (built from transaction-level detail); hidden
 * without it.
 */
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { safeDivide } from "@/lib/utils/math";
import { useScenario } from "@/lib/context/scenario-context";
import type { ViewMode } from "@/lib/calculators/types/shared";
import type { PaceStatus, SavingsPace } from "@/lib/pure/savings-pace";
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

type Row = Pick<
  SavingsPace["accounts"][number],
  "saved" | "planYear" | "planToDate" | "yearEnd"
>;

/** What a row shows in each view: the amount, what it's measured against, and the marker. */
function measure(r: Row, view: ViewMode) {
  switch (view) {
    case "blended":
      return { value: r.yearEnd, scale: r.planYear, marker: null };
    case "ytd":
      return { value: r.saved, scale: r.planToDate, marker: null };
    default:
      return { value: r.saved, scale: r.planYear, marker: r.planToDate };
  }
}

/** `value` as a share of `scale`, with an optional tick (where the plan has you today). */
function PaceBar({
  value,
  scale,
  marker,
  thin = false,
}: {
  value: number;
  scale: number;
  marker: number | null;
  thin?: boolean;
}) {
  const of = (v: number) =>
    Math.min(100, Math.max(0, safeDivide(v, scale) * 100));
  return (
    <div
      className={`bg-surface-strong relative rounded ${thin ? "h-1.5" : "h-2.5"}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(of(value))}
      aria-label="Saved of the plan"
    >
      <div
        className={`rounded bg-blue-600 ${thin ? "h-1.5" : "h-2.5"}`}
        style={{ width: `${of(value)}%` }}
      />
      {marker !== null && scale > 0 && (
        <div
          className="bg-primary absolute -top-0.5 w-0.5"
          style={{ left: `${of(marker)}%`, height: thin ? 10 : 14 }}
          title="Where the plan has you through your latest contribution"
        />
      )}
    </div>
  );
}

function Summary({
  total,
  view,
}: {
  total: SavingsPace["total"];
  view: ViewMode;
}) {
  if (total.planYear <= 0) return null;
  const line =
    view === "blended"
      ? `by Dec 31: ${formatCurrency(total.saved)} saved so far plus the rest of the year at today's rate, against ${formatCurrency(total.planYear)} planned`
      : view === "ytd"
        ? `of ${formatCurrency(total.planToDate)} the plan has you at through your latest contribution (${formatPercent(safeDivide(total.saved, total.planToDate), 0)})`
        : `of ${formatCurrency(total.planYear)} planned for the year (${formatPercent(safeDivide(total.saved, total.planYear), 0)}) — the plan has you at ${formatCurrency(total.planToDate)} through your latest contribution`;
  return <p className="text-muted mb-2 text-xs">{line}</p>;
}

export function SavingsThisYearCard() {
  const { viewMode } = useScenario();
  const { data, isLoading, error } =
    trpc.investments.getSavingsThisYear.useQuery(undefined, { retry: false });
  if (isLoading) return <LoadingCard title="Saved This Year" />;
  // No portfolio permission (or no data): the card stays out of the way.
  if (error || !data || data.accounts.length === 0) return null;
  const { total } = data;
  const head = measure(total, viewMode);
  return (
    <Card title="Saved This Year">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-primary text-2xl font-semibold">
          {viewMode === "blended" && "≈ "}
          {formatCurrency(head.value)}
        </p>
        <span className={`text-sm font-medium ${STATUS_CLASS[total.status]}`}>
          {STATUS_TEXT[total.status]}
        </span>
      </div>
      <Summary total={total} view={viewMode} />
      <PaceBar {...head} />
      <div className="mt-3 space-y-2">
        {data.accounts.map((a) => {
          const m = measure(a, viewMode);
          return (
            <div key={a.performanceAccountId} className="text-xs">
              <div className="flex flex-wrap justify-between gap-x-2">
                <span className="text-secondary">{a.label}</span>
                <span className="text-muted ml-auto text-right">
                  {viewMode === "blended" && a.planYear > 0 && "≈ "}
                  {formatCurrency(m.value)}
                  {viewMode !== "blended" &&
                    a.unposted > 0 &&
                    ` (+${formatCurrency(a.unposted)} on its way)`}
                  {a.planYear > 0 && ` / ${formatCurrency(m.scale)}`}{" "}
                  <span className={STATUS_CLASS[a.status]}>
                    · {STATUS_TEXT[a.status]}
                  </span>
                </span>
              </div>
              {a.planYear > 0 && (
                <div className="mt-0.5">
                  <PaceBar {...m} thin />
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-caption text-faint mt-3">
        Saved: what Performance records for this year plus deposits SimpleFIN
        has seen since your last update
        {total.estimated
          ? ", with paycheck estimates for accounts that send only a balance"
          : ""}
        . &ldquo;On its way&rdquo;: paychecks since the latest deposit an
        institution has posted. The plan is your paycheck setup on each
        contribution&apos;s own schedule; on pace means within one contribution
        of it.
      </p>
    </Card>
  );
}
