/** A percent match's rate as text: the one converter from a stored whole
 *  percent to its fraction (migration 0016 and its restore step), and the
 *  match type a profile entry resolves to. */

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

/** employer_match_rate is decimal(12,6): six integer digits. */
const MAX_INTEGER_DIGITS = 6;
const DECIMAL = /^([+-]?)(\d*)(?:\.(\d*))?$/;

/** A stored whole percent as a fraction, by moving the decimal point in the
 *  text: "50.00" → "0.5", "3.5" → "0.035", "0.5" → "0.005". Null for one
 *  that isn't a plain decimal ("", "abc", "1e2") or doesn't fit. */
export function rateFromPercent(stored: unknown): string | null {
  const text =
    typeof stored === "number" && Number.isFinite(stored)
      ? String(stored)
      : typeof stored === "string"
        ? stored.trim()
        : "";
  const m = DECIMAL.exec(text);
  const intPart = m?.[2] ?? "";
  const fracPart = m?.[3] ?? "";
  if (!m || intPart + fracPart === "") return null;
  const digits = intPart.padStart(3, "0");
  const whole = digits.slice(0, -2).replace(/^0+(?=\d)/, "");
  const fraction = (digits.slice(-2) + fracPart).replace(/0+$/, "");
  if (whole.length > MAX_INTEGER_DIGITS) return null;
  const sign = m[1] === "-" && (whole !== "0" || fraction !== "") ? "-" : "";
  return `${sign}${whole}${fraction ? `.${fraction}` : ""}`;
}
