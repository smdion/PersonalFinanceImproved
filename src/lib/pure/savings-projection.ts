/**
 * Sinking-fund balance projection — single source of truth for "what will
 * this goal's balance be N months from now."
 *
 * Previously this walk was implemented independently in two places
 * (src/app/(dashboard)/savings/page.tsx and
 * src/components/cards/dashboard/savings-goals-card.tsx), which had already
 * diverged: the dashboard card's copy never applied the "don't double-count
 * this month's contribution for YNAB-linked goals" guard the page's copy
 * has. Both now call this module instead of reimplementing the walk.
 */
import type { PlannedTransaction } from "@/components/savings/types";

export interface ProjectionGoalInput {
  id: number;
  current: number;
  monthlyAllocation: number;
  /**
   * The linked category's ACTUAL current-month `budgeted` amount (real
   * money assigned in YNAB/Actual this month), or `null` when unknown
   * (not API-linked, or no fresh-enough sync data — see the server's
   * `currentMonthBudgetedMap`, `savings.ts`, for how this is resolved
   * and why a stale/wrong-month value is never passed here instead of
   * `null`).
   *
   * Replaces a former `isApiSyncEnabled`/`apiCategoryId` + `now.getDate()
   * > 1` date heuristic (found live, 2026-09-01: a household that
   * assigned September's money on the 1st itself broke the heuristic's
   * assumption that day-1 can never already be funded, double-counting
   * the contribution). `budgeted` is real evidence instead of a guess —
   * see `projectGoalBalances`' own docblock for the math.
   */
  currentMonthBudgeted?: number | null;
}

export interface AllocationOverride {
  goalId: number;
  monthDate: string;
  amount: number;
}

export interface MonthEventOut {
  /** `${plannedTxId}:${occurrenceMonth}` — stable across re-renders, unlike the
   *  old sequential `ev-${n}` id, and usable directly as a React key. */
  id: string;
  /** Row + occurrence identity — settle actions target this pair. */
  plannedTxId: number;
  occurrenceMonth: string;
  amount: number;
  description: string;
}

export interface SavingsProjectionResult {
  monthDates: Date[];
  balances: number[];
  monthEvents: (MonthEventOut[] | null)[];
  monthlyAllocations: number[];
  hasOverride: boolean[];
}

export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** `${plannedTxId}:${occurrenceMonth}` — the key settled occurrences are tracked by. */
export function occurrenceKey(
  plannedTxId: number,
  occurrenceMonth: string,
): string {
  return `${plannedTxId}:${occurrenceMonth}`;
}

/** Flattens each row's `settledOccurrences` (from computeSummary) into the
 *  single Set both `projectGoalBalances` and `isFuturePlannedTx` expect. */
export function buildSettledOccurrencesSet(
  plannedTransactions: PlannedTransaction[],
): Set<string> {
  const set = new Set<string>();
  for (const tx of plannedTransactions) {
    for (const mk of tx.settledOccurrences ?? []) {
      set.add(occurrenceKey(tx.id, mk));
    }
  }
  return set;
}

/**
 * Expands planned transactions (including recurring ones) into per-goal,
 * per-month events, dropping any occurrence present in `settledOccurrences`.
 */
function expandPlannedTransactions(
  plannedTransactions: PlannedTransaction[],
  monthDates: Date[],
  settledOccurrences: Set<string>,
): Map<number, Map<string, MonthEventOut[]>> {
  const txByGoalMonth = new Map<number, Map<string, MonthEventOut[]>>();
  const lastMonth = monthDates[monthDates.length - 1];
  if (!lastMonth) return txByGoalMonth;

  const addEntry = (
    goalId: number,
    plannedTxId: number,
    mk: string,
    amount: number,
    desc: string,
  ) => {
    if (settledOccurrences.has(occurrenceKey(plannedTxId, mk))) return;
    if (!txByGoalMonth.has(goalId)) txByGoalMonth.set(goalId, new Map());
    const m = txByGoalMonth.get(goalId)!;
    if (!m.has(mk)) m.set(mk, []);
    m.get(mk)!.push({
      id: occurrenceKey(plannedTxId, mk),
      plannedTxId,
      occurrenceMonth: mk,
      amount,
      description: desc,
    });
  };

  for (const tx of plannedTransactions) {
    const txDate = new Date(tx.transactionDate + "T00:00:00");
    addEntry(tx.goalId, tx.id, monthKey(txDate), tx.amount, tx.description);
    if (tx.isRecurring && tx.recurrenceMonths && tx.recurrenceMonths > 0) {
      let d = new Date(
        txDate.getFullYear(),
        txDate.getMonth() + tx.recurrenceMonths,
        1,
      );
      while (d <= lastMonth) {
        addEntry(tx.goalId, tx.id, monthKey(d), tx.amount, tx.description);
        d = new Date(d.getFullYear(), d.getMonth() + tx.recurrenceMonths, 1);
      }
    }
  }
  return txByGoalMonth;
}

