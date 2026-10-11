/**
 * Month-end total-return prices for benchmark tracking funds, fetched from
 * Tiingo on demand and kept in memory for 12 hours — a handful of requests
 * a day, far inside the free tier. (Stored daily prices arrive with the
 * price sync; this is enough for yearly comparisons.)
 */
import "server-only";
import { getMonthlyPrices } from "@/lib/tiingo/client";
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
