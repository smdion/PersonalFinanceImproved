/**
 * Your investments next to market indexes, at yearly resolution
 * (portfolioProcedure — balances and returns).
 */
import { z } from "zod/v4";
import { inArray } from "drizzle-orm";
import { createTRPCRouter, portfolioProcedure } from "../../trpc";
import * as schema from "@/lib/db/schema";
import {
  BENCHMARKS,
  BUCKET_INDEX_PROXIES,
  resolveBenchmark,
} from "@/lib/config/benchmarks";
import { householdRetirementYear } from "@/server/helpers/retirement-profile";
import {
  simulateIndex,
  windowReturn,
  yearlyReturn,
  type YearlyResult,
} from "@/lib/pure/benchmark-yearly";
import { getBenchmarkMonthlyPrices } from "@/server/helpers/market-prices";
import {
  COMPOSITION_BUCKET_VALUES,
  type CompositionBucket,
} from "@/lib/config/enum-values";
import { localDateStr } from "@/lib/utils/date";
import { effectiveFacts } from "@/lib/pure/fund-facts";
import { dailyWeightsByAccount } from "@/lib/pure/holding-periods";
import { matchedMixLevels } from "@/lib/pure/matched-mix";
import type { MonthlyPrices } from "@/lib/pure/benchmark-yearly";
import { toFactRows } from "@/server/helpers/fund-facts";
import { loadDailyPositions, loadEnteredPeriods } from "./_shared";

/**
 * Where the default window starts: after any leading placeholder years —
 * records with an effectively zero return (e.g. flat estimates entered for
 * early years). They stay selectable; they just don't start the comparison.
 */
function firstRealYear(years: YearlyResult[]): number | null {
  const real = years.find((y) => Math.abs(yearlyReturn(y) ?? 0) >= 0.001);
  return real?.year ?? years[0]?.year ?? null;
}

type Db = typeof import("@/lib/db").db;

/** Label of the matched-mix entry (key "matched_mix"). */
const MATCHED_MIX_LABEL = "Your mix, in index funds";

/**
 * Your own fund weights (holding history) priced with an index fund per
 * class, through the same simulateIndex as every benchmark. Only years
 * whose months are fully covered from the start of the year; null with no
 * holding history at all.
 */
async function matchedMixBenchmark(
  db: Db,
  rows: readonly (typeof schema.accountPerformance.$inferSelect)[],
  years: readonly YearlyResult[],
) {
  const [{ positions }, entered] = await Promise.all([
    // From the month before the first year — enough for every month's weights.
    loadDailyPositions(db, `${years[0]!.year - 1}-12-01`),
    loadEnteredPeriods(db),
  ]);
  if (positions.length === 0 && entered.length === 0) return null;
  const accountValues = new Map<number, Map<number, number>>();
  for (const r of rows) {
    const m = accountValues.get(r.year) ?? new Map<number, number>();
    m.set(
      r.performanceAccountId,
      (m.get(r.performanceAccountId) ?? 0) + Number(r.beginningBalance),
    );
    accountValues.set(r.year, m);
  }
  const observedDaily = dailyWeightsByAccount(positions);
  const ids = [
    ...new Set([
      ...positions.map((p) => p.securityId),
      ...entered.flatMap((p) => Object.keys(p.weights).map(Number)),
    ]),
  ];
  const factRows = ids.length
    ? await db
        .select()
        .from(schema.securityFacts)
        .where(inArray(schema.securityFacts.securityId, ids))
    : [];
  const today = localDateStr();
  const facts = new Map(
    ids.map((id) => [
      id,
      effectiveFacts(
        toFactRows(factRows.filter((f) => f.securityId === id)),
        today,
      ),
    ]),
  );
  const fromYear = years[0]!.year;
  const proxyPrices = Object.fromEntries(
    await Promise.all(
      COMPOSITION_BUCKET_VALUES.map(async (b) => {
        const proxy = BUCKET_INDEX_PROXIES[b];
        return [
          b,
          proxy
            ? await getBenchmarkMonthlyPrices(db, proxy.ticker, fromYear)
            : null,
        ];
      }),
    ),
  ) as Record<CompositionBucket, MonthlyPrices | null>;
  const levels = matchedMixLevels({
    years: years.map((y) => y.year),
    accountValues,
    periods: entered,
    observedDaily,
    facts,
    proxyPrices,
  });
  // simulateIndex starts at a year's January; begin at the first year
  // whose previous December is priced.
  const covered = years.filter((y) => levels.prices.has(`${y.year - 1}-12`));
  const run = covered.length ? simulateIndex(covered, levels.prices) : null;
  const months = run?.reduce((s, r) => s + r.months, 0) ?? 0;
  const last = run?.at(-1);
  const pct = Math.round(levels.excludedShare * 100);
  return {
    key: "matched_mix",
    label: MATCHED_MIX_LABEL,
    ticker: "",
    description: `Your own funds' mix over time (from your holding history), priced with a plain index fund for each class — what the same choices would have earned in index funds. Fund mixes are as of their latest facts, so years long ago are approximate for funds that change their mix (target-date funds).${pct > 0 ? ` Up to ${pct}% of the money (funds with no known mix, or "other") is left out.` : ""} Shown from the first full year your history covers.`,
    available: !!run && run.length > 0,
    years: run ?? [],
    window: run && last ? windowReturn(covered, last.end, months) : null,
  };
}

