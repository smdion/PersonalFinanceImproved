/** A cached budget month's balances, read in the clients' shape only. */
import { describe, it, expect } from "vitest";
import { readCachedMonthBalances } from "@/lib/budget-api/cached-month";

const KEY = "months/2031-04-01";

describe("readCachedMonthBalances", () => {
  it("reads each category's balance by id", () => {
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
  });

  it("throws on a month of another shape, naming the key and paths, never a value", () => {
    const read = () =>
      readCachedMonthBalances(KEY, {
        categories: [
          { id: "cat-a", balance: 50 },
          { id: null, balance: 10 },
          { id: "cat-c", balance: "invented-text" },
        ],
      });
    expect(read).toThrow(
      `Cached budget month ${KEY} isn't in the clients' shape (categories.1.id, categories.2.balance)`,
    );
    expect(read).not.toThrow(/invented-text/);
  });

  it("throws on a month with no categories", () => {
    expect(() => readCachedMonthBalances(KEY, {})).toThrow(/\(categories\)/);
    expect(() => readCachedMonthBalances(KEY, null)).toThrow(/\(\(root\)\)/);
  });
});
