/**
 * Brokerage router integration tests.
 *
 * Tests goal CRUD and computeSummary (with API balance resolution)
 * using an isolated SQLite database per test suite.
 */
import "./setup-mocks";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createTestCaller,
  seedBudgetProfile,
  seedBudgetItem,
  seedPerformanceAccount,
} from "./setup";
import * as sqliteSchema from "@/lib/db/schema-sqlite";

describe("brokerage router", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    cleanup = ctx.cleanup;
  });

  afterAll(() => cleanup());

  // ── GOALS ──

  describe("listGoals", () => {
    it("returns empty array when no goals exist", async () => {
      const goals = await caller.brokerage.listGoals();
      expect(goals).toEqual([]);
    });
  });

  describe("createGoal", () => {
    it("creates a goal and returns it", async () => {
      const goal = await caller.brokerage.createGoal({
        name: "New Car",
        targetAmount: "25000",
        targetYear: new Date().getFullYear() + 2,
        priority: 1,
      });
      expect(goal).toBeDefined();
      expect(goal!.name).toBe("New Car");
    });

    it("creates a second goal", async () => {
      const goal = await caller.brokerage.createGoal({
        name: "Vacation",
        targetAmount: "5000",
        targetYear: new Date().getFullYear() + 1,
        priority: 2,
      });
      expect(goal).toBeDefined();
    });
  });

  describe("listGoals (after create)", () => {
    it("returns created goals sorted by targetYear then priority", async () => {
      const goals = await caller.brokerage.listGoals();
      expect(goals.length).toBeGreaterThanOrEqual(2);
      // Vacation (year+1) should come before New Car (year+2)
      const vacIdx = goals.findIndex(
        (g: { name: string }) => g.name === "Vacation",
      );
      const carIdx = goals.findIndex(
        (g: { name: string }) => g.name === "New Car",
      );
      expect(vacIdx).toBeLessThan(carIdx);
    });
  });

  describe("updateGoal", () => {
    it("updates goal name and amount", async () => {
      const goals = await caller.brokerage.listGoals();
      const car = goals.find((g: { name: string }) => g.name === "New Car")!;
      await caller.brokerage.updateGoal({
        id: car.id,
        name: "Used Car",
        targetAmount: "15000",
      });
      const updated = await caller.brokerage.listGoals();
      const found = updated.find((g: { id: number }) => g.id === car.id)!;
      expect(found.name).toBe("Used Car");
      expect(found.targetAmount).toBe(15000);
    });
  });

  describe("deleteGoal", () => {
    it("deletes a goal", async () => {
      const goals = await caller.brokerage.listGoals();
      const vacation = goals.find(
        (g: { name: string }) => g.name === "Vacation",
      )!;
      await caller.brokerage.deleteGoal({ id: vacation.id });
      const after = await caller.brokerage.listGoals();
      expect(
        after.find((g: { id: number }) => g.id === vacation.id),
      ).toBeUndefined();
    });
  });

  // ── COMPUTE SUMMARY ──

  describe("computeSummary", () => {
    it("returns goals and apiBalances", async () => {
      const summary = await caller.brokerage.computeSummary();
      expect(summary).toHaveProperty("goals");
      expect(summary).toHaveProperty("apiBalances");
      expect(Array.isArray(summary.goals)).toBe(true);
      expect(Array.isArray(summary.apiBalances)).toBe(true);
    });

    it("goals have numeric targetAmount", async () => {
      const summary = await caller.brokerage.computeSummary();
      for (const g of summary.goals) {
        expect(typeof g.targetAmount).toBe("number");
      }
    });

    it("apiBalances is empty when no budget API is configured", async () => {
      const summary = await caller.brokerage.computeSummary();
      expect(summary.apiBalances).toEqual([]);
    });
  });

  // Two brokerage accounts share one account type; each budget link must
  // name the tracked account it funds, so a page never shows the other
  // account's link.
  it("budget links carry the tracked account they fund", async () => {
    const ctx = await createTestCaller();
    try {
      const { db } = ctx;
      const person = db
        .insert(sqliteSchema.people)
        .values({ name: "Pat", dateOfBirth: "1990-01-01" })
        .returning()
        .get().id;
      const retirementBrokerage = seedPerformanceAccount(db, {
        name: "Retirement Brokerage",
        accountType: "brokerage",
        parentCategory: "Retirement",
      });
      const longTerm = seedPerformanceAccount(db, {
        name: "Long Term Brokerage",
        accountType: "brokerage",
        parentCategory: "Portfolio",
      });
      const contrib = (performanceAccountId: number) =>
        db
          .insert(sqliteSchema.contributionAccounts)
          .values({
            personId: person,
            accountType: "brokerage",
            taxTreatment: "after_tax",
            employerMatchType: "none",
            performanceAccountId,
          })
          .returning()
          .get().id;
      const budget = await seedBudgetProfile(db);
      seedBudgetItem(db, budget, {
        subcategory: "R Brokerage",
        contributionAccountId: contrib(retirementBrokerage),
      });
      seedBudgetItem(db, budget, {
        subcategory: "LT Brokerage",
        contributionAccountId: contrib(longTerm),
      });
      const { budgetLinks } = await ctx.caller.brokerage.computeSummary();
      expect(
        budgetLinks.map((l) => [l.performanceAccountId, l.budgetItemName]),
      ).toEqual(
        expect.arrayContaining([
          [retirementBrokerage, "R Brokerage"],
          [longTerm, "LT Brokerage"],
        ]),
      );
    } finally {
      ctx.cleanup();
    }
  });
});
