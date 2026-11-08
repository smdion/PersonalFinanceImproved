/** A cached budget month's balances, checked once on read. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readCachedMonthBalances } from "@/lib/budget-api/cached-month";
import { log } from "@/lib/logger";

vi.mock("@/lib/logger", () => ({ log: vi.fn() }));

const KEY = "months/2031-04-01";

describe("readCachedMonthBalances", () => {
  beforeEach(() => vi.mocked(log).mockClear());

  it("reads each category's balance by id, without a log", () => {
    const balances = readCachedMonthBalances(KEY, {
      month: "2031-04-01",
      categories: [
        { id: "cat-a", name: "Travel", balance: 1200 },
        { id: "cat-b", name: "Gifts", balance: -35.5 },
      ],
    });
    expect([...balances]).toEqual([
      ["cat-a", 1200],
      ["cat-b", -35.5],
    ]);
    expect(log).not.toHaveBeenCalled();
  });

  it("logs a month of another shape and keeps what it can read", () => {
    const balances = readCachedMonthBalances(KEY, {
      categories: [
        { id: "cat-a", balance: 50 },
        { id: null, balance: 10 },
        { id: "cat-c", balance: null },
      ],
    });
    expect([...balances]).toEqual([["cat-a", 50]]);
    expect(log).toHaveBeenCalledWith(
      "warn",
      "budget_cache_month_unexpected_shape",
      expect.objectContaining({ cacheKey: KEY }),
    );
  });

  it("reads a month with no categories as none", () => {
    expect(readCachedMonthBalances(KEY, {}).size).toBe(0);
    expect(readCachedMonthBalances(KEY, null).size).toBe(0);
    expect(log).toHaveBeenCalledTimes(2);
  });
});
