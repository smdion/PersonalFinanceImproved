// Tiingo client — end-of-day market data (benchmark/index price history).
// API: https://www.tiingo.com/documentation/end-of-day
//
// Auth is a single API token sent as `Authorization: Token <key>`. The host
// is fixed (never user-supplied), so unlike the SimpleFIN client there is no
// SSRF surface to guard.

import { BudgetApiError } from "@/lib/budget-api/errors";
import { externalRequest, uncheckedShape } from "@/lib/http/external-request";

const TIINGO_BASE_URL = "https://api.tiingo.com";

/** Ticker used to validate a key — any always-listed symbol works. */
const TEST_TICKER = "SPY";

/** Tiingo's free plan counts requests per hour (50) and per day (1,000);
 *  once refused, every request waits for the next hour instead of spending
 *  more of the quota on refusals. */
let blockedUntil = 0;

/** When Tiingo will be asked again after a rate limit; 0 when it isn't. */
export function tiingoBlockedUntil(): number {
  return blockedUntil > Date.now() ? blockedUntil : 0;
}

/**
 * GET a Tiingo endpoint as JSON via the shared externalRequest
 * (timeout + typed BudgetApiError + retries). Tiingo answers a bad key with
 * 403 `{"detail":"Invalid token."}`, which classifies as "auth". A rate
 * limit is never retried: the quota is hourly.
 */
async function requestJson<T>(path: string, apiKey: string): Promise<T> {
  if (tiingoBlockedUntil())
    throw new BudgetApiError("Rate limited (429)", "rate-limit", 429);
  try {
    return await externalRequest({
      service: "tiingo",
      endpoint: path,
      url: `${TIINGO_BASE_URL}${path}`,
      headers: { Authorization: `Token ${apiKey}` },
      schema: uncheckedShape<T>(),
    });
  } catch (err) {
    if (err instanceof BudgetApiError && err.code === "rate-limit") {
      const hour = 60 * 60 * 1000;
      blockedUntil = err.retryAfterSeconds
        ? Date.now() + err.retryAfterSeconds * 1000
        : Math.ceil(Date.now() / hour) * hour + 60_000;
    }
    throw err;
  }
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

/** A daily close as quoted, with that day's distribution and split. */
export type TiingoDailyClose = {
  date: string;
  close: number;
  /** Cash distributed per share on its ex-date; 0 otherwise. */
  divCash: number;
  /** New shares per old share on a split day; 1 otherwise. */
  splitFactor: number;
};

/** Daily closes from `startDate` (YYYY-MM-DD) to today. Raw, never
 *  Tiingo's adjusted close: that's re-based on every new distribution, so
 *  stored values would stop matching fresh ones. */
export async function getDailyCloses(
  apiKey: string,
  ticker: string,
  startDate: string,
): Promise<TiingoDailyClose[]> {
  const rows = await requestJson<
    { date: string; close: number; divCash?: number; splitFactor?: number }[]
  >(
    `/tiingo/daily/${encodeURIComponent(ticker)}/prices?startDate=${encodeURIComponent(startDate)}`,
    apiKey,
  );
  return rows.map((r) => ({
    date: r.date.slice(0, 10),
    close: r.close,
    divCash: r.divCash ?? 0,
    splitFactor: r.splitFactor ?? 1,
  }));
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
