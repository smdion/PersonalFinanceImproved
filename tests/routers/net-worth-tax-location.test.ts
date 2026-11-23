/** Net Worth's sums by tax type book each snapshot row as the projection
 *  does (`bookedTaxType`): a row saved with a tax type its account type
 *  doesn't hold counts as its account type's, and a row of an account type
 *  this version doesn't know counts as stored. Invented rows only. */
import "./setup-mocks";
import { describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema-sqlite";
import {
  adminSession,
  createTestCaller,
  seedPerformanceAccount,
  seedSnapshot,
} from "./setup";

/** A 401(k) row saved as after-tax ($1,000, counts as pre-tax) and a row of
 *  an account type this version doesn't know, saved as after-tax ($500). */
async function seeded() {
  const t = await createTestCaller(adminSession);
  const k401 = seedPerformanceAccount(t.db, { accountLabel: "Invented 401k" });
  const unknown = seedPerformanceAccount(t.db, {
    accountLabel: "Invented Plan",
    accountType: "inventedPlanType",
  });
  seedSnapshot(t.db, "2024-12-31", [
    { performanceAccountId: k401, amount: "1000", taxType: "afterTax" },
    {
      performanceAccountId: unknown,
      amount: "500",
      taxType: "afterTax",
      accountType: "inventedPlanType",
    },
  ]);
  return { ...t, k401 };
}

const BOOKED = { preTax: 1000, afterTax: 500 };

describe("Net Worth's sums by tax type", () => {
  it("the comparison books each row", async () => {
    const { caller, cleanup } = await seeded();
    try {
      const { portfolioBreakdown } = await caller.netWorth.computeComparison({
        dateFrom: "2024-12-31",
        dateTo: "2024-12-31",
      });
      expect(
        Object.fromEntries(portfolioBreakdown.map((b) => [b.label, b.to])),
      ).toEqual(BOOKED);
    } finally {
      cleanup();
    }
  });

  it("the year-end history's current year books each row", async () => {
    const { caller, cleanup } = await seeded();
    try {
      const { years } = await caller.netWorth.computeDetailedHistory();
      expect(years.at(-1)?.portfolioByTaxLocation).toEqual({
        retirement: BOOKED,
        portfolio: {},
      });
    } finally {
      cleanup();
    }
  });

  it("finalizing a year stores each row booked", async () => {
    const { caller, db, cleanup, k401 } = await seeded();
    try {
      db.insert(schema.accountPerformance)
        .values({
          year: 2024,
          performanceAccountId: k401,
          institution: "Fidelity",
          accountLabel: "Invented 401k",
          beginningBalance: "0",
          totalContributions: "0",
          yearlyGainLoss: "0",
          endingBalance: "1000",
          employerContributions: "0",
          fees: "0",
          distributions: "0",
          isActive: true,
          parentCategory: "Retirement",
        })
        .run();
      await caller.performance.finalizeYear({ year: 2024 });
      const [stored] = db.select().from(schema.netWorthAnnual).all();
      expect(stored?.portfolioByTaxLocation).toEqual({
        retirement: BOOKED,
        portfolio: {},
      });
    } finally {
      cleanup();
    }
  });
});
