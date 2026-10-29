import type { CompositionBucket } from "@/lib/config/enum-values";
/**
 * What Ledgr compares your investments with. Each is priced with a real,
 * low-cost fund (total return: dividends reinvested), so "the benchmark"
 * is something an ordinary investor could actually have owned.
 *
 * Data, not code: another benchmark is one more entry. A target-date
 * entry picks its fund from the household's planned retirement year.
 */
type BenchmarkDefinition = {
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

type ResolvedBenchmark = {
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

/**
 * Vanguard Target Retirement's published glide path — the stock share by
 * years until retirement (negative = years after), linear between points:
 * 90% until 25 years out, down to 50% at retirement, to 30% seven years
 * after, then flat. Shown next to the household's own glide path, shifted to
 * the household's retirement age.
 */
export const VANGUARD_TDF_STOCK_SHARE: readonly {
  yearsToRetirement: number;
  stockShare: number;
}[] = [
  { yearsToRetirement: 45, stockShare: 0.9 },
  { yearsToRetirement: 25, stockShare: 0.9 },
  { yearsToRetirement: 0, stockShare: 0.5 },
  { yearsToRetirement: -7, stockShare: 0.3 },
];

/** Windows (days) for the recent balance change; each shows once the stored
 *  daily balances reach back that far. */
export const RECENT_CHANGE_WINDOWS_DAYS: readonly number[] = [1, 7, 30, 90];

/**
 * A plain index fund standing in for each composition bucket — what the
 * matched-mix line prices a household's own weights with, and the "same
 * class, index fund" a cheaper-fund suggestion points to. Data, not code;
 * `other` has no proxy and is shown as left out.
 */
export const BUCKET_INDEX_PROXIES: Readonly<
  Record<CompositionBucket, { ticker: string; label: string } | null>
> = {
  us_equity: { ticker: "VTI", label: "Total US stock market (VTI)" },
  intl_equity: { ticker: "VXUS", label: "Total international stocks (VXUS)" },
  us_bond: { ticker: "BND", label: "Total US bonds (BND)" },
  intl_bond: { ticker: "BNDX", label: "Total international bonds (BNDX)" },
  tips: { ticker: "VTIP", label: "Short-term TIPS (VTIP)" },
  cash: { ticker: "SGOV", label: "0–3 month Treasury bills (SGOV)" },
  other: null,
};

/** Holding periods. An observed period (from daily holdings) ends when the
 *  set of funds changes or the daily data skips more than
 *  `observedMaxGapTradingDays` trading days (shares move with prices every
 *  day, so they never split a period). Entered weights must sum to 1
 *  within `weightSumTolerance` (rounding), as the current glide path's do. */
export const HOLDING_PERIODS = {
  observedMaxGapTradingDays: 3,
  weightSumTolerance: 0.005,
} as const;
