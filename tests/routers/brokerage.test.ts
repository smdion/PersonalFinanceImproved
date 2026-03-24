/**
 * Brokerage router integration tests.
 *
 * Tests goal CRUD, planned transaction CRUD, and computeSummary
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

  // ── PLANNED TRANSACTIONS ──

  describe("plannedTransactions", () => {
    let goalId: number;

    beforeAll(async () => {
      const goals = await caller.brokerage.listGoals();
      goalId = goals[0]!.id;
    });

    it("creates a planned transaction", async () => {
      const tx = await caller.brokerage.plannedTransactions.create({
        goalId,
        transactionDate: "2026-06-15",
        amount: "5000",
        description: "Initial deposit",
        isRecurring: false,
      });
      expect(tx).toBeDefined();
      expect(tx!.description).toBe("Initial deposit");
    });

    it("creates a recurring transaction", async () => {
      const tx = await caller.brokerage.plannedTransactions.create({
        goalId,
        transactionDate: "2026-01-01",
        amount: "500",
        description: "Monthly savings",
        isRecurring: true,
        recurrenceMonths: 1,
      });
      expect(tx).toBeDefined();
      expect(tx!.isRecurring).toBe(true);
    });

    it("updates a transaction", async () => {
      const summary = await caller.brokerage.computeSummary();
      const txId = summary.plannedTransactions[0]!.id;
      const updated = await caller.brokerage.plannedTransactions.update({
        id: txId,
        goalId,
        transactionDate: "2026-07-01",
        amount: "6000",
        description: "Updated deposit",
        isRecurring: false,
      });
      expect(updated).toBeDefined();
    });

    it("deletes a transaction", async () => {
      const summary = await caller.brokerage.computeSummary();
      const count = summary.plannedTransactions.length;
      const txId = summary.plannedTransactions[0]!.id;
      await caller.brokerage.plannedTransactions.delete({ id: txId });
      const after = await caller.brokerage.computeSummary();
      expect(after.plannedTransactions.length).toBe(count - 1);
    });
  });

  // ── COMPUTE SUMMARY ──

  describe("computeSummary", () => {
    it("returns goals and planned transactions", async () => {
      const summary = await caller.brokerage.computeSummary();
      expect(summary).toHaveProperty("goals");
      expect(summary).toHaveProperty("plannedTransactions");
      expect(Array.isArray(summary.goals)).toBe(true);
      expect(Array.isArray(summary.plannedTransactions)).toBe(true);
    });

    it("goals have numeric targetAmount", async () => {
      const summary = await caller.brokerage.computeSummary();
      for (const g of summary.goals) {
        expect(typeof g.targetAmount).toBe("number");
      }
    });

    it("planned transactions have numeric amount", async () => {
      const summary = await caller.brokerage.computeSummary();
      for (const t of summary.plannedTransactions) {
        expect(typeof t.amount).toBe("number");
      }
    });
  });
});
