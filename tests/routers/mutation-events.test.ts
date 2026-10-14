/**
 * Every successful tRPC mutation clears buildYearEndHistory's short-lived
 * cache (trpc.ts → mutation-events.ts), so a read right after a write is
 * never served from history built before it.
 */
import "./setup-mocks";
import { describe, it, expect } from "vitest";
import { createTestCaller, adminSession } from "./setup";
import * as schema from "@/lib/db/schema-sqlite";
import { buildYearEndHistory } from "@/server/helpers/snapshot";

describe("mutation events", () => {
  it("a successful mutation invalidates the year-end history cache", async () => {
    const { caller, db, rawDb, cleanup } = await createTestCaller(adminSession);
    try {
      const has2019 = async () =>
        (await buildYearEndHistory(rawDb)).some((r) => r.year === 2019);
      expect(await has2019()).toBe(false);

      db.insert(schema.netWorthAnnual)
        .values({
          yearEndDate: "2019-12-31",
          portfolioTotal: "1000",
          cash: "0",
          houseValue: "0",
          otherAssets: "0",
          mortgageBalance: "0",
          otherLiabilities: "0",
          portfolioByTaxLocation: { retirement: {}, portfolio: {} },
        })
        .run();
      expect(await has2019()).toBe(false); // still cached

      // Any mutation — this one doesn't clear the cache itself.
      await caller.budget.createProfile({ name: "Unrelated" });
      expect(await has2019()).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("a query does not invalidate it", async () => {
    const { caller, db, rawDb, cleanup } = await createTestCaller(adminSession);
    try {
      await buildYearEndHistory(rawDb);
      db.insert(schema.netWorthAnnual)
        .values({
          yearEndDate: "2018-12-31",
          portfolioTotal: "1000",
          cash: "0",
          houseValue: "0",
          otherAssets: "0",
          mortgageBalance: "0",
          otherLiabilities: "0",
          portfolioByTaxLocation: { retirement: {}, portfolio: {} },
        })
        .run();
      await caller.settings.appSettings.list();
      const rows = await buildYearEndHistory(rawDb);
      expect(rows.some((r) => r.year === 2018)).toBe(false);
    } finally {
      cleanup();
    }
  });
});
