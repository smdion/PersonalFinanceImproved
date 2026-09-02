/**
 * Tests for src/lib/pure/savings-projection.ts — the single source of
 * truth for "what will this goal's balance be N months from now."
 *
 * Highest-priority test gap identified by the audit (Pass 41): this module
 * was written specifically to fix a real bug where two independent
 * implementations (savings/page.tsx and savings-goals-card.tsx) silently
 * diverged on the "don't double-count this month's YNAB contribution"
 * guard, and it had zero test coverage despite 6 live call sites depending
 * on it. Covers: monthKey, occurrenceKey, buildSettledOccurrencesSet,
 * projectGoalBalances (including the YNAB double-count guard, allocation
 * overrides, planned-transaction events, recurring expansion, settled
 * exclusion, and per-year allocation adjustment), and isFuturePlannedTx.
 */
import { describe, it, expect } from "vitest";
import {
  monthKey,
  occurrenceKey,
  buildSettledOccurrencesSet,
  projectGoalBalances,
  isFuturePlannedTx,
  computeDerivedPoolByYear,
  type ProjectionGoalInput,
  type PoolGrowthEarner,
} from "@/lib/pure/savings-projection";
import type { PlannedTransaction } from "@/components/savings/types";

function makeGoal(
  overrides: Partial<ProjectionGoalInput> = {},
): ProjectionGoalInput {
  return {
    id: 1,
    current: 1000,
    monthlyAllocation: 100,
    currentMonthBudgeted: null,
    ...overrides,
  };
}

function makeTx(
  overrides: Partial<PlannedTransaction> = {},
): PlannedTransaction {
  return {
    id: 1,
    goalId: 1,
    transactionDate: "2026-03-15",
    description: "Test transaction",
    amount: 50,
    isRecurring: false,
    recurrenceMonths: null,
    ...overrides,
  };
}

describe("monthKey", () => {
  it("formats as YYYY-MM with zero-padded month", () => {
    expect(monthKey(new Date(2026, 0, 1))).toBe("2026-01");
    expect(monthKey(new Date(2026, 8, 15))).toBe("2026-09");
    expect(monthKey(new Date(2026, 11, 31))).toBe("2026-12");
  });
});

describe("occurrenceKey", () => {
  it("joins plannedTxId and occurrenceMonth with a colon", () => {
    expect(occurrenceKey(42, "2026-03")).toBe("42:2026-03");
  });
});

describe("buildSettledOccurrencesSet", () => {
  it("flattens settledOccurrences across multiple transactions", () => {
    const txs: PlannedTransaction[] = [
      makeTx({ id: 1, settledOccurrences: ["2026-01", "2026-02"] }),
      makeTx({ id: 2, settledOccurrences: ["2026-01"] }),
    ];
    const set = buildSettledOccurrencesSet(txs);
    expect(set.has(occurrenceKey(1, "2026-01"))).toBe(true);
    expect(set.has(occurrenceKey(1, "2026-02"))).toBe(true);
    expect(set.has(occurrenceKey(2, "2026-01"))).toBe(true);
    expect(set.has(occurrenceKey(2, "2026-02"))).toBe(false);
  });

  it("handles a transaction with no settledOccurrences", () => {
    const txs: PlannedTransaction[] = [
      makeTx({ settledOccurrences: undefined }),
    ];
    const set = buildSettledOccurrencesSet(txs);
    expect(set.size).toBe(0);
  });
});

describe("projectGoalBalances — basic allocation walk", () => {
  it("accumulates monthlyAllocation month over month with no events", () => {
    const goal = makeGoal({ current: 1000, monthlyAllocation: 100 });
    const result = projectGoalBalances(goal, {
      now: new Date(2026, 2, 1), // March 1, 2026
      projectionMonths: 3,
      plannedTransactions: [],
    });
    expect(result.balances).toEqual([1100, 1200, 1300]);
    expect(result.monthlyAllocations).toEqual([100, 100, 100]);
    expect(result.hasOverride).toEqual([false, false, false]);
    expect(result.monthEvents).toEqual([null, null, null]);
  });

  it("produces monthDates starting at the 1st of now's month", () => {
    const goal = makeGoal();
    const result = projectGoalBalances(goal, {
      now: new Date(2026, 5, 15), // June 15 — day should be ignored
      projectionMonths: 2,
      plannedTransactions: [],
    });
    expect(result.monthDates[0]).toEqual(new Date(2026, 5, 1));
    expect(result.monthDates[1]).toEqual(new Date(2026, 6, 1));
  });
});

