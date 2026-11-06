/** The match terms every write stores: under a percent type a rate (a
 *  fraction) with its whole percent beside it; under any other type no
 *  rate. A sent rate wins over a sent value. */
import {
  PERCENT_MATCH as PERCENT,
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

/** A percent match a write may store: a rate 0 to MAX_MATCH_RATE at two
 *  decimals of a percent, and one for any value that reads as a number.
 *  What is already stored (`before`) stays editable for every other field. */
export function matchRefused(
  percent: boolean,
  next: { rate: unknown; value: unknown },
  before: { rate: unknown; value: unknown },
): boolean {
  if (!percent) return false;
  if (next.rate == null)
    return (
      Number.isFinite(parseFloat(String(next.value))) &&
      String(next.value) !== String(before.value)
    );
  const rate = Number(next.rate);
  const fits =
    rate >= 0 &&
    rate <= MAX_MATCH_RATE &&
    (String(next.rate).split(".")[1] ?? "").length <= 4;
  if (fits) return false;
  const stored = before.rate ?? rateFromPercent(before.value);
  return stored == null || Number(stored) !== rate;
}