export interface ProjectGoalBalancesOptions {
  now: Date;
  projectionMonths: number;
  plannedTransactions: PlannedTransaction[];
  allocationOverrides?: AllocationOverride[];
  settledOccurrences?: Set<string>;
  /** Optional per-year allocation adjustment (e.g. projected raises). Defaults to identity. */
  allocationForYear?: (baseAmount: number, year: number) => number;
}

/**
 * Walks `projectionMonths` months forward from `now` for a single goal,
 * folding in that goal's planned-transaction events and allocation
 * overrides.
 *
 * Month 0 (the current month) is special for API-linked goals: `current`
 * is a LIVE balance, which may already reflect part or all of this
 * month's planned contribution if the household already assigned money
 * to the linked category. Adding the full `allocation` unconditionally
 * would double-count whatever's already there.
 *
 * Previously this was inferred from the calendar date (`now.getDate() >
 * 1` — "day 1 can't possibly be funded yet, day 2+ always already is").
 * That heuristic broke live, 2026-09-01: a household that assigned
 * September's money on the morning of the 1st itself had it double-
 * counted, because the heuristic assumed day 1 could never be funded.
 * Fixed by using `goal.currentMonthBudgeted` — the category's REAL
 * current-month budgeted amount — as actual evidence instead of a guess:
 *
 *   balance += max(0, allocation - currentMonthBudgeted)
 *
 * This is the arithmetically correct step, not a skip/don't-skip binary:
 * `balance` is structurally `carryover + budgeted − activity` on both
 * YNAB and Actual, so `budgeted` is already INSIDE `current` — the
 * projection only needs to add whatever portion of this month's
 * allocation ISN'T already budgeted. A household that partially funds a
 * category mid-month is handled correctly (adds the remainder), not just
 * the fully-funded/not-funded cases a binary skip would cover. When
 * `currentMonthBudgeted` is `null` (not API-linked, or no fresh sync
 * data for this month), the full `allocation` is added — the same
 * conservative default as before. Planned-transaction events (settled or
 * not yet settled) always apply in every month they fall in, unaffected
 * by any of this.
 */
export function projectGoalBalances(
  goal: ProjectionGoalInput,
  options: ProjectGoalBalancesOptions,
): SavingsProjectionResult {
  const {
    now,
    projectionMonths,
    plannedTransactions,
    allocationOverrides = [],
    settledOccurrences = new Set<string>(),
    allocationForYear = (base: number) => base,
  } = options;

  const monthDates: Date[] = [];
  for (let i = 0; i < projectionMonths; i++) {
    monthDates.push(new Date(now.getFullYear(), now.getMonth() + i, 1));
  }

  const goalTx = plannedTransactions.filter((t) => t.goalId === goal.id);
  const txByMonth = expandPlannedTransactions(
    goalTx,
    monthDates,
    settledOccurrences,
  ).get(goal.id);

  const overrideMap = new Map<string, number>();
  for (const o of allocationOverrides) {
    if (o.goalId !== goal.id) continue;
    const d = new Date(o.monthDate + "T00:00:00");
    overrideMap.set(monthKey(d), o.amount);
  }

  const balances: number[] = [];
  const monthEvents: (MonthEventOut[] | null)[] = [];
  const monthlyAllocations: number[] = [];
  const hasOverride: boolean[] = [];
  let balance = goal.current;

  for (let i = 0; i < projectionMonths; i++) {
    const mk = monthKey(monthDates[i]!);
    const events = txByMonth?.get(mk) ?? null;
    const overrideAmount = overrideMap.get(mk);
    const yr = monthDates[i]!.getFullYear();
    const defaultAllocation = allocationForYear(goal.monthlyAllocation, yr);
    const allocation =
      overrideAmount !== undefined ? overrideAmount : defaultAllocation;
    if (i === 0 && goal.currentMonthBudgeted != null) {
      // Real evidence, not a date guess — see this function's own
      // docblock for why this is `max(0, allocation - budgeted)`, not a
      // binary skip.
      balance += Math.max(0, allocation - goal.currentMonthBudgeted);
    } else {
      balance += allocation;
    }
    if (events) {
      for (const ev of events) balance += ev.amount;
    }
    balances.push(balance);
    monthEvents.push(events);
    monthlyAllocations.push(allocation);
    hasOverride.push(overrideAmount !== undefined);
  }

  return { monthDates, balances, monthEvents, monthlyAllocations, hasOverride };
}

