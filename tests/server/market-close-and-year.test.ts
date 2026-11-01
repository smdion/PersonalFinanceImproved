/** Two small date-and-cache rules. */
import "../routers/setup-mocks";
import { afterEach, describe, expect, it, vi } from "vitest";
import { calendarYear } from "@/lib/utils/date";
import { getLatestClose } from "@/lib/tiingo/client";
import { getLatestMarketClose } from "@/server/helpers/market-prices";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/tiingo/connection", () => ({
  getTiingoApiKey: vi.fn(async () => "key"),
}));
vi.mock("@/lib/tiingo/client", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getLatestClose: vi.fn(),
}));

const originalTz = process.env.TZ;
afterEach(() => {
  process.env.TZ = originalTz;
  vi.useRealTimers();
});

describe("calendarYear", () => {
  it("reads Jan 1 as its own year behind UTC", () => {
    process.env.TZ = "America/Chicago";
    expect(calendarYear("1990-01-01")).toBe(1990);
  });
});

describe("getLatestMarketClose", () => {
  it("asks again soon after a failure, not six hours later", async () => {
    vi.useFakeTimers();
    vi.mocked(getLatestClose).mockRejectedValueOnce(new Error("blip"));
    expect(await getLatestMarketClose({} as never, "EXFAIL")).toBeNull();
    vi.advanceTimersByTime(20 * 60 * 1000);
    const close = { date: "2026-10-30", close: 100 };
    vi.mocked(getLatestClose).mockResolvedValueOnce(close);
    expect(await getLatestMarketClose({} as never, "EXFAIL")).toEqual(close);
  });
});
