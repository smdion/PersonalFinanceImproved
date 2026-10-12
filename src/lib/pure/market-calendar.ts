/**
 * US market (NYSE) trading days, for pinning a reported balance or holding
 * to the closing prices it reflects. Pure — no DB or network.
 *
 * Holiday rules follow the NYSE schedule: New Year's Day, Martin Luther King
 * Jr. Day, Washington's Birthday, Good Friday, Memorial Day, Juneteenth (from
 * 2022), Independence Day, Labor Day, Thanksgiving and Christmas. A holiday
 * on Sunday is observed Monday; on Saturday it is observed Friday — except
 * New Year's Day, which NYSE does not observe on the prior Friday. One-off
 * closures (national days of mourning, weather) are not modelled.
 */

import { addDays } from "@/lib/utils/date";

const MARKET_TIME_ZONE = "America/New_York";
/** 4:00 pm Eastern — a timestamp before this reflects the previous close. */
const MARKET_CLOSE_MINUTES = 16 * 60;

/** "YYYY-MM-DD" built from calendar parts (no timezone conversion). */
function ymd(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Calendar parts of a "YYYY-MM-DD" string, via UTC so it is zone-independent. */
function parts(date: string): { y: number; m: number; d: number; dow: number } {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return { y, m, d, dow };
}

/** nth (1-based) weekday `dow` of a month; n = -1 for the last one. */
function nthWeekday(y: number, m: number, dow: number, n: number): string {
  if (n > 0) {
    const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    return ymd(y, m, 1 + ((dow - first + 7) % 7) + (n - 1) * 7);
  }
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const last = new Date(Date.UTC(y, m - 1, lastDay)).getUTCDay();
  return ymd(y, m, lastDay - ((last - dow + 7) % 7));
}

/** Western Easter Sunday (anonymous Gregorian algorithm). */
function easterSunday(y: number): string {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return ymd(y, month, day);
}

/** Saturday → Friday, Sunday → Monday. */
function observed(date: string): string {
  const { dow } = parts(date);
  if (dow === 6) return addDays(date, -1);
  if (dow === 0) return addDays(date, 1);
  return date;
}

const holidayCache = new Map<number, Set<string>>();

/** NYSE full-day holidays observed in calendar year `y`. */
export function marketHolidays(y: number): Set<string> {
  const cached = holidayCache.get(y);
  if (cached) return cached;
  const days = new Set<string>();
  // New Year's Day: Sunday → Monday; Saturday → not observed.
  const ny = ymd(y, 1, 1);
  if (parts(ny).dow === 0) days.add(addDays(ny, 1));
  else if (parts(ny).dow !== 6) days.add(ny);
  days.add(nthWeekday(y, 1, 1, 3)); // MLK Day — 3rd Monday of January
  days.add(nthWeekday(y, 2, 1, 3)); // Washington's Birthday — 3rd Monday of February
  days.add(addDays(easterSunday(y), -2)); // Good Friday
  days.add(nthWeekday(y, 5, 1, -1)); // Memorial Day — last Monday of May
  if (y >= 2022) days.add(observed(ymd(y, 6, 19))); // Juneteenth
  days.add(observed(ymd(y, 7, 4))); // Independence Day
  days.add(nthWeekday(y, 9, 1, 1)); // Labor Day — 1st Monday of September
  days.add(nthWeekday(y, 11, 4, 4)); // Thanksgiving — 4th Thursday of November
  days.add(observed(ymd(y, 12, 25))); // Christmas
  holidayCache.set(y, days);
  return days;
}

export function isTradingDay(date: string): boolean {
  const { y, dow } = parts(date);
  return dow !== 0 && dow !== 6 && !marketHolidays(y).has(date);
}

/** The most recent trading day on or before `date` ("YYYY-MM-DD"). */
export function tradingDayOnOrBefore(date: string): string {
  let d = date;
  while (!isTradingDay(d)) d = addDays(d, -1);
  return d;
}

/**
 * The trading day whose close a reported balance reflects: the Eastern-time
 * calendar day of the report, minus one day when reported before the 4 pm
 * close, then rolled back to a trading day. SimpleFIN balance dates usually
 * arrive overnight, so they map to the previous session's close.
 */
export function valuationDateFor(reportedAt: Date): string {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: MARKET_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const p = Object.fromEntries(
    f.formatToParts(reportedAt).map((x) => [x.type, x.value]),
  );
  const day = ymd(Number(p.year), Number(p.month), Number(p.day));
  const minutes = Number(p.hour) * 60 + Number(p.minute);
  return tradingDayOnOrBefore(
    minutes < MARKET_CLOSE_MINUTES ? addDays(day, -1) : day,
  );
}

/** Trading days after `from` up to and including `to` (0 when `to` ≤ `from`). */
export function tradingDaysBetween(from: string, to: string): number {
  let count = 0;
  for (let d = addDays(from, 1); d <= to; d = addDays(d, 1)) {
    if (isTradingDay(d)) count++;
  }
  return count;
}