// Found live, 2026-09-01: a household assigned September's money to a
// linked category on the morning of the 1st itself. The projection still
// added the full monthly allocation on top of the live (already-funded)
// balance, because the guard inferred "already funded" from the calendar
// date (`now.getDate() > 1`) instead of checking real data — day 1 was
// hardcoded to always mean "not funded yet." Replaced with
// `currentMonthBudgeted`, the linked category's REAL current-month
// budgeted amount, applied as `max(0, allocation - budgeted)` — evidence,
// not a date guess, and additive (handles partial funding) rather than a
// skip/don't-skip binary.
describe("projectGoalBalances — current-month-budgeted double-count fix", () => {
  it("adds nothing for month 0 when the category is already funded at or above the planned allocation, regardless of the date", () => {
    const goal = makeGoal({
      current: 1000, // already includes this month's $100 contribution
      monthlyAllocation: 100,
      currentMonthBudgeted: 100,
    });
    // The 1st of the month itself — the exact case the date heuristic
    // got backwards live. max(0, 100 - 100) = 0.
    const result = projectGoalBalances(goal, {
      now: new Date(2026, 2, 1),
      projectionMonths: 3,
      plannedTransactions: [],
    });
    expect(result.balances).toEqual([1000, 1100, 1200]);
    // monthlyAllocations still reports what WOULD apply, for display —
    // only the running `balance` accounts for what's already funded.
    expect(result.monthlyAllocations).toEqual([100, 100, 100]);
  });

  it("adds only the unfunded remainder when the category is PARTIALLY funded this month", () => {
    const goal = makeGoal({
      current: 1000, // includes $40 of this month's $100 planned contribution
      monthlyAllocation: 100,
      currentMonthBudgeted: 40,
    });
    const result = projectGoalBalances(goal, {
      now: new Date(2026, 2, 1),
      projectionMonths: 2,
      plannedTransactions: [],
    });
    // Month 0: max(0, 100 - 40) = 60 added, not the full 100 (would
    // double-count the $40 already budgeted) and not 0 (would drop the
    // unfunded $60). Month 1: normal full allocation.
    expect(result.balances).toEqual([1060, 1160]);
  });

  it("adds the full allocation when the category has $0 budgeted this month, even though it's API-linked", () => {
    const goal = makeGoal({
      current: 1000,
      monthlyAllocation: 100,
      currentMonthBudgeted: 0,
    });
    const result = projectGoalBalances(goal, {
      now: new Date(2026, 2, 15),
      projectionMonths: 2,
      plannedTransactions: [],
    });
    expect(result.balances).toEqual([1100, 1200]);
  });

  it("adds the full allocation when currentMonthBudgeted is null (not API-linked, or no fresh sync data for this month) — the conservative default, unaffected by the date", () => {
    const nonApiGoal = makeGoal({
      current: 1000,
      monthlyAllocation: 100,
      currentMonthBudgeted: null,
    });
    const result = projectGoalBalances(nonApiGoal, {
      now: new Date(2026, 2, 1), // day 1 — used to matter, must not anymore
      projectionMonths: 2,
      plannedTransactions: [],
    });
    expect(result.balances).toEqual([1100, 1200]);
  });

  it("adds the full allocation when currentMonthBudgeted is undefined (field omitted entirely)", () => {
    const goal = makeGoal({ current: 1000, monthlyAllocation: 100 });
    delete (goal as { currentMonthBudgeted?: number | null })
      .currentMonthBudgeted;
    const result = projectGoalBalances(goal, {
      now: new Date(2026, 2, 1),
      projectionMonths: 1,
      plannedTransactions: [],
    });
    expect(result.balances).toEqual([1100]);
  });

  it("only applies the budgeted adjustment to month 0 — later months always use the full allocation", () => {
    const goal = makeGoal({
      current: 1000,
      monthlyAllocation: 100,
      currentMonthBudgeted: 100, // fully funds month 0 only
    });
    const result = projectGoalBalances(goal, {
      now: new Date(2026, 2, 1),
      projectionMonths: 4,
      plannedTransactions: [],
    });
    expect(result.balances).toEqual([1000, 1100, 1200, 1300]);
  });
});

