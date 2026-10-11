/**
 * Market indexes Ledgr compares your investments with. Each is priced with
 * a low-cost fund that tracks it (total return: dividends reinvested), so
 * "the index" here is what an ordinary investor could actually have owned.
 *
 * Data, not code: another benchmark is one more entry.
 */
export type BenchmarkDefinition = {
  key: string;
  label: string;
  /** Tiingo ticker of the tracking fund. */
  ticker: string;
  /** Plain description for the methodology page and tooltips. */
  description: string;
};

export const BENCHMARKS: readonly BenchmarkDefinition[] = [
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
