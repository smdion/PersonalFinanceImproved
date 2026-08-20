import "./setup-mocks";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  getResolvedGoalAllocations,
  upsertGoalProfileAllocation,
  resetProfileAllocationsToZero,
} from "@/server/helpers/savings-allocation";
import { createTestDb, type TestDbContext } from "./db-harness";

describe("savings-allocation", () => {
  let ctx: TestDbContext;
  let profileAId: number;
  let profileBId: number;
  let goal1Id: number;
  let goal2Id: number;

  beforeAll(async () => {
    ctx = await createTestDb();

    profileAId = ctx.db
      .insert(ctx.schema.budgetProfiles)
      .values({ name: "Profile A", isActive: true, columnLabels: ["A"] })
      .returning({ id: ctx.schema.budgetProfiles.id })
      .get().id;

    profileBId = ctx.db
      .insert(ctx.schema.budgetProfiles)
      .values({ name: "Profile B", isActive: false, columnLabels: ["B"] })
      .returning({ id: ctx.schema.budgetProfiles.id })
      .get().id;

    goal1Id = ctx.db
      .insert(ctx.schema.savingsGoals)
      .values({
        name: "Emergency Fund",
        targetAmount: "10000",
        priority: 1,
        isActive: true,
      })
      .returning({ id: ctx.schema.savingsGoals.id })
      .get().id;

    goal2Id = ctx.db
      .insert(ctx.schema.savingsGoals)
      .values({
        name: "Vacation",
        targetAmount: "5000",
        priority: 2,
        isActive: true,
      })
      .returning({ id: ctx.schema.savingsGoals.id })
      .get().id;

    // goal1 has an explicit funding row for profile A; goal2 has none for
    // profile A (must resolve to the $0/no-percent default).
    ctx.db
      .insert(ctx.schema.savingsGoalProfileAllocations)
      .values({
        goalId: goal1Id,
        budgetProfileId: profileAId,
        allocationPercent: "12.500",
        monthlyContribution: "150.00",
      })
      .run();
  });

  afterAll(() => ctx.cleanup());

  describe("getResolvedGoalAllocations", () => {
    it("resolves an existing row's percent and contribution", async () => {
      const result = await getResolvedGoalAllocations(
        ctx.rawDb,
        [{ id: goal1Id }],
        profileAId,
      );
      expect(result.get(goal1Id)).toEqual({
        goalId: goal1Id,
        allocationPercent: 12.5,
        monthlyContribution: 150,
      });
    });

    it("defaults a goal with no row for the profile to $0/no-percent", async () => {
      const result = await getResolvedGoalAllocations(
        ctx.rawDb,
        [{ id: goal2Id }],
        profileAId,
      );
      expect(result.get(goal2Id)).toEqual({
        goalId: goal2Id,
        allocationPercent: null,
        monthlyContribution: 0,
      });
    });

    it("defaults every goal when profileId is null (no query issued)", async () => {
      const result = await getResolvedGoalAllocations(
        ctx.rawDb,
        [{ id: goal1Id }, { id: goal2Id }],
        null,
      );
      expect(result.get(goal1Id)).toEqual({
        goalId: goal1Id,
        allocationPercent: null,
        monthlyContribution: 0,
      });
      expect(result.get(goal2Id)).toEqual({
        goalId: goal2Id,
        allocationPercent: null,
        monthlyContribution: 0,
      });
    });

    it("batches all goals into one query rather than N+1", async () => {
      const result = await getResolvedGoalAllocations(
        ctx.rawDb,
        [{ id: goal1Id }, { id: goal2Id }],
        profileAId,
      );
      expect(result.size).toBe(2);
      expect(result.get(goal1Id)?.monthlyContribution).toBe(150);
      expect(result.get(goal2Id)?.monthlyContribution).toBe(0);
    });

    it("does not leak a profile A row when resolving against profile B", async () => {
      const result = await getResolvedGoalAllocations(
        ctx.rawDb,
        [{ id: goal1Id }],
        profileBId,
      );
      expect(result.get(goal1Id)).toEqual({
        goalId: goal1Id,
        allocationPercent: null,
        monthlyContribution: 0,
      });
    });
  });

  describe("upsertGoalProfileAllocation", () => {
    it("inserts a new row when none exists for the (goal, profile) pair", async () => {
      await upsertGoalProfileAllocation(ctx.rawDb, goal2Id, profileBId, {
        allocationPercent: 25,
        monthlyContribution: 200,
      });
      const result = await getResolvedGoalAllocations(
        ctx.rawDb,
        [{ id: goal2Id }],
        profileBId,
      );
      expect(result.get(goal2Id)).toEqual({
        goalId: goal2Id,
        allocationPercent: 25,
        monthlyContribution: 200,
      });
    });

    it("replaces both fields as a unit on an existing row", async () => {
      // goal1/profileA already has allocationPercent=12.5, monthlyContribution=150
      await upsertGoalProfileAllocation(ctx.rawDb, goal1Id, profileAId, {
        allocationPercent: null,
        monthlyContribution: 75,
      });
      const result = await getResolvedGoalAllocations(
        ctx.rawDb,
        [{ id: goal1Id }],
        profileAId,
      );
      expect(result.get(goal1Id)).toEqual({
        goalId: goal1Id,
        allocationPercent: null,
        monthlyContribution: 75,
      });
    });
  });

  describe("resetProfileAllocationsToZero", () => {
    it("sets every listed goal's funding to $0/no-percent for one profile only", async () => {
      // Give both goals nonzero funding on profile B first.
      await upsertGoalProfileAllocation(ctx.rawDb, goal1Id, profileBId, {
        allocationPercent: 10,
        monthlyContribution: 100,
      });
      await upsertGoalProfileAllocation(ctx.rawDb, goal2Id, profileBId, {
        allocationPercent: 30,
        monthlyContribution: 300,
      });

      await resetProfileAllocationsToZero(
        ctx.rawDb,
        [goal1Id, goal2Id],
        profileBId,
      );

      const resetResult = await getResolvedGoalAllocations(
        ctx.rawDb,
        [{ id: goal1Id }, { id: goal2Id }],
        profileBId,
      );
      expect(resetResult.get(goal1Id)).toEqual({
        goalId: goal1Id,
        allocationPercent: null,
        monthlyContribution: 0,
      });
      expect(resetResult.get(goal2Id)).toEqual({
        goalId: goal2Id,
        allocationPercent: null,
        monthlyContribution: 0,
      });

      // Profile A's rows must be untouched by a reset scoped to profile B.
      const profileAResult = await getResolvedGoalAllocations(
        ctx.rawDb,
        [{ id: goal1Id }],
        profileAId,
      );
      expect(profileAResult.get(goal1Id)?.monthlyContribution).toBe(75);
    });
  });
});