describe("projectGoalBalances — allocation overrides", () => {
  it("uses the override amount instead of monthlyAllocation for the matching month", () => {
    const goal = makeGoal({ current: 1000, monthlyAllocation: 100 });
    const result = projectGoalBalances(goal, {
      now: new Date(2026, 2, 1),
      projectionMonths: 3,
      plannedTransactions: [],
      allocationOverrides: [
        { goalId: 1, monthDate: "2026-04-01", amount: 500 },
      ],
    });
    // Month 0 (Mar): 100, Month 1 (Apr): 500 (override), Month 2 (May): 100
    expect(result.balances).toEqual([1100, 1600, 1700]);
    expect(result.hasOverride).toEqual([false, true, false]);
    expect(result.monthlyAllocations).toEqual([100, 500, 100]);
  });

  it("ignores overrides for a different goalId", () => {
    const goal = makeGoal({ id: 1, current: 1000, monthlyAllocation: 100 });
    const result = projectGoalBalances(goal, {
      now: new Date(2026, 2, 1),
      projectionMonths: 1,
      plannedTransactions: [],
      allocationOverrides: [
        { goalId: 2, monthDate: "2026-03-01", amount: 9999 },
      ],
    });
    expect(result.balances).toEqual([1100]);
    expect(result.hasOverride).toEqual([false]);
  });
});

describe("projectGoalBalances — planned transaction events", () => {
  it("applies a one-time transaction's amount in its month, alongside the allocation", () => {
    const goal = makeGoal({ current: 1000, monthlyAllocation: 100 });
    const result = projectGoalBalances(goal, {
      now: new Date(2026, 2, 1),
      projectionMonths: 2,
      plannedTransactions: [
        makeTx({
          id: 1,
          goalId: 1,
          transactionDate: "2026-03-10",
          amount: 250,
        }),
      ],
    });
    // Month 0: +100 allocation +250 event = 1350
    expect(result.balances).toEqual([1350, 1450]);
    expect(result.monthEvents[0]).toHaveLength(1);
    expect(result.monthEvents[0]![0]!.amount).toBe(250);
    expect(result.monthEvents[1]).toBeNull();
  });

  it("only includes events for the goal being projected", () => {
    const goal = makeGoal({ id: 1, current: 1000, monthlyAllocation: 100 });
    const result = projectGoalBalances(goal, {
      now: new Date(2026, 2, 1),
      projectionMonths: 1,
      plannedTransactions: [
        makeTx({
          id: 1,
          goalId: 2,
          transactionDate: "2026-03-10",
          amount: 999,
        }),
      ],
    });
    expect(result.balances).toEqual([1100]);
    expect(result.monthEvents[0]).toBeNull();
  });

  it("excludes a settled occurrence from applied events", () => {
    const goal = makeGoal({ current: 1000, monthlyAllocation: 100 });
    const tx = makeTx({
      id: 5,
      goalId: 1,
      transactionDate: "2026-03-10",
      amount: 250,
    });
    const settled = buildSettledOccurrencesSet([
      { ...tx, settledOccurrences: ["2026-03"] },
    ]);
    const result = projectGoalBalances(goal, {
      now: new Date(2026, 2, 1),
      projectionMonths: 1,
      plannedTransactions: [tx],
      settledOccurrences: settled,
    });
    // Event excluded — only the allocation applies.
    expect(result.balances).toEqual([1100]);
    expect(result.monthEvents[0]).toBeNull();
  });

  it("expands a recurring transaction across every eligible month", () => {
    const goal = makeGoal({ current: 0, monthlyAllocation: 0 });
    const result = projectGoalBalances(goal, {
      now: new Date(2026, 0, 1), // Jan 2026
      projectionMonths: 4,
      plannedTransactions: [
        makeTx({
          id: 1,
          goalId: 1,
          transactionDate: "2026-01-15",
          amount: 100,
          isRecurring: true,
          recurrenceMonths: 2,
        }),
      ],
    });
    // First occurrence in Jan (month 0), then every 2 months: Mar (month 2).
    // May (month 4) would be next but projectionMonths=4 only covers
    // indices 0-3 (Jan-Apr), so only Jan and Mar occurrences land.
    expect(result.monthEvents[0]).toHaveLength(1); // Jan
    expect(result.monthEvents[1]).toBeNull(); // Feb
    expect(result.monthEvents[2]).toHaveLength(1); // Mar
    expect(result.monthEvents[3]).toBeNull(); // Apr
    expect(result.balances).toEqual([100, 100, 200, 200]);
  });

  it("does not expand a recurring transaction with recurrenceMonths <= 0", () => {
    const goal = makeGoal({ current: 0, monthlyAllocation: 0 });
    const result = projectGoalBalances(goal, {
      now: new Date(2026, 0, 1),
      projectionMonths: 3,
      plannedTransactions: [
        makeTx({
          id: 1,
          goalId: 1,
          transactionDate: "2026-01-15",
          amount: 100,
          isRecurring: true,
          recurrenceMonths: 0,
        }),
      ],
    });
    expect(result.monthEvents[0]).toHaveLength(1);
    expect(result.monthEvents[1]).toBeNull();
    expect(result.monthEvents[2]).toBeNull();
  });
});

