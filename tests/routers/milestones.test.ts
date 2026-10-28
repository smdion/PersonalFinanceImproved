/**
 * Milestones router integration test — computeInputs maps the year-end
 * history and returns the saved goals/checklist, validated.
 */
import "./setup-mocks";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createTestCaller,
  seedPerson,
  seedJob,
  seedPerformanceAccount,
  seedSnapshot,
  seedAppSetting,
  viewerSession,
} from "./setup";

describe("milestones.computeInputs", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: Awaited<ReturnType<typeof createTestCaller>>["db"];
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller(viewerSession);
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;
    const personId = await seedPerson(db, "Test Person", "1990-01-01");
    seedJob(db, personId);
    const retirement = seedPerformanceAccount(db, {
      accountLabel: "401k",
      institution: "Fidelity",
      accountType: "401k",
    });
    const brokerage = seedPerformanceAccount(db, {
      accountLabel: "Brokerage",
      institution: "Schwab",
      accountType: "brokerage",
      parentCategory: "Portfolio",
    });
    seedSnapshot(db, "2025-01-15", [
      { performanceAccountId: retirement, amount: "100000", taxType: "preTax" },
      { performanceAccountId: brokerage, amount: "50000", taxType: "afterTax" },
    ]);
    seedAppSetting(db, "milestone_checklist", { will: true });
    // Stored before validation existed / hand-edited: read back as empty.
    seedAppSetting(db, "milestone_custom_goals", [{ id: "x" }]);
  });

  afterAll(() => cleanup());

  it("returns the current year with liquid split into retirement and brokerage", async () => {
    const result = await caller.milestones.computeInputs({});
    const current = result.years[result.years.length - 1]!;
    expect(current.isCurrent).toBe(true);
    expect(current.retirement).toBe(100000);
    expect(current.brokerage).toBe(50000);
    expect(current.liquid).toBe(150000 + current.cash);
    expect(current.contributions).toBeNull();
    expect(result.asOfYear).toBe(new Date().getFullYear());
  });

  it("returns the validated checklist and drops unreadable goals", async () => {
    const result = await caller.milestones.computeInputs({});
    expect(result.checklist).toEqual({ will: true });
    expect(result.customGoals).toEqual([]);
  });
});
