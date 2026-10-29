/**
 * Milestones router integration test — computeInputs maps the year-end
 * history and returns the saved goals/checklist, validated.
 */
import "./setup-mocks";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as schema from "@/lib/db/schema-sqlite";
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
    // Two finalized years with a raise between them; this year's row (not
    // finalized, and the current year) never counts.
    const thisYear = new Date().getFullYear();
    for (const [year, salary] of [
      [thisYear - 2, 100_000],
      [thisYear - 1, 110_000],
      [thisYear, 150_000],
    ] as const)
      db.insert(schema.historicalSalaries)
        .values({ personId, year, salary: String(salary) })
        .run();
    for (const [year, total, employer, finalized] of [
      [thisYear - 2, 25_000, 5_000, true],
      [thisYear - 1, 32_000, 5_000, true],
      [thisYear, 40_000, 5_000, false],
    ] as const)
      db.insert(schema.accountPerformance)
        .values({
          year,
          institution: "Fidelity",
          accountLabel: "401k",
          ownerPersonId: personId,
          parentCategory: "Retirement",
          performanceAccountId: retirement,
          beginningBalance: "0",
          totalContributions: String(total),
          employerContributions: String(employer),
          yearlyGainLoss: "0",
          endingBalance: "0",
          isFinalized: finalized,
        })
        .run();
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

  it("returns each raise: own contributions (employer money out) against salary, past finalized years only", async () => {
    const result = await caller.milestones.computeInputs({});
    const thisYear = new Date().getFullYear();
    expect(result.raises).toEqual([
      {
        year: thisYear - 1,
        raise: 10_000,
        savingChange: 7_000,
        share: 0.7,
        estimated: false,
      },
    ]);
  });

  it("returns the validated checklist and drops unreadable goals", async () => {
    const result = await caller.milestones.computeInputs({});
    expect(result.checklist).toEqual({ will: true });
    expect(result.customGoals).toEqual([]);
  });
});
