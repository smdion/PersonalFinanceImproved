/**
 * Prices for funds with no public ticker (collective trusts and other
 * plan-only funds), taken from the institution's own reports: reported
 * value ÷ shares.
 */

/** Largest rounding error, as a share of price, a cent-rounded value may leave in its implied
 *  unit price; positions under $0.005 ÷ this give no price (rounding would read as a move). */
export const IMPLIED_PRICE_MAX_ERROR = 0.0002;
