"use client";

/**
 * Benchmarks' opening card — the same shape as Milestones' "Where you
 * stand" and Recommendations' "What to do": how your returns compare, and
 * the investing milestones (cost, mix, funds) with their status. Each
 * links to its milestone; what to do about one lives on Recommendations.
 */
import { Card } from "@/components/ui/card";
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
  const { data } = trpc.investments.getComparison.useQuery({
    fromYear: undefined,
  });
  const [benchmarkKey] = usePersistedSetting<string>(
    "benchmark_primary",
    DEFAULT_BENCHMARK_KEY,
  );
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
