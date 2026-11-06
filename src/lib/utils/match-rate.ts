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
/** The prefix parseFloat reads: sign, digits, point, exponent. */
const LEADING_DECIMAL = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?/;

/** A stored whole percent as a fraction: what parseFloat reads, its point
 *  moved in the text ("50.00" → "0.5", "1e2" → "1", "50%" → "0.5"). Null
 *  where parseFloat reads no finite number, or the rate doesn't fit. */
export function rateFromPercent(stored: unknown): string | null {
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
  // The value is digits × 10^shift: the point moves by the exponent and two.
  const digits = (intPart + fracPart).replace(/^0+/, "");
  const shift = Number(m[4] ?? 0) - fracPart.length - 2;
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
  if (whole.length > MAX_INTEGER_DIGITS) return null;
  const sign = m[1] === "-" && (whole !== "" || fraction !== "") ? "-" : "";
  return `${sign}${whole || "0"}${fraction ? `.${fraction}` : ""}`;
}
