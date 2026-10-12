/**
 * Market prices from Tiingo, fetched on demand and kept in memory — a
 * handful of requests a day, far inside the free tier: month-end
 * total-return series for benchmarks (12 h) and today's close for valuing
 * holdings (6 h).
 */
import "server-only";
import { getLatestClose, getMonthlyPrices } from "@/lib/tiingo/client";
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
