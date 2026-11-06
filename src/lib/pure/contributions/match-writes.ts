/** The match terms every write stores: under a percent type a rate (a
 *  fraction) with its whole percent beside it; under any other type no
 *  rate. A sent rate wins over a sent value. */
import {
  PERCENT_MATCH as PERCENT,
  effectiveMatchType,
  percentFromRate,
  rateFromPercent,
} from "@/lib/utils/match-rate";
/** The most a write may set a rate to: 200% ("enter 50 for 50%"). */
export const MAX_MATCH_RATE = 2;

type Stored = string | number | null | undefined;

/** The value and rate a percent match stores: from an incoming rate when
 *  one is sent (the value follows it), else from the whole percent. */
function percentTerms(
  value: unknown,
  rate: unknown,
): { value: string | null; rate: string | null } {
  if (rate !== undefined) {
    if (rate === null) return { value: null, rate: null };
    const percent = percentFromRate(rate);
    // A rate with no percent (not a number, or too large) stays as sent, so
    // matchRefused refuses it.
    if (percent === null) return { value: null, rate: String(rate) };
    return { value: percent, rate: rateFromPercent(percent) };
  }
  return {
    value:
      typeof value === "string" || typeof value === "number"
        ? String(value)
        : null,
    rate: rateFromPercent(value),
  };
}

/** An account row's match columns after a write of `type`: `incoming` is
 *  what the write sends (absent keys unsent), `stored` the row before. */
export function accountMatchColumns(
  type: string,
  incoming: { employerMatchValue?: Stored; employerMatchRate?: Stored },
  stored: { employerMatchValue: Stored } | null,
): { employerMatchValue?: string | null; employerMatchRate: string | null } {
  if (type !== PERCENT) return { employerMatchRate: null };
  const terms = percentTerms(
    incoming.employerMatchValue !== undefined
      ? incoming.employerMatchValue
      : stored?.employerMatchValue,
    incoming.employerMatchRate,
  );
  return { employerMatchValue: terms.value, employerMatchRate: terms.rate };
}

/** A profile entry after a write: a rate where it resolves to a percent,
 *  from its own value, else from the value it borrows from a non-percent
 *  account (as migration 0016 fills it). `rateSent`: its rate sets its value. */
export function entryWithMatchRate(
  entry: Readonly<Record<string, unknown>>,
  account: { type: unknown; value: unknown } | undefined,
  rateSent: boolean,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...entry };
  delete next["employerMatchRate"];
  if (effectiveMatchType(entry, account?.type) !== PERCENT) return next;
  if (rateSent && Object.hasOwn(entry, "employerMatchRate")) {
    const terms = percentTerms(undefined, entry["employerMatchRate"]);
    if (terms.value === null) delete next["employerMatchValue"];
    else next["employerMatchValue"] = terms.value;
    if (terms.rate !== null) next["employerMatchRate"] = terms.rate;
    return next;
  }
  const own = Object.hasOwn(entry, "employerMatchValue");
  if (!own && account?.type === PERCENT) return next;
  const rate = rateFromPercent(
    own ? entry["employerMatchValue"] : account?.value,
  );
  if (rate !== null) next["employerMatchRate"] = rate;
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