export const investmentComparisonRouter = createTRPCRouter({
  /** Yearly results and the same money in each benchmark, from `fromYear` (default: first year with real gains). */
  getComparison: portfolioProcedure
    .input(z.object({ fromYear: z.number().int().optional() }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db.select().from(schema.accountPerformance);
      const byYear = new Map<number, YearlyResult>();
      for (const r of rows) {
        const y = byYear.get(r.year) ?? {
          year: r.year,
          begin: 0,
          contributions: 0,
          outflows: 0,
          gain: 0,
          end: 0,
        };
        y.begin += Number(r.beginningBalance);
        y.contributions +=
          Number(r.totalContributions) + Number(r.rollovers ?? 0);
        y.outflows += Number(r.distributions ?? 0) + Number(r.fees ?? 0);
        y.gain += Number(r.yearlyGainLoss);
        y.end += Number(r.endingBalance);
        byYear.set(r.year, y);
      }
      const allYears = [...byYear.values()].sort((a, b) => a.year - b.year);
      const defaultFrom = firstRealYear(allYears);
      const fromYear = input.fromYear ?? defaultFrom;
      const years = allYears.filter(
        (y) => fromYear !== null && y.year >= fromYear,
      );
      const currentYear = new Date().getFullYear();

      const retirementYear = await householdRetirementYear(ctx.db);
      const benchmarks = await Promise.all(
        BENCHMARKS.map(async (def) => {
          const b = resolveBenchmark(def, retirementYear) ?? {
            key: def.key,
            label: def.label,
            ticker: "",
            description: def.description,
          };
          const prices =
            years.length > 0 && b.ticker
              ? await getBenchmarkMonthlyPrices(
                  ctx.db,
                  b.ticker,
                  years[0]!.year,
                )
              : null;
          const run = prices ? simulateIndex(years, prices) : null;
          const months = run?.reduce((s, r) => s + r.months, 0) ?? 0;
          const last = run?.at(-1);
          return {
            key: b.key,
            label: b.label,
            ticker: b.ticker,
            description: b.description,
            available: !!run && run.length > 0,
            years: run ?? [],
            window: run && last ? windowReturn(years, last.end, months) : null,
          };
        }),
      );

      const matched =
        years.length > 0
          ? await matchedMixBenchmark(ctx.db, rows, years)
          : null;
      if (matched) benchmarks.push(matched);

      // Your window return over the same months the indexes cover.
      const pricedMonths = Math.max(
        0,
        ...benchmarks.map((b) => b.years.reduce((s, r) => s + r.months, 0)),
      );
      const fullMonths =
        years.length * 12 -
        (years.at(-1)?.year === currentYear ? 12 - new Date().getMonth() : 0);
      const yourMonths = pricedMonths || Math.max(fullMonths, 0);

      return {
        fromYear,
        defaultFromYear: defaultFrom,
        availableYears: allYears.map((y) => y.year),
        years: years.map((y) => ({
          ...y,
          returnPct: yearlyReturn(y),
          partial: y.year === currentYear,
        })),
        yourWindow: windowReturn(years, years.at(-1)?.end ?? 0, yourMonths),
        benchmarks,
        pricesConnected: benchmarks.some((b) => b.available),
        // A verdict needs known holdings over at least 3 years (methodology
        // rule); until holding periods exist this is always a rough comparison.
        verdictAvailable: false,
      };
    }),
});
