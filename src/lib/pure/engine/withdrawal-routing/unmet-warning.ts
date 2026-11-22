/** The Traditional cap's "unmet from <account>" lines across routing passes. */

/** An earlier pass's warnings once a later pass routes what it left: its
 *  Traditional cap lines ("unmet from" an account) go, so only the last pass
 *  says what a cap held back. A year's unmet need is the year's, not a pass's. */
export function withoutUnmetWarning(warnings: readonly string[]): string[] {
  return warnings.filter((w) => !w.includes("unmet"));
}
