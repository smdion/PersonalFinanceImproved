/**
 * A stored account type this version doesn't know (saved by a newer Ledgr,
 * say): the projection and Tax Buckets leave that money out and say so,
 * naming the row and its amount.
 */
import "./setup-mocks";
import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createTestCaller,
  seedPerformanceAccount,
  seedStandardDataset,
} from "./setup";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "@/lib/db/schema-sqlite";
import { buildEnginePayload } from "@/server/services/projection/engine-payload/build-engine-payload";
import { fetchRetirementData } from "@/server/services/projection/engine-payload/load";
import { openingTotals } from "@/lib/pure/engine/opening-state";

vi.mock("@/lib/budget-api", () => ({
  getActiveBudgetApi: vi.fn().mockResolvedValue("none"),
  cacheGet: vi.fn().mockResolvedValue(null),
}));

type Ctx = Awaited<ReturnType<typeof createTestCaller>>;

/** The standard household (a $100,000 401k) with retirement settings. */
function seedHousehold(db: BetterSQLite3Database<typeof schema>) {
  const ids = seedStandardDataset(db);
  db.insert(schema.retirementSettings)
    .values({
      personId: ids.personId,
      retirementAge: 65,
      endAge: 90,
      returnAfterRetirement: "0.05",
      annualInflation: "0.03",
      salaryAnnualIncrease: "0.02",
      withdrawalRate: "0.04",
      socialSecurityMonthly: "2500",
      ssStartAge: 67,
      filingStatus: "MFJ",
    })
    .run();
  db.insert(schema.returnRateTable)
    .values({ age: 35, rateOfReturn: "0.07" })
    .run();
  return ids;
}

/** A performance account of a type this version doesn't know. */
function seedUnknownAccount(
  db: BetterSQLite3Database<typeof schema>,
  personId: number,
) {
  return seedPerformanceAccount(db, {
    accountType: "future_type",
    accountLabel: "Future Plan",
    displayName: "Future Plan",
    ownerPersonId: personId,
  });
}

const ROW_NOTE =
  'Future Plan is saved as account type "future_type", which this version doesn\'t know, so the projection and Tax Buckets leave out its $40,000. Update Ledgr or change its account type.';

describe("a snapshot row of an account type this version doesn't know", () => {
  let ctx: Ctx;

  beforeAll(async () => {
    ctx = await createTestCaller();
    const { personId, snapId } = seedHousehold(ctx.db);
    ctx.db
      .insert(schema.portfolioAccounts)
      .values({
        snapshotId: snapId,
        performanceAccountId: seedUnknownAccount(ctx.db, personId),
        amount: "40000",
        taxType: "preTax",
        institution: "Fidelity",
        accountType: "future_type",
        ownerPersonId: personId,
        parentCategory: "Retirement",
      })
      .run();
  });
  afterAll(() => ctx.cleanup());

  it("the projection leaves it out and says so", async () => {
    const data = await fetchRetirementData(ctx.rawDb);
    const payload = await buildEnginePayload(ctx.rawDb, data, {
      asOf: new Date(),
    });
    expect(payload!.portfolioTotal).toBe(100000);
    const { balances } = openingTotals(
      payload!.baseEngineInput.individualAccounts,
    );
    expect(balances.preTax).toBe(100000);
    const response = await ctx.caller.projection.computeProjection({});
    expect(response.result!.warnings).toContain(ROW_NOTE);
  });

  it("Tax Buckets leaves it out and names it", async () => {
    const response = await ctx.caller.taxBuckets.computeBreakdown();
    expect(response.portfolioByTaxType.preTax).toBe(100000);
    expect(response.accounts.map((a) => a.balance)).toEqual([100000]);
    expect(response.unknownTypeNotes).toEqual([ROW_NOTE]);
  });
});
