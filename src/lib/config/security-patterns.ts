/**
 * Patterns for recognising a holding's kind from what an institution sends
 * (description / symbol), before a ticker is validated against a price
 * source. Data, not code — institution-agnostic, never user-specific.
 */

/** Settlement / sweep / money-market holdings — cash-like, not invested. */
export const CASH_LIKE_DESCRIPTION_PATTERNS: readonly RegExp[] = [
  /MONEY MARKET/i,
  /CASH RESERVES/i,
  /GOVERNMENT CASH/i,
  /SETTLEMENT/i,
  /CASH PLUS/i,
  /\bSWEEP\b/i,
  /^CASH$/i,
];

/**
 * US mutual fund tickers are five letters ending in X (NASDAQ fund symbol
 * convention). Anything else stays `other` until a price source confirms it.
 */
export const MUTUAL_FUND_TICKER_PATTERN = /^[A-Z]{4}X$/;