describe("projectGoalBalances — allocationForYear", () => {
  it("applies a custom per-year adjustment to the base allocation", () => {
    const goal = makeGoal({ current: 0, monthlyAllocation: 100 });
    const result = projectGoalBalances(goal, {
      now: new Date(2026, 11, 1), // Dec 2026 — next month crosses into 2027
      projectionMonths: 2,
      plannedTransactions: [],
      allocationForYear: (base, year) => (year === 2027 ? base * 2 : base),
    });
    // Month 0 (Dec 2026): 100. Month 1 (Jan 2027): 200 (doubled).
    expect(result.monthlyAllocations).toEqual([100, 200]);
    expect(result.balances).toEqual([100, 300]);
  });

  it("defaults to identity (no adjustment) when allocationForYear is omitted", () => {
    const goal = makeGoal({ current: 0, monthlyAllocation: 100 });
    const result = projectGoalBalances(goal, {
      now: new Date(2026, 2, 1),
      projectionMonths: 2,
      plannedTransactions: [],
    });
    expect(result.monthlyAllocations).toEqual([100, 100]);
  });
});

describe("isFuturePlannedTx", () => {
  const now = new Date(2026, 2, 15); // March 15, 2026

  it("returns true for a future non-recurring transaction", () => {
    const tx = makeTx({ transactionDate: "2026-04-01", isRecurring: false });
    expect(isFuturePlannedTx(tx, now)).toBe(true);
  });

  it("returns true for a transaction dated today", () => {
    const tx = makeTx({ transactionDate: "2026-03-15", isRecurring: false });
    expect(isFuturePlannedTx(tx, now)).toBe(true);
  });

  it("returns false for a past non-recurring transaction", () => {
    const tx = makeTx({ transactionDate: "2026-02-01", isRecurring: false });
    expect(isFuturePlannedTx(tx, now)).toBe(false);
  });

  it("returns false for a future transaction whose occurrence is already settled", () => {
    const tx = makeTx({
      id: 7,
      transactionDate: "2026-04-01",
      isRecurring: false,
    });
    const settled = new Set([occurrenceKey(7, "2026-04")]);
    expect(isFuturePlannedTx(tx, now, settled)).toBe(false);
  });

  it("returns true for a past recurring transaction whose next occurrence is still upcoming", () => {
    const tx = makeTx({
      transactionDate: "2026-01-01",
      isRecurring: true,
      recurrenceMonths: 2,
    });
    // Occurrences: Jan, Mar, May... Mar 1 < today (Mar 15), so the search
    // continues to May 1, which is >= today.
    expect(isFuturePlannedTx(tx, now)).toBe(true);
  });

  it("returns false for a past recurring transaction whose next occurrence is settled", () => {
    const tx = makeTx({
      id: 9,
      transactionDate: "2026-01-01",
      isRecurring: true,
      recurrenceMonths: 2,
    });
    const settled = new Set([occurrenceKey(9, "2026-05")]);
    expect(isFuturePlannedTx(tx, now, settled)).toBe(false);
  });

  it("returns false for a past non-recurring transaction with isRecurring flags but no recurrenceMonths", () => {
    const tx = makeTx({
      transactionDate: "2026-01-01",
      isRecurring: true,
      recurrenceMonths: null,
    });
    expect(isFuturePlannedTx(tx, now)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// computeDerivedPoolByYear
// ---------------------------------------------------------------------------

function makeEarner(
  overrides: Partial<PoolGrowthEarner> = {},
): PoolGrowthEarner {
  return {
    netPay: 3000,
    periodsPerYear: 26,
    ...overrides,
  };
}

describe("computeDerivedPoolByYear", () => {
  it("seeds startYear directly from maxMonthlyFunding, not a projection", () => {
    const result = computeDerivedPoolByYear([makeEarner()], {
      startYear: 2026,
      projectionYears: 3,
      maxMonthlyFunding: 4500,
      budgetMonthlyTotal: 6000,
    });
    expect(result.get(2026)).toBe(4500);
  });

  it("projects flat pool forward when no raises are stored", () => {
    // netPay 3000 * (26/12 periods) = 6500/mo; minus 6000 budget = 500
    const result = computeDerivedPoolByYear([makeEarner()], {
      startYear: 2026,
      projectionYears: 2,
      maxMonthlyFunding: 4500,
      budgetMonthlyTotal: 6000,
    });
    expect(result.get(2027)).toBeCloseTo(500, 6);
    expect(result.get(2028)).toBeCloseTo(500, 6);
  });

  it("compounds a percent raise onto net pay for the target year and every year after", () => {
    const earner = makeEarner({
      yearlyGrowth: { "2027": { type: "pct", value: 10 } },
    });
    // 3000 * 1.10 * (26/12) = 7150/mo; minus 6000 = 1150
    const result = computeDerivedPoolByYear([earner], {
      startYear: 2026,
      projectionYears: 3,
      maxMonthlyFunding: 4500,
      budgetMonthlyTotal: 6000,
    });
    expect(result.get(2027)).toBeCloseTo(1150, 6);
    expect(result.get(2028)).toBeCloseTo(1150, 6); // raise persists into later years
  });

  it("applies a dollar raise as a flat addition to per-check net pay", () => {
    const earner = makeEarner({
      yearlyGrowth: { "2027": { type: "dollar", value: 100 } },
    });
    // (3000 + 100) * (26/12) = 6716.67/mo; minus 6000 = 716.67
    const result = computeDerivedPoolByYear([earner], {
      startYear: 2026,
      projectionYears: 1,
      maxMonthlyFunding: 4500,
      budgetMonthlyTotal: 6000,
    });
    expect(result.get(2027)).toBeCloseTo(716.6666666667, 6);
  });

  it("ignores a raise entry with value 0", () => {
    const earner = makeEarner({
      yearlyGrowth: { "2027": { type: "pct", value: 0 } },
    });
    const result = computeDerivedPoolByYear([earner], {
      startYear: 2026,
      projectionYears: 1,
      maxMonthlyFunding: 4500,
      budgetMonthlyTotal: 6000,
    });
    expect(result.get(2027)).toBeCloseTo(500, 6);
  });

  it("prefers budgetPerMonth over periodsPerYear/12 when present", () => {
    const earner = makeEarner({ periodsPerYear: 26, budgetPerMonth: 2 });
    // 3000 * 2 = 6000/mo; minus 6000 = 0
    const result = computeDerivedPoolByYear([earner], {
      startYear: 2026,
      projectionYears: 1,
      maxMonthlyFunding: 4500,
      budgetMonthlyTotal: 6000,
    });
    expect(result.get(2027)).toBe(0);
  });

  it("clamps a negative projected pool to 0", () => {
    const result = computeDerivedPoolByYear([makeEarner({ netPay: 100 })], {
      startYear: 2026,
      projectionYears: 1,
      maxMonthlyFunding: 4500,
      budgetMonthlyTotal: 6000,
    });
    expect(result.get(2027)).toBe(0);
  });

  it("sums across multiple earners with independent raise schedules", () => {
    const earners = [
      makeEarner({
        netPay: 3000,
        periodsPerYear: 26,
        yearlyGrowth: { "2027": { type: "pct", value: 10 } },
      }),
      makeEarner({ netPay: 2200, periodsPerYear: 24 }),
    ];
    // Earner 1: 3300 * (26/12) = 7150; Earner 2: 2200 * (24/12) = 4400
    // Total 11550 - 6000 = 5550
    const result = computeDerivedPoolByYear(earners, {
      startYear: 2026,
      projectionYears: 1,
      maxMonthlyFunding: 4500,
      budgetMonthlyTotal: 6000,
    });
    expect(result.get(2027)).toBeCloseTo(5550, 6);
  });

  it("returns only startYear when projectionYears is 0", () => {
    const result = computeDerivedPoolByYear([makeEarner()], {
      startYear: 2026,
      projectionYears: 0,
      maxMonthlyFunding: 4500,
      budgetMonthlyTotal: 6000,
    });
    expect(result.size).toBe(1);
    expect(result.get(2026)).toBe(4500);
  });
});
