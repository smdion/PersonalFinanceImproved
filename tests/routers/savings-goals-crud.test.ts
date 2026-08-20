/**
 * savings.savingsGoals router CRUD integration tests.
 *
 * Moved from routers/settings/admin.ts to routers/savings.ts (audit
 * Batch 11 Finding 1 — page-ownership rule, RULES.md's "Settings Belong on
 * Their Pages") — these describe blocks moved out of settings-admin.test.ts
 * alongside it (2026-08-20).
 */
import "./setup-mocks";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestCaller, adminSession } from "./setup";

describe("savings.savingsGoals", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let cleanup: () => void;
  let emergencyFundId: number;
  let vacationId: number;

  beforeAll(async () => {
    const ctx = await createTestCaller(adminSession);
    caller = ctx.caller;
    cleanup = ctx.cleanup;
  });

  afterAll(() => cleanup());

  describe("list", () => {
    it("returns an empty array on a fresh database", async () => {
      const rows = await caller.savings.savingsGoals.list();
      expect(Array.isArray(rows)).toBe(true);
      expect(rows).toHaveLength(0);
    });
  });

  describe("create", () => {
    it("creates an emergency fund goal", async () => {
      const result = await caller.savings.savingsGoals.create({
        name: "Emergency Fund",
        targetAmount: "15000",
        monthlyContribution: "750",
        priority: 1,
        isActive: true,
        isEmergencyFund: true,
      });
      expect(result).toBeDefined();
      expect(result!.name).toBe("Emergency Fund");
      expect(result!.isEmergencyFund).toBe(true);
      expect(result!.isActive).toBe(true);
      emergencyFundId = result!.id;
    });

    it("creates a regular savings goal with targetDate", async () => {
      const result = await caller.savings.savingsGoals.create({
        name: "Vacation 2027",
        targetAmount: "5000",
        targetDate: "2027-06-01",
        monthlyContribution: "300",
        priority: 2,
        isActive: true,
        isEmergencyFund: false,
        targetMode: "fixed",
      });
      expect(result).toBeDefined();
      expect(result!.name).toBe("Vacation 2027");
      expect(result!.targetDate).toBe("2027-06-01");
      vacationId = result!.id;
    });

    it("creates an ongoing-mode goal", async () => {
      const result = await caller.savings.savingsGoals.create({
        name: "Monthly Savings Buffer",
        monthlyContribution: "500",
        priority: 3,
        isActive: true,
        targetMode: "ongoing",
      });
      expect(result).toBeDefined();
      expect(result!.targetMode).toBe("ongoing");
    });

    it("creates a bucket-mode goal", async () => {
      const result = await caller.savings.savingsGoals.create({
        name: "Holding Bucket",
        monthlyContribution: "0",
        priority: 4,
        isActive: true,
        targetMode: "bucket",
      });
      expect(result).toBeDefined();
      expect(result!.targetMode).toBe("bucket");
    });

    it("update rejects invalid targetMode", async () => {
      const created = await caller.savings.savingsGoals.create({
        name: "Mode Test Goal",
        monthlyContribution: "0",
        priority: 5,
        isActive: true,
        targetMode: "fixed",
      });
      await expect(
        caller.savings.savingsGoals.update({
          id: created!.id,
          name: "Mode Test Goal",
          monthlyContribution: "0",
          isActive: true,
          isEmergencyFund: false,
          // @ts-expect-error intentional invalid value
          targetMode: "invalid_mode",
        }),
      ).rejects.toThrow();
      await caller.savings.savingsGoals.delete({ id: created!.id });
    });

    it("created goals appear in list", async () => {
      const rows = await caller.savings.savingsGoals.list();
      expect(rows.length).toBeGreaterThanOrEqual(3);
    });

    it("list is ordered by ascending priority", async () => {
      const rows = await caller.savings.savingsGoals.list();
      const priorities = rows.map((r: { priority: number }) => r.priority);
      expect(priorities).toEqual([...priorities].sort((a, b) => a - b));
    });
  });

  describe("update", () => {
    it("updates a goal name and target details (funding lives on savings_goal_profile_allocations, not the goal)", async () => {
      const result = await caller.savings.savingsGoals.update({
        id: vacationId,
        name: "Europe Trip 2027",
        targetAmount: "8000",
        targetDate: "2027-06-01",
        priority: 2,
        isActive: true,
        isEmergencyFund: false,
        targetMode: "fixed",
      });
      expect(result).toBeDefined();
      expect(result!.name).toBe("Europe Trip 2027");
    });

    it("deactivates a goal by setting isActive: false", async () => {
      const result = await caller.savings.savingsGoals.update({
        id: vacationId,
        name: "Europe Trip 2027",
        targetAmount: "8000",
        monthlyContribution: "500",
        priority: 2,
        isActive: false,
        isEmergencyFund: false,
        targetMode: "fixed",
      });
      expect(result).toBeDefined();
      expect(result!.isActive).toBe(false);
    });

    it("deactivated goal still appears in list with isActive: false", async () => {
      const rows = await caller.savings.savingsGoals.list();
      const found = rows.find((r: { id: number }) => r.id === vacationId);
      expect(found).toBeDefined();
      expect(found!.isActive).toBe(false);
    });

    it("can update target amount on emergency fund", async () => {
      const result = await caller.savings.savingsGoals.update({
        id: emergencyFundId,
        name: "Emergency Fund",
        targetAmount: "20000",
        monthlyContribution: "750",
        priority: 1,
        isActive: true,
        isEmergencyFund: true,
        targetMode: "fixed",
      });
      expect(result).toBeDefined();
      expect(result!.targetAmount).toBe("20000");
    });
  });

  describe("delete", () => {
    it("deletes a savings goal", async () => {
      const created = await caller.savings.savingsGoals.create({
        name: "Throwaway Goal",
        targetAmount: "500",
        monthlyContribution: "50",
        priority: 99,
        isActive: true,
      });
      expect(created).toBeDefined();

      await caller.savings.savingsGoals.delete({ id: created!.id });

      const rows = await caller.savings.savingsGoals.list();
      expect(
        rows.find((r: { id: number }) => r.id === created!.id),
      ).toBeUndefined();
    });

    it("other goals are unaffected when one is deleted", async () => {
      const before = await caller.savings.savingsGoals.list();
      const countBefore = before.length;

      const tmp = await caller.savings.savingsGoals.create({
        name: "Ephemeral Goal",
        monthlyContribution: "0",
        priority: 100,
        isActive: true,
      });
      await caller.savings.savingsGoals.delete({ id: tmp!.id });

      const after = await caller.savings.savingsGoals.list();
      expect(after.length).toBe(countBefore);
    });
  });
});

