/**
 * The mutations no other router test called (mutations-on-sqlite.test.ts
 * lists them until one does), each run once on real SQLite and checked by
 * what it wrote: a write path a household doesn't use can break unseen
 * (finalizeYear failed on SQLite for 209 days).
 */
import "./setup-mocks";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { adminSession, createTestCaller } from "./setup";
import * as schema from "@/lib/db/schema-sqlite";

let ctx: Awaited<ReturnType<typeof createTestCaller>>;

beforeAll(async () => {
  ctx = await createTestCaller(adminSession);
  // A fresh install has no budget yet: one profile, active.
  await ctx.caller.budget.createProfile({ name: "Household" });
});

afterAll(() => ctx.cleanup());

describe("mutations no other router test calls", () => {
  it("assets.updateAsset sets a year-end row's cash and house value", async () => {
    ctx.db
      .insert(schema.netWorthAnnual)
      .values({
        yearEndDate: "2025-12-31",
        grossIncome: "0",
        combinedAgi: "0",
        cash: "0",
        houseValue: "0",
        retirementTotal: "0",
        hsa: "0",
        ltBrokerage: "0",
        espp: "0",
        rBrokerage: "0",
        otherAssets: "0",
        mortgageBalance: "0",
        otherLiabilities: "0",
        taxFreeTotal: "0",
        taxDeferredTotal: "0",
        portfolioTotal: "0",
        portfolioByTaxLocation: { retirement: {}, portfolio: {} },
      })
      .run();
    await ctx.caller.assets.updateAsset({
      year: 2025,
      fields: { cash: 1234.5, houseValue: 300000 },
    });
    const [row] = ctx.db.select().from(schema.netWorthAnnual).all();
    expect(Number(row!.cash)).toBe(1234.5);
    expect(Number(row!.houseValue)).toBe(300000);
    await expect(
      ctx.caller.assets.updateAsset({ year: 2019, fields: { cash: 1 } }),
    ).rejects.toThrow(/No year-end history found for 2019/);
    // A year outside 1900–2100, or not whole, is refused before any read.
    for (const year of [2200, 2025.5])
      await expect(
        ctx.caller.assets.updateAsset({ year, fields: { cash: 1 } }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("budget.setMortgageItem links one budget line to a loan, and null clears it", async () => {
    const loan = await ctx.caller.mortgage.mortgageLoans.create({
      name: "Home",
      isActive: true,
      principalAndInterest: "1770.09",
      interestRate: "0.065",
      termYears: 30,
      originalLoanAmount: "280000",
      firstPaymentDate: "2022-09-01",
      propertyValuePurchase: "350000",
    });
    const [profile] = await ctx.caller.budget.listProfiles();
    const item = await ctx.caller.budget.createItem({
      profileId: profile!.id,
      category: "Housing",
      subcategory: "Mortgage",
      isEssential: true,
    });
    const linked = () =>
      ctx.db
        .select()
        .from(schema.budgetItems)
        .where(eq(schema.budgetItems.id, item!.id))
        .get()!.mortgageLoanId;
    await ctx.caller.budget.setMortgageItem({
      budgetProfileId: item!.profileId,
      loanId: loan!.id,
      itemId: item!.id,
    });
    expect(linked()).toBe(loan!.id);
    await ctx.caller.budget.setMortgageItem({
      budgetProfileId: item!.profileId,
      loanId: loan!.id,
      itemId: null,
    });
    expect(linked()).toBeNull();
  });

  it("savings.goalProfileAllocations.upsert sets a goal's funding; resetAllToZero clears every goal's", async () => {
    const [profile] = await ctx.caller.budget.listProfiles();
    expect(profile).toBeDefined();
    const goal = await ctx.caller.savings.savingsGoals.create({
      name: "Car",
      priority: 1,
      isActive: true,
    });
    const funding = async () =>
      (
        await ctx.caller.savings.goalProfileAllocations.list({
          profileId: profile!.id,
        })
      ).find((r) => r.goalId === goal!.id)!;
    await ctx.caller.savings.goalProfileAllocations.upsert({
      goalId: goal!.id,
      profileId: profile!.id,
      allocationPercent: null,
      monthlyContribution: 250,
    });
    expect((await funding()).monthlyContribution).toBe(250);
    await ctx.caller.savings.goalProfileAllocations.resetAllToZero({
      profileId: profile!.id,
    });
    const reset = await funding();
    expect(reset.monthlyContribution).toBe(0);
    expect(reset.allocationPercent).toBeNull();
  });

  it("projection.clearCache empties the projection cache and says how many rows it removed", async () => {
    const row = {
      result: {},
      expiresAt: new Date("2099-01-01T00:00:00Z"),
      engineVersion: 1,
    };
    ctx.db
      .insert(schema.projectionCache)
      .values([
        { ...row, inputHash: "a" },
        { ...row, inputHash: "b" },
      ])
      .run();
    expect(await ctx.caller.projection.clearCache()).toEqual({ cleared: 2 });
    expect(ctx.db.select().from(schema.projectionCache).all()).toEqual([]);
  });
});
