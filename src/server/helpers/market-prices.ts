/**
 * Market prices from Tiingo, fetched on demand and kept in memory — a
 * few requests per held fund a day, inside the free tier: month-end
 * total-return series for benchmarks (12 h), today's close for valuing
 * holdings (6 h). Recent daily closes, for dating and rolling forward
 * linked balances, are kept in the database instead (see
 * getDailyMarketCloses).
 */
import "server-only";
import { and, asc, eq, gte, sql } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import {
  getDailyCloses,
  getLatestClose,
  getMonthlyPrices,
  tiingoBlockedUntil,
} from "@/lib/tiingo/client";
import { getTiingoApiKey } from "@/lib/tiingo/connection";
import { log } from "@/lib/logger";
import type { DailyClose } from "@/lib/pure/current-balances";
import { valuationDateFor } from "@/lib/pure/market-calendar";
import { totalReturnSeries } from "@/lib/pure/total-return";
import { addDays } from "@/lib/utils/date";

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

/** A ticker missing the latest close is asked again at most this often:
 *  fund prices post hours after the 4 pm close, and the free plan allows
 *  50 requests an hour for every fund held. */
const DAILY_RETRY_MS = 30 * 60 * 1000;
/** Weekend plus a holiday: a stored series starting this far after `from`
 *  is missing its start. */
const MAX_MARKET_GAP_DAYS = 4;
type DailySeries = Map<string, DailyClose>;
const lastAsked = new Map<string, number>();
const inFlight = new Map<string, Promise<DailySeries | null>>();

/**
 * Day → close from `from` on, as a total-return series. Closes are kept in
 * the database (market_closes): each is fetched from Tiingo once, so a
 * restart or a rate limit never loses them. Tiingo is asked only for what's
 * missing — the latest close, or an older start — and at most every half
 * hour per ticker. Null when nothing is stored and Tiingo can't be asked.
 */
export async function getDailyMarketCloses(
  db: Db,
  ticker: string,
  from: string,
): Promise<DailySeries | null> {
  const key = `${ticker}:${from}`;
  const running = inFlight.get(key);
  if (running) return running;
  const work = loadDailyCloses(db, ticker, from).finally(() =>
    inFlight.delete(key),
  );
  inFlight.set(key, work);
  return work;
}

async function storedCloses(db: Db, ticker: string, from: string) {
  const t = schema.marketCloses;
  const rows = await db
    .select()
    .from(t)
    .where(and(eq(t.ticker, ticker), gte(t.date, from)))
    .orderBy(asc(t.date));
  return rows.map((r) => ({
    date: r.date,
    close: Number(r.close),
    divCash: Number(r.divCash),
    splitFactor: Number(r.splitFactor),
  }));
}

async function loadDailyCloses(
  db: Db,
  ticker: string,
  from: string,
): Promise<DailySeries | null> {
  const stored = await storedCloses(db, ticker, from);
  const latest = valuationDateFor(new Date());
  const missingStart =
    stored.length === 0 || stored[0]!.date > addDays(from, MAX_MARKET_GAP_DAYS);
  const missingLatest = stored.length > 0 && stored.at(-1)!.date < latest;
  const asked = lastAsked.get(ticker) ?? 0;
  const result = () => (stored.length > 0 ? totalReturnSeries(stored) : null);
  if (!missingStart && !missingLatest) return result();
  if (!missingStart && Date.now() - asked < DAILY_RETRY_MS) return result();
  if (missingStart && Date.now() - asked < DAILY_FAILURE_RETRY_MS)
    return result();
  const apiKey = await getTiingoApiKey(db);
  if (!apiKey || tiingoBlockedUntil()) return result();
  lastAsked.set(ticker, Date.now());
  try {
    const fetched = await getDailyCloses(
      apiKey,
      ticker,
      missingStart ? from : stored.at(-1)!.date,
    );
    if (fetched.length > 0) {
      const t = schema.marketCloses;
      await db
        .insert(t)
        .values(
          fetched.map((r) => ({
            ticker,
            date: r.date,
            close: String(r.close),
            divCash: String(r.divCash),
            splitFactor: String(r.splitFactor),
          })),
        )
        .onConflictDoUpdate({
          target: [t.ticker, t.date],
          set: {
            close: sql`excluded.close`,
            divCash: sql`excluded.div_cash`,
            splitFactor: sql`excluded.split_factor`,
            fetchedAt: sql`excluded.fetched_at`,
          },
        });
    }
    const merged = await storedCloses(db, ticker, from);
    return merged.length > 0 ? totalReturnSeries(merged) : null;
  } catch (err) {
    log("warn", "daily_closes_failed", {
      ticker,
      error: err instanceof Error ? err.message : String(err),
    });
    return result();
  }
}

/** A start that couldn't be fetched is tried again after this long. */
const DAILY_FAILURE_RETRY_MS = 15 * 60 * 1000;
