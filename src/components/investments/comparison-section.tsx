"use client";

/**
 * Benchmarks → "How you did vs the market": your yearly results next to
 * the same money, on the same schedule, in each market index. Rough
 * comparison until holdings history makes a verdict possible.
 */
import Link from "next/link";
import { useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import {
  axisProps,
  chartMargin,
  gridProps,
  legendProps,
  tooltipProps,
  yAxisProps,
} from "@/components/charts/chart-defaults";
import { CHART_COLORS } from "@/lib/utils/colors";
import { DEFAULT_BENCHMARK_KEY } from "@/lib/config/benchmarks";
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";
import {
  compactCurrency,
  formatCurrency,
  formatPercent,
} from "@/lib/utils/format";
import { SettingsLink } from "@/components/ui/settings-link";

/** The benchmark you compare with, then the S&P 500 for context. */
const PRIMARY_COLOR = CHART_COLORS.benchTotalUs;
const CONTEXT_COLOR = CHART_COLORS.benchSp500;
const CONTEXT_KEY = "sp500";

/** Yearly records start before 2020 for most households; weekly detail comes later. */
const YEARLY_ONLY_BEFORE = 2020;

function pct(value: number | null | undefined, decimals = 1): string {
  return value == null ? "—" : formatPercent(value, decimals);
}

function windowLabel(w: { value: number; annualized: boolean } | null) {
  if (!w) return "—";
  return `${formatPercent(w.value, 1)}${w.annualized ? " a year" : " so far"}`;
}

type ComparisonData = RouterOutputs["investments"]["getComparison"];

/** One chart point per year end: your balance, what you put in, and each index run. */
function chartPoints(
  years: ComparisonData["years"],
  benchmarks: ComparisonData["benchmarks"],
): Record<string, number | string>[] {
  const points: Record<string, number | string>[] = [];
  let deposits = years[0]?.begin ?? 0;
  for (let i = 0; i < years.length; i++) {
    const y = years[i]!;
    if (i > 0) deposits += y.begin - years[i - 1]!.end;
    deposits += y.contributions - y.outflows;
    const point: Record<string, number | string> = {
      label: y.partial ? `${y.year} so far` : String(y.year),
      you: y.end,
      deposits,
    };
    for (const b of benchmarks) {
      const run = b.years.find((r) => r.year === y.year);
      if (run) point[b.key] = run.end;
    }
    points.push(point);
  }
  return points;
}

export function ComparisonSection() {
  const [fromYear, setFromYear] = useState<number | undefined>(undefined);
  const { data, isLoading } = trpc.investments.getComparison.useQuery({
    fromYear,
  });
  // Shared with the Performance page's index column.
  const [benchmarkKey, setBenchmarkKey] = usePersistedSetting<string>(
    "benchmark_primary",
    DEFAULT_BENCHMARK_KEY,
  );

  if (isLoading || !data) {
    return (
      <Card title="How you did vs the market">
        <p className="text-faint text-sm">Loading…</p>
      </Card>
    );
  }
  if (data.years.length === 0) {
    return (
      <Card title="How you did vs the market">
        <p className="text-faint text-sm">
          Add yearly results on the Performance page to compare them with the
          market.
        </p>
      </Card>
    );
  }

  const thisYear = new Date().getFullYear();
  const starts = [
    ...(data.defaultFromYear !== null
      ? [{ label: `Since ${data.defaultFromYear}`, year: data.defaultFromYear }]
      : []),
    { label: "Since 2020", year: 2020 },
    { label: "3 years", year: thisYear - 2 },
    { label: "This year", year: thisYear },
  ].filter(
    (s, i, all) =>
      data.availableYears.includes(s.year) &&
      all.findIndex((o) => o.year === s.year) === i,
  );
  const activeFrom = data.fromYear;
  const available = data.benchmarks.filter((b) => b.available);
  const primary =
    available.find((b) => b.key === benchmarkKey) ?? available[0] ?? null;
  const context =
    primary?.key !== CONTEXT_KEY
      ? (available.find((b) => b.key === CONTEXT_KEY) ?? null)
      : null;
  const shown = [primary, context].filter(
    (b): b is NonNullable<typeof b> => b !== null,
  );

  // Chart: one point per year end (current year: latest), dollars.
  const points = chartPoints(data.years, data.benchmarks);

  return (
    <Card title="How you did vs the market">
      <div className="mb-3 flex flex-wrap gap-1">
        {starts.map((s) => (
          <button
            key={s.year}
            onClick={() => setFromYear(s.year)}
            className={`rounded-full px-2.5 py-0.5 text-xs ${
              activeFrom === s.year
                ? "bg-blue-600 text-white"
                : "bg-surface-elevated text-muted hover:bg-surface-strong"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {available.length > 0 && (
        <label className="text-muted mb-2 flex flex-wrap items-center gap-2 text-xs">
          Compare with
          <select
            value={primary?.key ?? ""}
            onChange={(e) => setBenchmarkKey(e.target.value)}
            className="border-default bg-surface-primary text-primary rounded border px-2 py-0.5 text-xs"
          >
            {available.map((b) => (
              <option key={b.key} value={b.key}>
                {b.label}
                {b.ticker ? ` (${b.ticker})` : ""}
              </option>
            ))}
          </select>
          {primary && <span className="text-faint">{primary.description}</span>}
        </label>
      )}

      {/* Headline — a rough comparison until holdings history allows a verdict. */}
      <div className="mb-1">
        <p className="text-primary text-lg">
          You earned{" "}
          <span className="font-semibold">{windowLabel(data.yourWindow)}</span>
          {primary && (
            <>
              . The same deposits in the {primary.label}:{" "}
              <span className="font-semibold">
                {windowLabel(primary.window)}
              </span>
            </>
          )}
          .
        </p>
        <p className="text-caption text-faint">
          Rough comparison — same money, same dates, yearly records
          {activeFrom !== null && activeFrom < YEARLY_ONLY_BEFORE
            ? ` (${activeFrom}–${YEARLY_ONLY_BEFORE - 1} are yearly totals only)`
            : ""}
          . A verdict needs your holdings history.{" "}
          <Link href="/benchmarks/methodology" className="underline">
            How this is calculated
          </Link>
        </p>
      </div>

      {!data.pricesConnected && (
        <div className="my-3 rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-400">
          Connect Tiingo in{" "}
          <SettingsLink
            tab="integrations"
            section="tiingo"
            className="underline"
          />{" "}
          to compare with market indexes. It&apos;s free and supplies the index
          prices.
        </div>
      )}

      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={chartMargin}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="label" {...axisProps} />
            <YAxis {...yAxisProps} tickFormatter={compactCurrency} />
            <RechartsTooltip
              {...tooltipProps}
              formatter={(v) => formatCurrency(Number(v))}
            />
            <Legend {...legendProps} />
            <Line
              dataKey="deposits"
              name="What you put in"
              stroke={CHART_COLORS.benchDeposits}
              strokeDasharray="4 3"
              dot={false}
            />
            <Line
              dataKey="you"
              name="You"
              stroke={CHART_COLORS.benchYou}
              strokeWidth={2.5}
              dot={{ r: 3 }}
            />
            {shown.map((b) => (
              <Line
                key={b.key}
                dataKey={b.key}
                name={`Same money in ${b.label}`}
                stroke={b === primary ? PRIMARY_COLOR : CONTEXT_COLOR}
                strokeWidth={b === primary ? 2 : 1}
                strokeDasharray={b === primary ? undefined : "2 2"}
                dot={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <table className="mt-4 w-full text-xs">
        <thead>
          <tr className="text-faint border-subtle border-b text-left">
            <th className="py-1 font-medium">Year</th>
            <th className="py-1 text-right font-medium">You</th>
            {shown.map((b) => (
              <th key={b.key} className="py-1 text-right font-medium">
                {b.label}
              </th>
            ))}
            {primary && (
              <th className="py-1 text-right font-medium">
                You vs {primary.label}
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {[...data.years].reverse().map((y) => {
            const p = primary?.years.find((r) => r.year === y.year);
            const diff =
              y.returnPct != null && p?.returnPct != null
                ? y.returnPct - p.returnPct
                : null;
            return (
              <tr key={y.year} className="border-subtle border-b">
                <td className="text-muted py-1">
                  {y.year}
                  {y.partial && <span className="text-faint"> so far</span>}
                </td>
                <td className="text-primary py-1 text-right">
                  {pct(y.returnPct)}
                </td>
                {shown.map((b) => (
                  <td key={b.key} className="text-muted py-1 text-right">
                    {pct(b.years.find((r) => r.year === y.year)?.returnPct)}
                  </td>
                ))}
                <td
                  className={`py-1 text-right ${
                    diff == null
                      ? "text-faint"
                      : diff >= 0
                        ? "text-green-600"
                        : "text-red-600"
                  }`}
                >
                  {diff == null
                    ? "—"
                    : `${diff >= 0 ? "+" : ""}${formatPercent(diff, 1)}`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Not available yet — real empty states, explained. */}
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <div className="border-subtle rounded border border-dashed p-3">
          <p className="text-secondary text-xs font-medium">
            Matched to your actual mix
          </p>
          <p className="text-caption text-faint mt-0.5">
            The same money in index funds matching what you held (e.g. 60% US,
            30% international, 10% bonds). Appears once Ledgr knows what you
            held each year — confirm your holding periods below.
          </p>
        </div>
        <div className="border-subtle rounded border border-dashed p-3">
          <p className="text-secondary text-xs font-medium">
            Where the difference came from
          </p>
          <p className="text-caption text-faint mt-0.5">
            S&amp;P 500 → your mix → your funds and their costs → when you added
            money. Needs at least 3 years of known holdings.
          </p>
        </div>
      </div>
    </Card>
  );
}
