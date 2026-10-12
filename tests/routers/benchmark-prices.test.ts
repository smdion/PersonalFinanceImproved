/** Index prices for the Performance page's benchmark column. Invented prices only. */
import "./setup-mocks";
import { describe, it, expect, vi, afterAll } from "vitest";

vi.mock("@/server/helpers/market-prices", () => ({
  getBenchmarkMonthlyPrices: vi.fn(async (_db: unknown, ticker: string) =>
    ticker === "SPY" || ticker === "VFFVX"
      ? new Map([
          ["2019-12", 100],
          ["2020-01", 101],
        ])
      : null,
  ),
  getLatestMarketClose: vi.fn(async () => null),
}));

vi.mock("@/server/helpers/retirement-profile", async (orig) => ({
  ...(await orig<typeof import("@/server/helpers/retirement-profile")>()),
  householdRetirementYear: vi.fn(async () => 2054),
}));

const { createTestCaller, viewerSession } = await import("./setup");

describe("investments.getBenchmarkPrices", () => {
  const cleanups: (() => void)[] = [];
  afterAll(() => cleanups.forEach((c) => c()));

  it("returns an index's monthly prices — public data, so any signed-in user", async () => {
    const t = await createTestCaller(viewerSession);
    cleanups.push(t.cleanup);
    expect(
      await t.caller.investments.getBenchmarkPrices({
        key: "sp500",
        fromYear: 2020,
      }),
    ).toEqual({
      key: "sp500",
      label: "S&P 500",
      ticker: "SPY",
      prices: { "2019-12": 100, "2020-01": 101 },
    });
  });

  it("prices the target-date fund for the household's retirement year", async () => {
    const t = await createTestCaller();
    cleanups.push(t.cleanup);
    expect(
      await t.caller.investments.getBenchmarkPrices({
        key: "target_date",
        fromYear: 2020,
      }),
    ).toMatchObject({ label: "Target-date 2055 fund", ticker: "VFFVX" });
  });

  it("is null when prices aren't available, and rejects unknown indexes", async () => {
    const t = await createTestCaller();
    cleanups.push(t.cleanup);
    expect(
      await t.caller.investments.getBenchmarkPrices({
        key: "dow",
        fromYear: 2020,
      }),
    ).toBeNull();
    await expect(
      t.caller.investments.getBenchmarkPrices({ key: "nope", fromYear: 2020 }),
    ).rejects.toThrow();
  });
});