describe("savings.savingsGoals additional coverage", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller(adminSession);
    caller = ctx.caller;
    cleanup = ctx.cleanup;
  });

  afterAll(() => cleanup());

  it("creates a goal with targetMonths", async () => {
    const result = await caller.savings.savingsGoals.create({
      name: "Monthly Target Goal",
      targetAmount: "6000",
      targetMonths: 12,
      priority: 11,
      isActive: true,
    });
    expect(result).toBeDefined();
    expect(result!.targetMonths).toBe(12);
  });

  it("creates a goal with parentGoalId", async () => {
    const parent = await caller.savings.savingsGoals.create({
      name: "Parent Goal",
      priority: 20,
      isActive: true,
    });
    const child = await caller.savings.savingsGoals.create({
      name: "Child Goal",
      parentGoalId: parent!.id,
      priority: 21,
      isActive: true,
    });
    expect(child).toBeDefined();
    expect(child!.parentGoalId).toBe(parent!.id);
  });

  it("creating a goal seeds a $0/no-percent funding row for every existing budget profile", async () => {
    let [profile] = await caller.budget.listProfiles();
    if (!profile) {
      profile = await caller.budget.createProfile({ name: "Funding Test" });
    }
    const created = await caller.savings.savingsGoals.create({
      name: "Seeded Funding Goal",
      priority: 22,
      isActive: true,
    });
    const rows = await caller.savings.goalProfileAllocations.list({
      profileId: profile!.id,
    });
    const row = rows.find((r) => r.goalId === created!.id);
    expect(row).toBeDefined();
    expect(row!.monthlyContribution).toBe(0);
    expect(row!.allocationPercent).toBeNull();
  });

  it("updates all fields on a goal (funding lives on savings_goal_profile_allocations, not the goal)", async () => {
    const created = await caller.savings.savingsGoals.create({
      name: "Full Update Test",
      targetAmount: "10000",
      priority: 30,
      isActive: true,
      isEmergencyFund: false,
      targetMode: "fixed",
    });
    const result = await caller.savings.savingsGoals.update({
      id: created!.id,
      name: "Fully Updated",
      targetAmount: "20000",
      targetDate: "2028-12-31",
      priority: 1,
      isActive: false,
      isEmergencyFund: true,
      targetMode: "ongoing",
    });
    expect(result).toBeDefined();
    expect(result!.name).toBe("Fully Updated");
    expect(result!.targetAmount).toBe("20000");
    expect(result!.targetDate).toBe("2028-12-31");
    expect(result!.priority).toBe(1);
    expect(result!.isActive).toBe(false);
    expect(result!.isEmergencyFund).toBe(true);
    expect(result!.targetMode).toBe("ongoing");
  });
});
