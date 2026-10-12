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
