import { describe, it, expect } from "vitest";
import { tickerDetailUrl } from "@/lib/config/ticker-links";

describe("tickerDetailUrl", () => {
  it("links listed symbols to their detail page", () => {
    expect(tickerDetailUrl("EXMPX")).toBe(
      "https://finance.yahoo.com/quote/EXMPX",
    );
    expect(tickerDetailUrl("BRK.B")).toBe(
      "https://finance.yahoo.com/quote/BRK.B",
    );
  });
  it("doesn't link names or empty symbols", () => {
    expect(tickerDetailUrl("Example Index Fund")).toBeNull();
    expect(tickerDetailUrl("")).toBeNull();
    expect(tickerDetailUrl(null)).toBeNull();
  });
});
