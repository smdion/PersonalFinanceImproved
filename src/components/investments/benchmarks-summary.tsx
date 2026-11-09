"use client";

/**
 * Benchmarks' opening card: how your returns compare, and the investing milestones (cost,
 * mix, funds) with status, each linking to its milestone. Actions live on Recommendations.
 */
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { useDashboardProjection } from "@/lib/hooks/use-dashboard-projection";
import { FocusLink } from "@/components/ui/focus-link";
import { StatusIcon } from "@/components/milestones/milestone-row";
import { useMilestones } from "@/lib/hooks/use-milestones";
import { trpc } from "@/lib/trpc";
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";
import { DEFAULT_BENCHMARK_KEY } from "@/lib/config/benchmarks";
import { formatPercent } from "@/lib/utils/format";

export function BenchmarksSummary() {
  const { results } = useMilestones();
  // The same query and benchmark choice as the comparison card below.
  const { data } = trpc.investments.computeComparison.useQuery({
    fromYear: undefined,
  });
  const [benchmarkKey] = usePersistedSetting<string>(
    "benchmark_primary",
    DEFAULT_BENCHMARK_KEY,
  );
  // The return the plan uses this year (its year 0, annualized) — so the
  // real return reads against what the projections count on.
  const projection = useDashboardProjection();
  const assumed =
    projection.data?.result?.projectionByYear[0]?.annualizedReturnRate ?? null;
  const investing = results.filter((r) => r.group === "investing");
  const primary =
    data?.benchmarks.find((b) => b.key === benchmarkKey) ?? data?.benchmarks[0];
  const you = data?.yourWindow ?? null;
  const them = primary?.window ?? null;
  const rate = (w: { value: number; annualized: boolean }) =>
    `${formatPercent(w.value, 1)}${w.annualized ? " a year" : " so far"}`;
  if (investing.length === 0 && !you) return null;
  return (
    <Card title="How you're doing">
      <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {you && them && primary && (
          <li className="flex items-start gap-2 text-sm">
            <StatusIcon
              status={you.value >= them.value ? "reached" : "behind"}
            />
            <div className="min-w-0">
              <div className="text-primary font-medium">
                You earned {rate(you)}
              </div>
              <div className="text-secondary text-xs">
                The same deposits in the {primary.label}: {rate(them)}
              </div>
              {assumed !== null && (
                <div className="text-caption text-muted">
                  Your projections assume {formatPercent(assumed, 1)} this year
                  —{" "}
                  <Link
                    href="/retirement"
                    className="text-blue-600 hover:underline"
                  >
                    see Retirement
                  </Link>
                </div>
              )}
            </div>
          </li>
        )}
        {investing.map((r) => (
          <li key={r.id} className="flex items-start gap-2 text-sm">
            <StatusIcon status={r.status} />
            <div className="min-w-0">
              <FocusLink
                focus={{ topic: "milestone", milestoneId: r.id }}
                className="text-primary font-medium hover:underline"
              >
                {r.title}
              </FocusLink>
              <div className="text-secondary text-xs">{r.headline}</div>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
