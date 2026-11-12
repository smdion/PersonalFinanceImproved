/** A percent match's rate as text: the one converter from a stored whole
 *  percent to its fraction (migration 0016 and its restore step), and the
 *  match type a profile entry resolves to. */

/** The match type whose terms are a rate: a share of each contributed dollar. */
export const PERCENT_MATCH = "percent_of_contribution";

/** A profile entry's match type: its own when it sets one (null included),
 *  else the account's, as applyContribActiveFields merges them. */
export function effectiveMatchType(
  entry: Readonly<Record<string, unknown>>,
  accountType: unknown,
): unknown {
  return Object.hasOwn(entry, "employerMatchType")
    ? entry["employerMatchType"]
    : accountType;
}

/** employer_match_rate is decimal(12,6): six integer digits, six places;
 *  employer_match_value is decimal(14,2): twelve, two places. */
const RATE_COLUMN = { wholeDigits: 6, places: 6 };
const PERCENT_COLUMN = { wholeDigits: 12, places: 2 };
/** The prefix parseFloat reads: sign, digits, point, exponent. */
const LEADING_DECIMAL = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?/;

/** A stored whole percent as a fraction: what parseFloat reads, its point
 *  moved in the text ("50.00" → "0.5", "1e2" → "1", "50%" → "0.5"). Null
 *  where parseFloat reads no finite number, or the rate doesn't fit. */
export function rateFromPercent(stored: unknown): string | null {
  return movePoint(stored, -2, RATE_COLUMN);
}

/** A rate as the whole percent a form shows and the value column keeps in
 *  step with it: "0.5" → "50", "0.035" → "3.5". */
export function percentFromRate(rate: unknown): string | null {
  return movePoint(rate, 2, PERCENT_COLUMN);
}

function movePoint(
  stored: unknown,
  places: number,
  column: { wholeDigits: number; places: number },
): string | null {
  const text =
    typeof stored === "number" && Number.isFinite(stored)
      ? String(stored)
      : typeof stored === "string"
        ? stored.trim()
        : "";
  const m = LEADING_DECIMAL.exec(text);
  const intPart = m?.[2] ?? "";
  const fracPart = m?.[3] ?? "";
  const read = parseFloat(text);
  if (!m || intPart + fracPart === "" || !Number.isFinite(read)) return null;
  if (read === 0) return "0"; // 1e-400 too: parseFloat reads it as 0
  // The value is digits × 10^shift: the point moves by the exponent and places.
  const digits = (intPart + fracPart).replace(/^0+/, "");
  const shift = Number(m[4] ?? 0) - fracPart.length + places;
  const at = digits.length + shift;
  const whole =
    shift >= 0 ? digits + "0".repeat(shift) : digits.slice(0, Math.max(0, at));
  const fraction =
    shift >= 0
      ? ""
      : ("0".repeat(Math.max(0, -at)) + digits.slice(Math.max(0, at))).replace(
          /0+$/,
          "",
        );
  // The column rounds to its places: all nines rounding up gain a digit.
  const kept = whole + fraction.slice(0, column.places);
  const carries = /^9+$/.test(kept) && (fraction[column.places] ?? "0") >= "5";
  if (whole.length + (carries ? 1 : 0) > column.wholeDigits) return null;
  const sign = m[1] === "-" && (whole !== "" || fraction !== "") ? "-" : "";
  return `${sign}${whole || "0"}${fraction ? `.${fraction}` : ""}`;
}
