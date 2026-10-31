/**
 * Thresholds for the investment-data monitors (Settings → Data sources and
 * the sidebar). Relative to each account, never fixed dollar figures.
 */

/** Holdings older than this many days, for an account that used to report them, need attention. */
export const HOLDINGS_STALE_DAYS = 7;

/**
 * Reported holdings may trail the balance (a plan can price holdings a few
 * days late), so only a larger gap — e.g. a fund missing from the list —
 * needs attention. Fraction of the balance.
 */
export const HOLDINGS_BALANCE_GAP_FRACTION = 0.05;

/**
 * Money between trades is in the balance but in no fund: a deposit waiting
 * to be invested, a sale waiting to settle. That clears in days, while a
 * fund missing from the list stays missing — so a gap needs attention only
 * once it has lasted this many days.
 */
export const HOLDINGS_GAP_GRACE_DAYS = 7;
