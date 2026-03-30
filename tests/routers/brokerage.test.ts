/**
 * Brokerage router integration tests.
 *
 * Tests goal CRUD and computeSummary (with API balance resolution)
 * using an isolated SQLite database per test suite.
 */
import "./setup-mocks";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestCaller } from "./setup";

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
});
