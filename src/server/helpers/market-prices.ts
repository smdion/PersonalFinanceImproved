/**
 * Market prices from Tiingo, fetched on demand and kept in memory — a
 * few requests per held fund a day, inside the free tier: month-end
 * total-return series for benchmarks (12 h), today's close for valuing
 * holdings (6 h) and recent daily closes for dating and rolling forward
 * linked balances (6 h).
 */
import "server-only";
import {
  getDailyCloses,
  getLatestClose,
  getMonthlyPrices,
} from "@/lib/tiingo/client";
import { getTiingoApiKey } from "@/lib/tiingo/connection";
import { log } from "@/lib/logger";

type Db = typeof import("@/lib/db").db;

const TTL_MS = 12 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; prices: Map<string, number> }>();

/** "YYYY-MM" → adjusted close, or null when Tiingo isn't connected or the fetch failed. */
export async function getBenchmarkMonthlyPrices(
  db: Db,
  ticker: string,
  fromYear: number,
): Promise<Map<string, number> | null> {
  const key = `${ticker}:${fromYear}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.prices;
  const apiKey = await getTiingoApiKey(db);
  if (!apiKey) return null;
  try {
    const rows = await getMonthlyPrices(
      apiKey,
      ticker,
      `${fromYear - 1}-11-01`,
    );
    const prices = new Map(rows.map((r) => [r.date.slice(0, 7), r.adjClose]));
    cache.set(key, { at: Date.now(), prices });
    return prices;
  } catch (err) {
    log("warn", "benchmark_prices_failed", {
      ticker,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

const CLOSE_TTL_MS = 6 * 60 * 60 * 1000;
const closeCache = new Map<
  string,
  { at: number; close: { date: string; close: number } | null }
>();

/** Latest close for a ticker, or null when Tiingo isn't connected, doesn't know it, or failed. */
export async function getLatestMarketClose(
  db: Db,
  ticker: string,
): Promise<{ date: string; close: number } | null> {
  const hit = closeCache.get(ticker);
  if (hit && Date.now() - hit.at < CLOSE_TTL_MS) return hit.close;
  const apiKey = await getTiingoApiKey(db);
  if (!apiKey) return null;
  try {
    const close = await getLatestClose(apiKey, ticker);
    closeCache.set(ticker, { at: Date.now(), close });
    return close;
  } catch (err) {
    log("warn", "market_close_failed", {
      ticker,
      error: err instanceof Error ? err.message : String(err),
    });
    closeCache.set(ticker, { at: Date.now(), close: null });
    return null;
  }
}

const DAILY_FAILURE_TTL_MS = 15 * 60 * 1000;
type DailySeries = Map<string, { close: number; adjClose: number }>;
const dailyCache = new Map<
  string,
  {
    at: number;
    ttl: number;
    closes: Promise<DailySeries | null>;
  }
>();

/**
 * Day → close since the start of `from`'s month, or null when Tiingo isn't
 * connected, doesn't know the ticker, or failed. Whole months, so a moving
 * `from` doesn't refetch, and one shared request per ticker however many
 * callers ask at once. A failure is retried after a few minutes.
 */
export async function getDailyMarketCloses(
  db: Db,
  ticker: string,
  from: string,
): Promise<DailySeries | null> {
  const start = `${from.slice(0, 7)}-01`;
  const key = `${ticker}:${start}`;
  const hit = dailyCache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.closes;
  const apiKey = await getTiingoApiKey(db);
  if (!apiKey) return null;
  const entry = {
    at: Date.now(),
    ttl: CLOSE_TTL_MS,
    closes: getDailyCloses(apiKey, ticker, start).then(
      (rows): DailySeries | null =>
        new Map(
          rows.map((r) => [r.date, { close: r.close, adjClose: r.adjClose }]),
        ),
      (err: unknown) => {
        log("warn", "daily_closes_failed", {
          ticker,
          error: err instanceof Error ? err.message : String(err),
        });
        entry.ttl = DAILY_FAILURE_TTL_MS;
        return null;
      },
    ),
  };
  dailyCache.set(key, entry);
  return entry.closes;
}
