/**
 * Your investments next to market indexes, at yearly resolution
 * (portfolioProcedure — balances and returns).
 */
import { z } from "zod/v4";
import {
  createTRPCRouter,
  portfolioProcedure,
  protectedProcedure,
} from "../../trpc";
import * as schema from "@/lib/db/schema";
import { BENCHMARKS, resolveBenchmark } from "@/lib/config/benchmarks";
import { householdRetirementYear } from "@/server/helpers/retirement-profile";
import {
  simulateIndex,
  windowReturn,
  yearlyReturn,
  type YearlyResult,
} from "@/lib/pure/benchmark-yearly";
import { getBenchmarkMonthlyPrices } from "@/server/helpers/market-prices";

/**
 * Where the default window starts: after any leading placeholder years —
 * records with an effectively zero return (e.g. flat estimates entered for
 * early years). They stay selectable; they just don't start the comparison.
 */
function firstRealYear(years: YearlyResult[]): number | null {
  const real = years.find((y) => Math.abs(yearlyReturn(y) ?? 0) >= 0.001);
  return real?.year ?? years[0]?.year ?? null;
}

export const investmentComparisonRouter = createTRPCRouter({
  /**
   * An index's month-end total-return prices from `fromYear` — public
   * market data, no household figures, so any signed-in user (the
   * Performance page's benchmark column computes against its own rows).
   * Null when Tiingo isn't connected or the fetch failed.
   */
  getBenchmarkPrices: protectedProcedure
    .input(
      z.object({
        key: z.enum(BENCHMARKS.map((b) => b.key) as [string, ...string[]]),
        fromYear: z.number().int().min(1900).max(2200),
      }),
    )
    .query(async ({ ctx, input }) => {
      const b = resolveBenchmark(
        BENCHMARKS.find((x) => x.key === input.key)!,
        await householdRetirementYear(ctx.db),
      );
      if (!b) return null;
      const prices = await getBenchmarkMonthlyPrices(
        ctx.db,
        b.ticker,
        input.fromYear,
      );
      return prices
        ? {
            key: b.key,
            label: b.label,
            ticker: b.ticker,
            prices: Object.fromEntries(prices),
          }
        : null;
    }),

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
