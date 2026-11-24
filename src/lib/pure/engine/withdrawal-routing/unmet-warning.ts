/** The Traditional cap's "unmet from <account>" lines across routing passes. */

/** How every Traditional cap line starts: the line and its filter share it. */
const TRADITIONAL_CAP_PREFIX = "Traditional withdrawal cap hit — ";

/** The Traditional cap held back `amount` of an account's draw, unmet. */
export function traditionalCapUnmetWarning(
  amount: number,
  category: string,
): string {
  return `${TRADITIONAL_CAP_PREFIX}$${amount.toLocaleString()} unmet from ${category}`;
}

/** An earlier pass's warnings once a later pass routes what it left: its
 *  Traditional cap lines go, so only the last pass says what a cap held
 *  back. A year's unmet need is the year's, not a pass's. */
export function withoutUnmetWarning(warnings: readonly string[]): string[] {
  return warnings.filter((w) => !w.startsWith(TRADITIONAL_CAP_PREFIX));
}
