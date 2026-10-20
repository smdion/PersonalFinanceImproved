/**
 * Links that open a page at a specific section — one place, so a page and
 * every link into it agree on the parameter.
 */

/** Savings → Paychecks & Growth, where extra-paycheck routing is set up. */
export const savingsExtraPaychecksHref = "/savings?section=extraPaychecks";

/** Element id of Portfolio's Holding history section. */
export const HOLDING_HISTORY_ANCHOR = "holding-history";
/** Portfolio → Holding history, where each account's past funds are entered. */
export const holdingHistoryHref = `/portfolio#${HOLDING_HISTORY_ANCHOR}`;
