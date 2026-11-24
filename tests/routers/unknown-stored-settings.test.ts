/**
 * A retirement setting stored with a value this version doesn't know (from a
 * downgrade, a hand edit or an old restore): the projection runs on the
 * setting's documented default and says so, and the stored value is kept.
 */
import "./setup-mocks";
import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { createTestCaller, seedStandardDataset } from "./setup";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "@/lib/db/schema-sqlite";
vi.mock("@/lib/budget-api", () => ({
  getActiveBudgetApi: vi.fn().mockResolvedValue("none"),
  cacheGet: vi.fn().mockResolvedValue(null),
}));
// The strategy comparison's Simulations run in this thread, 5 trials each:
// these tests read its notes, never a rate.
vi.mock("@/server/services/simulation/monte-carlo-worker-client", async () => {
  const { calculateMonteCarlo } =
    await import("@/lib/pure/simulation/monte-carlo");
  return {
    runMonteCarloOffThread: async (
      input: Parameters<typeof calculateMonteCarlo>[0],
    ) => calculateMonteCarlo({ ...input, numTrials: 5 }),
    getMonteCarloProgress: () => null,
  };
});

type Ctx = Awaited<ReturnType<typeof createTestCaller>>;
type Settings = Partial<typeof schema.retirementSettings.$inferInsert>;

/** The standard household (a $100,000 401k) with retirement settings, these
 *  stored values written over them as a hand edit would. */
async function householdWith(stored: Settings) {
  const ctx = await createTestCaller();
  const db: BetterSQLite3Database<typeof schema> = ctx.db;
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
  db.update(schema.retirementSettings).set(stored).run();
  return { ctx, personId: ids.personId };
}

/** The stored retirement settings row, as it is now. */
function storedRow(ctx: Ctx, personId: number) {
  return ctx.db
    .select()
    .from(schema.retirementSettings)
    .where(eq(schema.retirementSettings.personId, personId))
    .get();
}

describe("a stored withdrawal strategy this version doesn't know", () => {
  let ctx: Ctx;
  let personId: number;
  const NOTE =
    'The saved spending strategy "bucket" isn\'t one this version knows, so the projection uses Fixed Real. Update Ledgr or pick a strategy.';

  beforeAll(async () => {
    ({ ctx, personId } = await householdWith({ withdrawalStrategy: "bucket" }));
  });
  afterAll(() => ctx.cleanup());

  it("the projection runs as Fixed and says so", async () => {
    const response = await ctx.caller.projection.computeProjection({});
    expect(response.result!.warnings).toContain(NOTE);
  });

  it("the strategy comparison runs and says so", async () => {
    const comparison = await ctx.caller.projection.computeStrategyComparison();
    expect("notes" in comparison ? comparison.notes : []).toContain(NOTE);
  });

  it("the stored key is kept", () => {
    expect(storedRow(ctx, personId)?.withdrawalStrategy).toBe("bucket");
  });
});

describe("a stored Retirement Profile filing status this version doesn't know", () => {
  let ctx: Ctx;
  let personId: number;
  const NOTE =
    "The Retirement Profile's saved filing status \"MFS\" isn't one this version knows, so the projection uses Auto (this year's status). Update Ledgr or pick a filing status.";

  beforeAll(async () => {
    // A hand edit: the column's type admits only the four statuses.
    ({ ctx, personId } = await householdWith({
      filingStatus: "MFS" as never,
    }));
  });
  afterAll(() => ctx.cleanup());

  it("the projection runs on Auto and says so, once", async () => {
    const response = await ctx.caller.projection.computeProjection({});
    expect(response.result!.warnings.filter((w) => w === NOTE)).toHaveLength(1);
  });

  it("this year's status reads it as Auto too (the high-income line)", async () => {
    const line = await ctx.caller.contribution.computeHighIncomeLine();
    expect(line.basis).not.toBe("MFS");
    expect(Number.isFinite(line.threshold)).toBe(true);
  });

  it("the stored status is kept, also by a save of another field", async () => {
    await ctx.caller.retirement.retirementSettings.upsert({
      personId,
      retirementAge: 66,
      endAge: 90,
      returnAfterRetirement: "0.05",
      annualInflation: "0.03",
      salaryAnnualIncrease: "0.02",
    });
    expect(storedRow(ctx, personId)).toMatchObject({
      retirementAge: 66,
      filingStatus: "MFS",
    });
  });
});
