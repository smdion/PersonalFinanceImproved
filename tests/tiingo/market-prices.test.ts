/** One ticker whose Tiingo answer doesn't check out fails alone. */
import "../routers/setup-mocks";
import { describe, expect, it, vi } from "vitest";
import {
  getBenchmarkMonthlyPrices,
  getLatestMarketClose,
} from "@/server/services/investments/market-prices";
import { tiingoPrice } from "../fixtures/tiingo";

vi.mock("@/lib/tiingo/connection", () => ({
  getTiingoApiKey: vi.fn(async () => "key"),
}));
const mockFetch = vi.fn((url: string) => {
  const bad = url.includes("/EXBAD/");
  const body = [tiingoPrice(bad ? { close: "301.25", adjClose: null } : {})];
  return Promise.resolve(new Response(JSON.stringify(body)));
});
vi.stubGlobal("fetch", mockFetch);

describe("a bad ticker among good ones", () => {
  it("leaves only that ticker's latest close unknown", async () => {
    const [good, bad, other] = await Promise.all(
      ["EXGOOD", "EXBAD", "EXOTHER"].map((t) =>
        getLatestMarketClose({} as never, t),
      ),
    );
    expect(good).toEqual({ date: "2026-10-30", close: 301.25 });
    expect(bad).toBeNull();
    expect(other).toEqual(good);
  });

  it("leaves only that benchmark's prices unknown", async () => {
    expect(
      await getBenchmarkMonthlyPrices({} as never, "EXBAD", 2026),
    ).toBeNull();
    expect(
      await getBenchmarkMonthlyPrices({} as never, "EXGOOD", 2026),
    ).toEqual(new Map([["2026-10", 301.25]]));
  });
});
