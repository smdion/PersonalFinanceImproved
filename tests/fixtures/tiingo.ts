/**
 * Tiingo end-of-day responses with every field its documentation lists
 * (tiingo.com/documentation/end-of-day). Numbers are invented; override
 * what a test needs.
 */

export function tiingoMeta(overrides: Record<string, unknown> = {}) {
  return {
    ticker: "VTI",
    name: "Vanguard Total Stock Market ETF",
    exchangeCode: "NYSE ARCA",
    description: "An example description.",
    startDate: "2001-06-15",
    endDate: "2026-10-30",
    ...overrides,
  };
}

/** A daily (or month-end) price row; `date` is an ISO timestamp. */
export function tiingoPrice(overrides: Record<string, unknown> = {}) {
  return {
    date: "2026-10-30T00:00:00.000Z",
    close: 301.25,
    high: 302.1,
    low: 298.4,
    open: 299,
    volume: 3512345,
    adjClose: 301.25,
    adjHigh: 302.1,
    adjLow: 298.4,
    adjOpen: 299,
    adjVolume: 3512345,
    divCash: 0,
    splitFactor: 1,
    ...overrides,
  };
}
