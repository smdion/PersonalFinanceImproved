import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getDailyCloses,
  getLatestClose,
  getMonthlyPrices,
  getTickerMeta,
  testApiKey,
} from "@/lib/tiingo/client";
import { BudgetApiError } from "@/lib/budget-api/errors";
import { tiingoMeta, tiingoPrice } from "../fixtures/tiingo";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function jsonResponse(data: unknown, status = 200) {
  const body = JSON.stringify(data);
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: new Headers(),
    text: () => Promise.resolve(body),
    json: () => Promise.resolve(data),
  });
}

describe("tiingo client", () => {
  beforeEach(() => mockFetch.mockReset());

  it("sends the key as a Token Authorization header to the fixed Tiingo host", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({
        ticker: "VTI",
        name: "Vanguard Total Stock Market ETF",
        startDate: "2001-06-15",
        endDate: "2026-10-09",
      }),
    );

    const meta = await getTickerMeta("abc123", "VTI");

    expect(meta.startDate).toBe("2001-06-15");
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe("https://api.tiingo.com/tiingo/daily/VTI");
    expect(init.headers.Authorization).toBe("Token abc123");
  });

  it("testApiKey validates against SPY metadata", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({
        ticker: "SPY",
        name: "SPDR S&P 500 ETF Trust",
        startDate: "1993-01-29",
        endDate: "2026-10-09",
      }),
    );

    const meta = await testApiKey("abc123");

    expect(meta.ticker).toBe("SPY");
    expect(mockFetch.mock.calls[0]![0]).toBe(
      "https://api.tiingo.com/tiingo/daily/SPY",
    );
  });

  it("classifies Tiingo's 403 invalid-token response as an auth error", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({ detail: "Invalid token." }, 403),
    );

    const err = await testApiKey("bad").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(BudgetApiError);
    expect((err as BudgetApiError).code).toBe("auth");
    // Auth failures are not retried.
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe("tiingo responses are checked", () => {
  beforeEach(() => mockFetch.mockReset());

  async function badResponse(p: Promise<unknown>): Promise<string> {
    const err = await p.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BudgetApiError);
    expect((err as BudgetApiError).code).toBe("bad-response");
    expect(mockFetch).toHaveBeenCalledTimes(1); // never retried
    return (err as BudgetApiError).message;
  }

  it("reads a ticker with no price data, whose dates are null", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse(tiingoMeta({ startDate: null, endDate: null })),
    );
    expect(await getTickerMeta("k", "VTI")).toMatchObject({
      ticker: "VTI",
      startDate: null,
    });
  });

  it("reads every documented price row", async () => {
    const rows = [
      tiingoPrice({
        date: "2026-10-29T00:00:00.000Z",
        close: 300,
        adjClose: 300,
      }),
      tiingoPrice({ divCash: 0.95, splitFactor: 1 }),
    ];
    mockFetch.mockReturnValue(jsonResponse(rows));
    expect(await getDailyCloses("k", "VTI", "2026-10-29")).toEqual([
      { date: "2026-10-29", close: 300, divCash: 0, splitFactor: 1 },
      { date: "2026-10-30", close: 301.25, divCash: 0.95, splitFactor: 1 },
    ]);
    expect(await getMonthlyPrices("k", "VTI", "2026-01-01")).toEqual([
      { date: "2026-10-29", adjClose: 300 },
      { date: "2026-10-30", adjClose: 301.25 },
    ]);
    expect(await getLatestClose("k", "VTI")).toEqual({
      date: "2026-10-30",
      close: 301.25,
    });
  });

  it("has no latest close for an empty list", async () => {
    mockFetch.mockReturnValueOnce(jsonResponse([]));
    expect(await getLatestClose("k", "VTI")).toBeNull();
  });

  it.each([
    ["a string", "301.25", "expected number, received string"],
    ["null", null, "expected number, received null"],
    ["nested", { value: 301.25 }, "expected number, received object"],
  ])("fails a close sent as %s", async (_, close, issue) => {
    mockFetch.mockReturnValueOnce(
      jsonResponse([tiingoPrice(), tiingoPrice({ close })]),
    );
    expect(await badResponse(getLatestClose("k", "VTI"))).toBe(
      `Tiingo: /tiingo/daily/:ticker/prices: 1.close: ${issue}`,
    );
  });

  it("fails a renamed date or close field, once for every row", async () => {
    const row = { ...tiingoPrice(), day: "2026-10-30", price: 1 } as Record<
      string,
      unknown
    >;
    delete row.date;
    delete row.close;
    mockFetch.mockReturnValueOnce(jsonResponse([row, row]));
    expect(await badResponse(getDailyCloses("k", "VTI", "2026-10-01"))).toBe(
      "Tiingo: /tiingo/daily/:ticker/prices: 0.date: expected string, received undefined (+1 more); 0.close: expected number, received undefined (+1 more)",
    );
  });

  it("fails a renamed adjusted close on the month-end series", async () => {
    const row = { ...tiingoPrice(), adjustedClose: 1 } as Record<
      string,
      unknown
    >;
    delete row.adjClose;
    mockFetch.mockReturnValueOnce(jsonResponse([row]));
    expect(
      await badResponse(getMonthlyPrices("k", "VTI", "2026-01-01")),
    ).toMatch(/0\.adjClose: expected number, received undefined$/);
  });

  it("fails a daily row without its distribution, not reading it as none", async () => {
    const row = tiingoPrice() as Record<string, unknown>;
    delete row.divCash;
    mockFetch.mockReturnValueOnce(jsonResponse([row]));
    expect(await badResponse(getDailyCloses("k", "VTI", "2026-10-01"))).toMatch(
      /0\.divCash: expected number, received undefined$/,
    );
  });

  it("fails a date that isn't one", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse([tiingoPrice({ date: "10/30/2026" })]),
    );
    expect(await badResponse(getLatestClose("k", "VTI"))).toMatch(/0\.date/);
  });

  it("fails metadata without a ticker", async () => {
    const meta = tiingoMeta() as Record<string, unknown>;
    delete meta.ticker;
    mockFetch.mockReturnValueOnce(jsonResponse(meta));
    expect(await badResponse(getTickerMeta("k", "VTI"))).toBe(
      "Tiingo: /tiingo/daily/:ticker: ticker: expected string, received undefined",
    );
  });
});
