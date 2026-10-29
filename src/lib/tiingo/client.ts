// Tiingo client — end-of-day market data (benchmark/index price history).
// API: https://www.tiingo.com/documentation/end-of-day
//
// Auth is a single API token sent as `Authorization: Token <key>`. The host
// is fixed (never user-supplied), so unlike the SimpleFIN client there is no
// SSRF surface to guard.

import { budgetApiRequest } from "@/lib/budget-api/errors";

const TIINGO_BASE_URL = "https://api.tiingo.com";

/** Ticker used to validate a key — any always-listed symbol works. */
const TEST_TICKER = "SPY";

/**
 * GET a Tiingo endpoint as JSON via the shared budgetApiRequest wrapper
 * (timeout + typed BudgetApiError + retryWithBackoff). Tiingo answers a bad
 * key with 403 `{"detail":"Invalid token."}`, which classifies as "auth".
 */
function requestJson<T>(path: string, apiKey: string): Promise<T> {
  return budgetApiRequest<T>(`${TIINGO_BASE_URL}${path}`, {
    Authorization: `Token ${apiKey}`,
  });
}

type TiingoTickerMeta = {
  ticker: string;
  name: string;
  startDate: string;
  endDate: string;
};

/** Fetch ticker metadata (name + available price history range). */
export async function getTickerMeta(
  apiKey: string,
  ticker: string,
): Promise<TiingoTickerMeta> {
  return requestJson<TiingoTickerMeta>(
    `/tiingo/daily/${encodeURIComponent(ticker)}`,
    apiKey,
  );
}

/**
 * Validate a key with one cheap metadata call. Returns the test ticker's
 * metadata so the UI can show how far back price history goes.
 */
export async function testApiKey(apiKey: string): Promise<TiingoTickerMeta> {
  return getTickerMeta(apiKey, TEST_TICKER);
}

type TiingoMonthlyPrice = {
  /** Month-end trading day, YYYY-MM-DD. */
  date: string;
  /** Close adjusted for splits and with dividends reinvested — total return. */
  adjClose: number;
};

/** Month-end total-return prices from `startDate` (YYYY-MM-DD) to today. */
export async function getMonthlyPrices(
  apiKey: string,
  ticker: string,
  startDate: string,
): Promise<TiingoMonthlyPrice[]> {
  const rows = await requestJson<{ date: string; adjClose: number }[]>(
    `/tiingo/daily/${encodeURIComponent(ticker)}/prices?startDate=${encodeURIComponent(startDate)}&resampleFreq=monthly`,
    apiKey,
  );
  return rows.map((r) => ({ date: r.date.slice(0, 10), adjClose: r.adjClose }));
}

/** Latest daily close (unadjusted — what shares are worth today). */
export async function getLatestClose(
  apiKey: string,
  ticker: string,
): Promise<{ date: string; close: number } | null> {
  const rows = await requestJson<{ date: string; close: number }[]>(
    `/tiingo/daily/${encodeURIComponent(ticker)}/prices`,
    apiKey,
  );
  const last = rows.at(-1);
  return last ? { date: last.date.slice(0, 10), close: last.close } : null;
}
