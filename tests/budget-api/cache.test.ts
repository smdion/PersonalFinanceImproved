/* eslint-disable no-restricted-syntax -- a stub client and the harness db are cast to the app's types */
import "../helpers/setup-mocks";
import { describe, it, expect, vi } from "vitest";
import {
  cacheGet,
  cacheSet,
  refreshCategoryCache,
} from "@/lib/budget-api/cache";
import type { BudgetAPIClient } from "@/lib/budget-api/interface";
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

      const categories = await cacheGet<{ id: string }[]>(
        db as never,
        "ynab",
        "categories",
      );
      expect(categories?.data).toEqual([{ id: "old" }]);
    } finally {
      cleanup();
    }
  });
});
