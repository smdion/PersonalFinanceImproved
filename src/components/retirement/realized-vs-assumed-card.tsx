"use client";

/**
 * Retirement → how your actual yearly returns compare with the return the
 * projections assume for your ages. Display only — the projections keep
 * their own assumptions. Renders nothing until a retirement profile
 * resolves (an invalid stored id is being repaired) or without data.
 */
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { HelpTip } from "@/components/ui/help-tip";
import { formatPercent } from "@/lib/utils/format";
import { PERF_CATEGORY_PORTFOLIO } from "@/lib/config/display-labels";
import { realizedVsAssumed } from "@/lib/pure/realized-vs-assumed";

export function RealizedVsAssumedCard({
  profileId,
}: {
  profileId: number | null;
}) {
  const { data: perf } = trpc.performance.computeSummary.useQuery(undefined, {
    enabled: profileId !== null,
  });
  const { data: rates } = trpc.retirement.returnRates.list.useQuery(undefined, {
    enabled: profileId !== null,
  });
  const { data: people } = trpc.settings.people.list.useQuery(undefined, {
    enabled: profileId !== null,
  });
  if (profileId === null || !perf || !rates || !people) return null;

  const { rows, realizedAnnual, assumedAnnual } = realizedVsAssumed(
    perf.annualRows
      .filter((r) => r.category === PERF_CATEGORY_PORTFOLIO)
      .map((r) => ({ year: r.year, returnPct: r.annualReturnPct })),
    people
      .map((p) => Number(String(p.dateOfBirth ?? "").slice(0, 4)))
      .filter((y) => y > 1900),
    rates.map((r) => ({ age: r.age, rate: Number(r.rateOfReturn) })),
    new Date().getFullYear(),
  );
  if (rows.length === 0 || realizedAnnual === null || assumedAnnual === null)
    return null;

  const gap = realizedAnnual - assumedAnnual;
  const pct = (n: number) => formatPercent(n, 1);
  return (
    <Card
      title={
        <>
          Realized vs assumed returns{" "}
          <HelpTip text="Your actual yearly return on all investments (the Performance page's Portfolio return) next to the return your projections assume for your household's average age that year, from the return-rate table. Both compound into one yearly figure over the same years. Display only — projections keep their own assumptions." />
        </>
      }
      className="mt-6"
    >
      <p className="text-sm">
        <span className="text-muted">
          {rows[0]!.year}–{rows.at(-1)!.year} ({rows.length} year
          {rows.length === 1 ? "" : "s"}): your investments returned{" "}
        </span>
        <span className="font-semibold">{pct(realizedAnnual)}</span>
        <span className="text-muted"> a year; the plan assumes </span>
        <span className="font-semibold">{pct(assumedAnnual)}</span>
        <span className="text-muted"> for those ages — </span>
        <span
          className={`font-semibold ${gap >= 0 ? "text-green-600" : "text-red-600"}`}
        >
          {gap >= 0 ? "+" : "−"}
          {Math.abs(gap * 100).toFixed(1)} points
        </span>
        <span className="text-muted"> a year.</span>
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-xs tabular-nums">
          <thead>
            <tr className="text-faint border-subtle border-b text-right">
              <th className="py-1 pr-3 text-left font-medium">Year</th>
              <th className="py-1 pr-3 font-medium">Age</th>
              <th className="py-1 pr-3 font-medium">Your return</th>
              <th className="py-1 pr-3 font-medium">Assumed</th>
              <th className="py-1 font-medium">Difference</th>
            </tr>
          </thead>
          <tbody>
            {[...rows].reverse().map((r) => {
              const d = r.realized - r.assumed;
              return (
                <tr
                  key={r.year}
                  className="border-subtle border-b text-right last:border-0"
                >
                  <td className="text-primary py-1 pr-3 text-left">{r.year}</td>
                  <td className="text-muted py-1 pr-3">{r.age}</td>
                  <td className="py-1 pr-3">{pct(r.realized)}</td>
                  <td className="text-muted py-1 pr-3">{pct(r.assumed)}</td>
                  <td
                    className={`py-1 ${d >= 0 ? "text-green-600" : "text-red-600"}`}
                  >
                    {d >= 0 ? "+" : "−"}
                    {Math.abs(d * 100).toFixed(1)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
