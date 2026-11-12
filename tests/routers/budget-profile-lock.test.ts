/**
 * A write sized by a budget profile's columns (an item, a column added or
 * removed, a savings goal turned into an item) reads the profile under its
 * row lock, the one column edits take, so concurrent writes keep one amount
 * per column (FOR UPDATE on PostgreSQL; SQLite's transactions are serial).
 */
import "./setup-mocks";
import { describe, it, expect, vi } from "vitest";
import {
  createTestCaller,
  seedSavingsGoal,
  seedStandardDataset,
} from "./setup";
import * as sqlite from "@/lib/db/schema-sqlite";
import * as schema from "@/lib/db/schema";

const locked = vi.hoisted(() => vi.fn());
vi.mock("@/server/data/lock-row", async (orig) => {
  const real = await orig<typeof import("@/server/data/lock-row")>();
  return {
    ...real,
    lockedRow: (...args: Parameters<typeof real.lockedRow>) => {
      locked(args[1], args[2]);
      return real.lockedRow(...args);
    },
  };
});

describe("budget profile row lock", () => {
  it("addColumn, createItem, removeColumn and convertGoalToBudgetItem read the profile under its row lock", async () => {
    const { caller, db, cleanup } = await createTestCaller();
    try {
      seedStandardDataset(db);
      const [profile] = db.select().from(sqlite.budgetProfiles).all();
      const id = profile!.id;
      await caller.budget.addColumn({ label: "Invented", profileId: id });
      await caller.budget.createItem({
        category: "Invented",
        subcategory: "Item",
        profileId: id,
      });
      await caller.budget.removeColumn({ colIndex: 1, profileId: id });
      const goalId = seedSavingsGoal(db, {
        name: "Invented goal",
        targetAmount: "1000",
      });
      await caller.savings.convertGoalToBudgetItem({
        goalId,
        category: "Invented",
        subcategory: "From goal",
        profileId: id,
      });
      const profileLocks = locked.mock.calls.filter(
        ([table]) => table === schema.budgetProfiles,
      );
      expect(profileLocks.map(([, lockedId]) => lockedId)).toEqual([
        id,
        id,
        id,
        id,
      ]);
      for (const item of db.select().from(sqlite.budgetItems).all())
        expect(item.amounts).toHaveLength(1);
    } finally {
      cleanup();
    }
  });
});
