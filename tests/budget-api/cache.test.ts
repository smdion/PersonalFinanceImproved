/* eslint-disable no-restricted-syntax -- a stub client and the harness db are cast to the app's types */
import "../helpers/setup-mocks";
import { describe, it, expect, vi } from "vitest";
import {
  cacheGet,
  cacheSet,
  refreshCategoryCache,
} from "@/lib/budget-api/cache";
import type { BudgetAPIClient } from "@/lib/budget-api/interface";
import { logWarnOnce } from "@/lib/logger";
import { createTestDb } from "../helpers/db-harness";

type Db = Parameters<typeof cacheSet>[0];

describe("refreshCategoryCache", () => {
  it("writes the categories and the month detail together: one failing leaves both as they were", async () => {
    const { rawDb, cleanup } = await createTestDb();
    const db = rawDb as unknown as Db;
    try {
      await cacheSet(db, "ynab", "categories", [{ id: "old" }]);
      const client = {
        getCategories: vi.fn().mockResolvedValue([{ id: "new" }]),
        // A BigInt can't be serialized, so the second write throws.
        getMonthDetail: vi.fn().mockResolvedValue({ total: BigInt(1) }),
      } as unknown as BudgetAPIClient;

      await expect(
        refreshCategoryCache(
          { db: db as never, scope: { asOf: new Date() } },
          "ynab",
          client,
        ),
      ).rejects.toThrow();

      const categories = await cacheGet(db as never, "ynab", "categories");
      expect(categories?.data).toEqual([{ id: "old" }]);
    } finally {
      cleanup();
    }
  });
});

describe("cacheGet", () => {
  it("reads data that fits its key's shape as itself, without a warning", async () => {
    const { rawDb, cleanup } = await createTestDb();
    const db = rawDb as unknown as Db;
    vi.mocked(logWarnOnce).mockClear();
    try {
      const accounts = [
        {
          id: "a1",
          name: "Checking",
          type: "checking",
          onBudget: true,
          closed: false,
          balance: 120.5,
          clearedBalance: 100,
        },
      ];
      await cacheSet(db, "ynab", "accounts", accounts);
      expect((await cacheGet(db, "ynab", "accounts"))?.data).toEqual(accounts);
      expect(logWarnOnce).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });

  it("reads data an older version cached in another shape as stored, with a warning keyed by key and service", async () => {
    const { rawDb, cleanup } = await createTestDb();
    const db = rawDb as unknown as Db;
    vi.mocked(logWarnOnce).mockClear();
    try {
      const month = { month: "2026-03-01", categories: [{ id: "c1" }] };
      await cacheSet(db, "actual", "months/2026-03-01", month);
      expect((await cacheGet(db, "actual", "months/2026-03-01"))?.data).toEqual(
        month,
      );
      expect(logWarnOnce).toHaveBeenCalledWith(
        "stored_value_unexpected_shape",
        "budget_api_cache.months/2026-03-01 (actual)",
        expect.objectContaining({
          source: "budget_api_cache.months/2026-03-01 (actual)",
        }),
      );
    } finally {
      cleanup();
    }
  });
});
