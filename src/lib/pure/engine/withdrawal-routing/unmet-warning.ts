/** The routing pass's unmet-need warning, one text for every mode. */

const UNMET = "withdrawal need unmet — insufficient funds across all accounts";

/** What a routing pass left unfunded, said once per pass. */
export function unmetNeedWarning(amount: number): string {
  return `$${amount.toLocaleString()} ${UNMET}`;
}

/** An earlier pass's warnings once a later pass routes what it left: every
 *  line stating an unmet amount (the need's, or a cap's "unmet from" an
 *  account) goes, so only the last pass says what went unmet. */
export function withoutUnmetWarning(warnings: readonly string[]): string[] {
  return warnings.filter((w) => !w.includes("unmet"));
}
