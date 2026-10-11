/**
 * Where a ticker links for its detail page. Yahoo Finance resolves any
 * listed ticker (stocks, ETFs, mutual funds) from the symbol alone — no
 * exchange prefix needed, unlike Google Finance.
 */
const TICKER_PATTERN = /^[A-Z0-9][A-Z0-9.\-^]{0,9}$/;

/** Detail-page URL for a ticker, or null when it isn't a listed symbol. */
export function tickerDetailUrl(
  symbol: string | null | undefined,
): string | null {
  if (!symbol || !TICKER_PATTERN.test(symbol)) return null;
  return `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`;
}
