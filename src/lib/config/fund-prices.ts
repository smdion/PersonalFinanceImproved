/**
 * Prices for funds with no public ticker (collective trusts and other
 * plan-only funds), taken from the institution's own reports: reported
 * value ÷ shares.
 */

/**
 * Largest rounding error, as a share of the price, that a reported value
 * may leave in its implied unit price (a value is rounded to the cent, so
 * this needs a position of at least $0.005 ÷ this). Smaller positions give
 * no price: their rounding would read as a day's move.
 */
export const IMPLIED_PRICE_MAX_ERROR = 0.0002;
