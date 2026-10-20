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
  firstRealYear,
  runBenchmark,
  windowReturn,
  yearlyResultsFrom,
  yearlyReturn,
  yourWindowMonths,
  type MonthlyPrices,
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
import {
  accountValuesByYear,
  matchedMixDescription,
  matchedMixLevels,
  matchedMixRun,
} from "@/lib/pure/matched-mix";
import { toNumber } from "@/server/helpers/transforms";
import { toFactRows } from "@/server/helpers/fund-facts";
import { loadDailyPositions, loadEnteredPeriods } from "./_shared";

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
  const accountValues = accountValuesByYear(
    rows.map((r) => ({
      year: r.year,
      performanceAccountId: r.performanceAccountId,
      beginningBalance: toNumber(r.beginningBalance),
    })),
  );
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
  return {
    key: "matched_mix",
    label: MATCHED_MIX_LABEL,
    ticker: "",
    description: matchedMixDescription(levels.excludedShare),
    ...matchedMixRun(years, levels),
  };
}

export const investmentComparisonRouter = createTRPCRouter({
  /** Yearly results and the same money in each benchmark, from `fromYear` (default: first year with real gains). */
  getComparison: portfolioProcedure
    .input(z.object({ fromYear: z.number().int().optional() }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db.select().from(schema.accountPerformance);
      const allYears = yearlyResultsFrom(
        rows.map((r) => ({
          year: r.year,
          beginningBalance: toNumber(r.beginningBalance),
          totalContributions: toNumber(r.totalContributions),
          rollovers: toNumber(r.rollovers ?? 0),
          distributions: toNumber(r.distributions ?? 0),
          fees: toNumber(r.fees ?? 0),
          yearlyGainLoss: toNumber(r.yearlyGainLoss),
          endingBalance: toNumber(r.endingBalance),
        })),
      );
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
          return {
            key: b.key,
            label: b.label,
            ticker: b.ticker,
            description: b.description,
            ...runBenchmark(years, prices),
          };
        }),
      );

      const matched =
        years.length > 0
          ? await matchedMixBenchmark(ctx.db, rows, years)
          : null;
      if (matched) benchmarks.push(matched);

      // Your window return over the same months the indexes cover.
      const yourMonths = yourWindowMonths(
        years,
        benchmarks.map((b) => b.years),
        new Date(),
      );

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