/**
 * Is this planned transaction (or, for recurring rows, at least one future
 * occurrence of it) still upcoming and unsettled as of `now`? Single shared
 * predicate for the "upcoming" list filters that were previously re-cut
 * independently (with different date-truncation semantics) in
 * all-transactions-tab.tsx, planned-events-tab.tsx, upcoming-goals.tsx, and
 * fund-card.tsx.
 */
export function isFuturePlannedTx(
  tx: PlannedTransaction,
  now: Date,
  settledOccurrences: Set<string> = new Set(),
): boolean {
  const txDate = new Date(tx.transactionDate + "T00:00:00");
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (txDate >= today) {
    return !settledOccurrences.has(occurrenceKey(tx.id, monthKey(txDate)));
  }
  if (tx.isRecurring && tx.recurrenceMonths && tx.recurrenceMonths > 0) {
    let d = new Date(
      txDate.getFullYear(),
      txDate.getMonth() + tx.recurrenceMonths,
      1,
    );
    // Cap the search — a row recurring monthly/annually will hit `today`
    // within a few iterations; this bounds pathological recurrenceMonths=1
    // rows against a huge now-txDate gap.
    for (let i = 0; i < 600 && d < today; i++) {
      d = new Date(d.getFullYear(), d.getMonth() + tx.recurrenceMonths, 1);
    }
    if (d >= today) {
      return !settledOccurrences.has(occurrenceKey(tx.id, monthKey(d)));
    }
  }
  return false;
}

/** Per-earner inputs for computeDerivedPoolByYear. */
export interface PoolGrowthEarner {
  netPay: number;
  /** Regular pay periods per month — used only when budgetPerMonth is absent. */
  periodsPerYear: number;
  /** Regular-checks-only periods per month (extra biweekly checks route
   *  separately, not budget income) — preferred over periodsPerYear/12 when present. */
  budgetPerMonth?: number;
  /** Year (as a string key, e.g. "2027") → stored raise for that year. */
  yearlyGrowth?: Record<string, { type: "pct" | "dollar"; value: number }>;
}

/**
 * Projects the monthly savings pool forward across years by applying each
 * earner's stored raise rates to their current net pay, holding budget
 * expenses flat. Was implemented inline in savings/page.tsx, right next to
 * projectGoalBalances — the one calculation on this page that hadn't
 * followed the same "pure function, not page-local" pattern.
 *
 * Year `startYear` is seeded directly from `maxMonthlyFunding` (today's
 * actual computed pool, not a projection); each subsequent year compounds
 * the previous year's raises onto every earner's current net pay.
 */
export function computeDerivedPoolByYear(
  earners: PoolGrowthEarner[],
  params: {
    startYear: number;
    projectionYears: number;
    maxMonthlyFunding: number;
    budgetMonthlyTotal: number;
  },
): Map<number, number> {
  const { startYear, projectionYears, maxMonthlyFunding, budgetMonthlyTotal } =
    params;
  const derivedPoolByYear = new Map<number, number>();
  derivedPoolByYear.set(startYear, maxMonthlyFunding);

  for (let yr = startYear + 1; yr <= startYear + projectionYears; yr++) {
    let projectedMonthlyNet = 0;
    for (const earner of earners) {
      const perMonth = earner.budgetPerMonth ?? earner.periodsPerYear / 12;
      const raises = earner.yearlyGrowth ?? {};
      let netPerCheck = earner.netPay;
      for (let y = startYear + 1; y <= yr; y++) {
        const e = raises[String(y)];
        if (!e || e.value === 0) continue;
        netPerCheck =
          e.type === "pct"
            ? netPerCheck * (1 + e.value / 100)
            : netPerCheck + e.value;
      }
      projectedMonthlyNet += netPerCheck * perMonth;
    }
    derivedPoolByYear.set(
      yr,
      Math.max(0, projectedMonthlyNet - budgetMonthlyTotal),
    );
  }

  return derivedPoolByYear;
}
