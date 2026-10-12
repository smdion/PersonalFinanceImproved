/**
 * What Ledgr compares your investments with. Each is priced with a real,
 * low-cost fund (total return: dividends reinvested), so "the benchmark"
 * is something an ordinary investor could actually have owned.
 *
 * Data, not code: another benchmark is one more entry. A target-date
 * entry picks its fund from the household's planned retirement year.
 */
export type BenchmarkDefinition = {
  key: string;
  label: string;
  /** Plain description for the methodology page and tooltips. */
  description: string;
} & (
  | {
      /** Tiingo ticker of the fund. */
      ticker: string;
      targetDateFunds?: undefined;
    }
  | {
      ticker?: undefined;
      /** Retirement year → fund ticker, one per 5-year vintage. */
      targetDateFunds: Readonly<Record<number, string>>;
    }
);

/** Shown first and used unless the household picks another. */
export const DEFAULT_BENCHMARK_KEY = "target_date";

export const BENCHMARKS: readonly BenchmarkDefinition[] = [
  {
    key: "target_date",
    label: "Target-date fund",
    description:
      "The all-in-one fund for your planned retirement year — US and international stocks plus bonds, getting safer as retirement nears (Vanguard Target Retirement, priced with its own fund). The simple, set-and-forget alternative to choosing your own investments.",
    targetDateFunds: {
      2025: "VTTVX",
      2030: "VTHRX",
      2035: "VTTHX",
      2040: "VFORX",
      2045: "VTIVX",
      2050: "VFIFX",
      2055: "VFFVX",
      2060: "VTTSX",
      2065: "VLXVX",
      2070: "VSVNX",
    },
  },
  {
    key: "stocks_80_20",
    label: "80/20 stocks/bonds",
    description:
      "80% stocks (US and international), 20% bonds, kept at that mix (priced with iShares AOA).",
    ticker: "AOA",
  },
  {
    key: "stocks_60_40",
    label: "60/40 stocks/bonds",
    description:
      "60% stocks (US and international), 40% bonds, kept at that mix (priced with iShares AOR).",
    ticker: "AOR",
  },
  {
    key: "world",
    label: "Whole world stocks",
    description:
      "Every listed company worldwide, US and international, no bonds (priced with VT).",
    ticker: "VT",
  },
  {
    key: "sp500",
    label: "S&P 500",
    ticker: "SPY",
    description: "500 large US companies (priced with SPY).",
  },
  {
    key: "total_us",
    label: "Total US market",
    ticker: "VTI",
    description: "Every listed US company, large and small (priced with VTI).",
  },
  {
    key: "dow",
    label: "Dow",
    ticker: "DIA",
    description: "30 large US companies (priced with DIA).",
  },
];

export type ResolvedBenchmark = {
  key: string;
  /** e.g. "Target-date 2055 fund" for a target-date entry. */
  label: string;
  ticker: string;
  description: string;
};

/**
 * The fund a benchmark is priced with for this household. A target-date
 * entry takes the vintage closest to `retirementYear` (whole years never
 * tie with 5-year vintages); null when that isn't known.
 */
export function resolveBenchmark(
  b: BenchmarkDefinition,
  retirementYear: number | null,
): ResolvedBenchmark | null {
  if (b.ticker !== undefined)
    return {
      key: b.key,
      label: b.label,
      ticker: b.ticker,
      description: b.description,
    };
  if (retirementYear === null) return null;
  const vintages = Object.keys(b.targetDateFunds)
    .map(Number)
    .sort((x, y) => x - y);
  if (vintages.length === 0) return null;
  const vintage = vintages.reduce((best, v) =>
    Math.abs(v - retirementYear) <= Math.abs(best - retirementYear) ? v : best,
  );
  return {
    key: b.key,
    label: `Target-date ${vintage} fund`,
    ticker: b.targetDateFunds[vintage]!,
    description: b.description,
  };
}
