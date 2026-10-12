import { tickerDetailUrl } from "@/lib/config/ticker-links";

/** A ticker that opens its detail page (new tab) when it's a listed symbol. */
export function TickerLink({ symbol }: { symbol: string }) {
  const url = tickerDetailUrl(symbol);
  if (!url)
    return <span className="text-primary mr-1.5 font-mono">{symbol}</span>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="mr-1.5 font-mono text-blue-600 hover:underline dark:text-blue-400"
      title={`Open ${symbol} on Yahoo Finance`}
    >
      {symbol}
    </a>
  );
}
