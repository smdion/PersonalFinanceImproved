/** The match terms every write stores (migration 0017's end state): a
 *  percent type, a rate and no value (column null, entry key gone); another
 *  type, no rate. A sent rate wins over a sent value. */
import {
  PERCENT_MATCH as PERCENT,
  effectiveMatchType,
  percentFromRate,
  rateFromPercent,
} from "@/lib/utils/match-rate";
/** The most a write may set a rate to: 200% ("enter 50 for 50%"). */
export const MAX_MATCH_RATE = 2;

type Stored = string | number | null | undefined;
type Entry = Record<string, unknown>;
type Terms = { value: string | null; rate: string | null };

/** A sent rate as 0016 stores one (its point moved there and back). A rate
 *  with no percent (not a number, too large) stays as sent: refused. */
function sentRateTerms(rate: unknown): Terms {
  if (rate === null) return { value: null, rate: null };
  const percent = percentFromRate(rate);
  return {
    value: null,
    rate: percent === null ? String(rate) : rateFromPercent(percent),
  };
}

/** A whole percent as its rate, the value then stored as null. One with no
 *  rate (not a number, too large) is kept, read as value / 100, or refused. */
function valueTerms(value: unknown): Terms {
  const rate = rateFromPercent(value);
  if (rate !== null) return { value: null, rate };
  const kept = typeof value === "string" || typeof value === "number";
  return { value: kept ? String(value) : null, rate: null };
}

const sameStored = (a: unknown, b: unknown) =>
  String(a ?? null) === String(b ?? null);

/** An account's match columns after a write of `type` (`incoming`: sent;
 *  `stored`: before). A value resent unchanged keeps a stored rate; leaving
 *  percent with none sent keeps the rate's whole percent as the value. */
export function accountMatchColumns(
  type: string,
  incoming: { employerMatchValue?: Stored; employerMatchRate?: Stored },
  stored: {
    employerMatchType?: string;
    employerMatchValue: Stored;
    employerMatchRate?: Stored;
  } | null,
): { employerMatchValue?: string | null; employerMatchRate: string | null } {
  const value =
    incoming.employerMatchValue !== undefined
      ? incoming.employerMatchValue
      : stored?.employerMatchValue;
  const storedRate =
    stored?.employerMatchType === PERCENT ? stored.employerMatchRate : null;
  const unchanged = sameStored(value, stored?.employerMatchValue);
  if (type !== PERCENT)
    return value == null && unchanged && storedRate != null
      ? {
          employerMatchValue: percentFromRate(storedRate),
          employerMatchRate: null,
        }
      : { employerMatchRate: null };
  const terms =
    incoming.employerMatchRate !== undefined
      ? sentRateTerms(incoming.employerMatchRate)
      : storedRate != null && unchanged
        ? { value: null, rate: String(storedRate) }
        : valueTerms(value);
  return { employerMatchValue: terms.value, employerMatchRate: terms.rate };
}

/** A profile entry after a write (`before`: as stored). Percent: a sent rate
 *  wins, an own value becomes its rate, an own rate is kept, else a borrowed
 *  value is baked. Other types: no rate; a lone rate becomes its percent. */
export function entryWithMatchRate(
  entry: Readonly<Entry>,
  account: { type: unknown; value: unknown } | undefined,
  rateSent: boolean,
  before?: Readonly<Entry>,
): Entry {
  const next: Entry = { ...entry };
  const value = entry["employerMatchValue"];
  const rate = entry["employerMatchRate"];
  const set = (terms: Terms) => {
    for (const [key, v] of [
      ["employerMatchValue", terms.value],
      ["employerMatchRate", terms.rate],
    ] as const)
      if (v === null) delete next[key];
      else next[key] = v;
  };
  if (effectiveMatchType(entry, account?.type) !== PERCENT) {
    delete next["employerMatchRate"];
    if (value == null && rate != null)
      next["employerMatchValue"] = percentFromRate(rate);
    return next;
  }
  if (rateSent && Object.hasOwn(entry, "employerMatchRate")) {
    set(sentRateTerms(rate));
    return next;
  }
  if (value != null) {
    const kept =
      before?.["employerMatchRate"] != null &&
      effectiveMatchType(before, account?.type) === PERCENT &&
      sameStored(value, before["employerMatchValue"]);
    const terms = kept
      ? { value: null, rate: String(before["employerMatchRate"]) }
      : valueTerms(value);
    // A value with no rate stays as stored (its JSON type too).
    if (terms.rate === null) delete next["employerMatchRate"];
    else set(terms);
    return next;
  }
  // A null rate key would hide the account's rate (mergedMatchRate).
  if (rate === null) delete next["employerMatchRate"];
  if (rate != null || Object.hasOwn(entry, "employerMatchValue")) return next;
  if (account?.type === PERCENT) return next;
  const borrowed = rateFromPercent(account?.value);
  if (borrowed !== null) next["employerMatchRate"] = borrowed;
  return next;
}

/** A percent match a write may store: a rate 0 to MAX_MATCH_RATE at two
 *  decimals of a percent, for any value that reads as a number. A percent
 *  already stored (`before`, typed as it resolved) stays editable. */
export function matchRefused(
  percent: boolean,
  next: { rate: unknown; value: unknown },
  before: { type: unknown; rate: unknown; value: unknown },
): boolean {
  if (!percent) return false;
  const wasPercent = before.type === PERCENT;
  if (next.rate == null)
    return (
      Number.isFinite(parseFloat(String(next.value))) &&
      (!wasPercent || String(next.value) !== String(before.value))
    );
  const rate = Number(next.rate);
  const fits =
    rate >= 0 &&
    rate <= MAX_MATCH_RATE &&
    (String(next.rate).split(".")[1] ?? "").length <= 4;
  if (fits) return false;
  const stored = wasPercent
    ? (before.rate ?? rateFromPercent(before.value))
    : null;
  return stored == null || Number(stored) !== rate;
}
