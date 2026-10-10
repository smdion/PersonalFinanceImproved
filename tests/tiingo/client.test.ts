import { describe, it, expect, vi, beforeEach } from "vitest";
import { testApiKey, getTickerMeta } from "@/lib/tiingo/client";
import { BudgetApiError } from "@/lib/budget-api/errors";

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
