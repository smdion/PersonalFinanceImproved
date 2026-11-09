/**
 * Sinking-fund balance projection: the one source for "what will this goal's balance be N months
 * from now".
 */

/** A savings goal's planned-transaction row; recurring rows repeat
 *  every `recurrenceMonths`. */
export interface PlannedTransaction {
  id: number;
  goalId: number;
  transactionDate: string;
  description: string;
  amount: number;
  isRecurring: boolean;
  recurrenceMonths: number | null;
  transferPairId?: string | null;
  source?: string;
  /** Occurrence months ("YYYY-MM") already settled for this row. */
  settledOccurrences?: string[];
}

export interface ProjectionGoalInput {
  id: number;
  current: number;
  monthlyAllocation: number;
  /**
   * The linked category's actual current-month `budgeted` amount, or `null` when unknown (not
   * API-linked, or no fresh sync for this month; see `currentMonthBudgetedMap` in `savings.ts`).
   */
  currentMonthBudgeted?: number | null;
}

interface AllocationOverride {
  goalId: number;
  monthDate: string;
  amount: number;
}

interface MonthEventOut {
  /** `${plannedTxId}:${occurrenceMonth}` — stable across re-renders, unlike the
   *  old sequential `ev-${n}` id, and usable directly as a React key. */
  id: string;
  /** Row + occurrence identity — settle actions target this pair. */
  plannedTxId: number;
  occurrenceMonth: string;
  amount: number;
  description: string;
}

interface SavingsProjectionResult {
  monthDates: Date[];
  balances: number[];
  monthEvents: (MonthEventOut[] | null)[];
  monthlyAllocations: number[];
  hasOverride: boolean[];
}

/** `YYYY-MM`: the savings projection's month key, and the savings UI's.
 *  Not `lib/utils/date-keys`' `monthKey` (`YYYY-MM-01`, the budget-API key). */
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

interface ProjectGoalBalancesOptions {
  now: Date;
  projectionMonths: number;
  plannedTransactions: PlannedTransaction[];
  allocationOverrides?: AllocationOverride[];
  settledOccurrences?: Set<string>;
  /** Optional per-year allocation adjustment (e.g. projected raises). Defaults to identity. */
  allocationForYear?: (baseAmount: number, year: number) => number;
}

/**
 * Walks `projectionMonths` months from `now` for one goal with its planned events and allocation
 * overrides. Month 0 adds max(0, allocation - currentMonthBudgeted) since a live balance already
 * holds what's budgeted (full allocation when null); planned events apply every month they fall in.
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
    const year = monthDates[i]!.getFullYear();
    const defaultAllocation = allocationForYear(goal.monthlyAllocation, year);
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

/** @internal Only tests import it (knip --production).
 * Whether this planned transaction (or, if recurring, a future occurrence) is still upcoming and
 * unsettled as of `now`: the one predicate for every "upcoming" list.
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
 * The monthly savings pool by year: `startYear` is today's `maxMonthlyFunding`; each later year
 * compounds every earner's stored raise rates onto current net pay, budget expenses held flat.
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

  for (let year = startYear + 1; year <= startYear + projectionYears; year++) {
    let projectedMonthlyNet = 0;
    for (const earner of earners) {
      const perMonth = earner.budgetPerMonth ?? earner.periodsPerYear / 12;
      const raises = earner.yearlyGrowth ?? {};
      let netPerCheck = earner.netPay;
      for (let y = startYear + 1; y <= year; y++) {
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
      year,
      Math.max(0, projectedMonthlyNet - budgetMonthlyTotal),
    );
  }

  return derivedPoolByYear;
}
