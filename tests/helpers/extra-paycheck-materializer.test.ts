/**
 * Extra-paycheck materializer tests.
 *
 * Covers the delete/reinsert regeneration cycle in
 * src/server/helpers/extra-paycheck-materializer.ts — specifically that it
 * no longer destroys history (rows before the current month) or orphans
 * settlement records (rows with any row in savings_planned_tx_settlements),
 * both of which the original blanket "delete all source='rule' rows" did.
 *
 * getExtraPaycheckMonthKeys (the biweekly-3-paycheck-month detector) is
 * mocked out here — its own correctness is covered by paycheck.test.ts.
 * This file is only exercising the materializer's transaction logic.
 */
import "./setup-mocks";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestDb, type TestDbContext } from "./db-harness";
import { materializeExtraPaycheckOverrides } from "@/server/helpers/extra-paycheck-materializer";
import { eq } from "drizzle-orm";

const mockGetExtraPaycheckMonthKeys = vi.fn();
vi.mock("@/lib/calculators/paycheck", () => ({
  getExtraPaycheckMonthKeys: (...args: unknown[]) =>
    mockGetExtraPaycheckMonthKeys(...args),
}));

describe("materializeExtraPaycheckOverrides", () => {
  let ctx: TestDbContext;
  let goalId: number;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T00:00:00Z"));
    mockGetExtraPaycheckMonthKeys.mockReturnValue(["2026-06-01", "2026-07-01"]);

    ctx = await createTestDb();
    ctx.db
      .insert(ctx.schema.people)
      .values({
        id: 1,
        name: "Test",
        dateOfBirth: "1990-01-01",
        isPrimaryUser: true,
      })
      .run();
    const [goal] = ctx.db
      .insert(ctx.schema.savingsGoals)
      .values({ name: "Travel", isActive: true })
      .returning()
      .all();
    goalId = goal!.id;
    ctx.db
      .insert(ctx.schema.jobs)
      .values({
        id: 1,
        personId: 1,
        employerName: "TestCo",
        annualSalary: "100000",
        payPeriod: "biweekly",
        payWeek: "even",
        startDate: "2020-01-01",
        w4FilingStatus: "MFJ",
        anchorPayDate: "2026-01-02",
        extraPaycheckRouting: {
          rules: [
            {
              from: "2026-01",
              to: null,
              splits: [{ goalId, pct: 100 }],
              netPaySnapshot: 1000,
            },
          ],
        },
      })
      .run();
  });

  afterEach(() => {
    ctx.cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  function ruleRows() {
    return ctx.db
      .select()
      .from(ctx.schema.savingsPlannedTransactions)
      .where(eq(ctx.schema.savingsPlannedTransactions.source, "rule"))
      .all();
  }

  it("materializes rows for the desired months", async () => {
    await materializeExtraPaycheckOverrides(ctx.db as never);
    const rows = ruleRows();
    expect(rows.map((r) => r.transactionDate).sort()).toEqual([
      "2026-06-01",
      "2026-07-01",
    ]);
    expect(Number(rows[0]!.amount)).toBe(1000);
  });

  it("preserves a rule row dated before the current month across regeneration", async () => {
    // Simulate a historical row that predates this fix — the old blanket
    // delete would have wiped this on the very next materialize call.
    ctx.db
      .insert(ctx.schema.savingsPlannedTransactions)
      .values({
        goalId,
        transactionDate: "2026-01-01",
        amount: "1000",
        description: "Test",
        source: "rule",
      })
      .run();

    await materializeExtraPaycheckOverrides(ctx.db as never);

    const rows = ruleRows();
    const jan = rows.find((r) => r.transactionDate === "2026-01-01");
    expect(jan).toBeDefined();
  });

  it("preserves a settled current-month row instead of duplicating it", async () => {
    await materializeExtraPaycheckOverrides(ctx.db as never);
    const juneRow = ruleRows().find((r) => r.transactionDate === "2026-06-01");
    expect(juneRow).toBeDefined();

    ctx.db
      .insert(ctx.schema.savingsPlannedTxSettlements)
      .values({ plannedTxId: juneRow!.id, occurrenceMonth: "2026-06-01" })
      .run();

    // Change what the routing would generate for June, to prove the
    // preserved row keeps its original amount rather than being
    // regenerated with the new one.
    ctx.db
      .update(ctx.schema.jobs)
      .set({
        extraPaycheckRouting: {
          rules: [
            {
              from: "2026-01",
              to: null,
              splits: [{ goalId, pct: 100 }],
              netPaySnapshot: 5000,
            },
          ],
        },
      })
      .where(eq(ctx.schema.jobs.id, 1))
      .run();

    await materializeExtraPaycheckOverrides(ctx.db as never);

    const juneRows = ruleRows().filter(
      (r) => r.transactionDate === "2026-06-01",
    );
    // Exactly one row for June — no duplicate inserted alongside the
    // preserved, settled one.
    expect(juneRows).toHaveLength(1);
    expect(juneRows[0]!.id).toBe(juneRow!.id);
    expect(Number(juneRows[0]!.amount)).toBe(1000); // unchanged, not regenerated to 5000

    // July had no settlement, so it should have regenerated with the new amount.
    const julyRow = ruleRows().find((r) => r.transactionDate === "2026-07-01");
    expect(Number(julyRow!.amount)).toBe(5000);
  });

  it("a settlement on a rule row survives regeneration (not cascade-deleted)", async () => {
    await materializeExtraPaycheckOverrides(ctx.db as never);
    const juneRow = ruleRows().find((r) => r.transactionDate === "2026-06-01");
    ctx.db
      .insert(ctx.schema.savingsPlannedTxSettlements)
      .values({ plannedTxId: juneRow!.id, occurrenceMonth: "2026-06-01" })
      .run();

    await materializeExtraPaycheckOverrides(ctx.db as never);
    await materializeExtraPaycheckOverrides(ctx.db as never);

    const settlements = ctx.db
      .select()
      .from(ctx.schema.savingsPlannedTxSettlements)
      .all();
    expect(settlements).toHaveLength(1);
    expect(settlements[0]!.plannedTxId).toBe(juneRow!.id);
  });
});
