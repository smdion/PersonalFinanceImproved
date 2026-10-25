/**
 * Utilities cost feed: a month's utility cost from the synced budget's
 * transactions (YNAB or Actual — the normalized BudgetTransaction shape, so
 * nothing here is service-specific). Plan: .scratch/docs/plans/
 * UTILITIES-COST-FEED-PLAN.md §5.
 *
 * - A transaction (or a part of a split) counts toward a service when its
 *   category is the one that service is mapped to. Outflows only.
 * - Bills are paid after the month they cover: the service month is the
 *   payment month minus the service's billing lag.
 * - Cost only — usage is never set (the budget has no meter readings).
 * - Never overwrites a cost someone else wrote: it fills empty months and
 *   refreshes the months the same budget service wrote; a different
 *   recorded cost from anyone else is returned as a conflict to review.
 */
import type { BudgetTransaction } from "@/lib/budget-api/types";
import type { UtilitySource } from "@/lib/config/enum-values";
import { roundToCents } from "@/lib/utils/math";

export type FeedService = {
  serviceId: number;
  /** The budget category this service is fed from. */
  categoryId: string;
  /** Months between the service month and the payment (≥ 0). */
  billingLagMonths: number;
};

export type ExistingReading = {
  serviceId: number;
  year: number;
  month: number;
  cost: number;
  source: UtilitySource | null;
};

export type FeedMonth = {
  serviceId: number;
  year: number;
  month: number;
  cost: number;
};

export type FeedChange = FeedMonth & {
  /** The cost recorded now; null when the month has no reading. */
  previous: number | null;
};

export type FeedConflict = FeedMonth & {
  previous: number;
  /** Who wrote the recorded cost (null = before sources were tracked,
   *  treated as typed in). */
  previousSource: UtilitySource | null;
};

/** `month` (1–12) shifted back `lag` months, across year boundaries. */
export function serviceMonth(
  year: number,
  month: number,
  lag: number,
): { year: number; month: number } {
  const index = year * 12 + (month - 1) - lag;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/** Cost per service per service month, from the budget's transactions. */
export function feedMonths(
  transactions: readonly BudgetTransaction[],
  services: readonly FeedService[],
): FeedMonth[] {
  const byCategory = new Map(services.map((s) => [s.categoryId, s]));
  const totals = new Map<string, FeedMonth>();
  const add = (categoryId: string | null, amount: number, date: string) => {
    const service = categoryId ? byCategory.get(categoryId) : undefined;
    if (!service || amount >= 0) return;
    const [y, m] = date.split("-").map(Number) as [number, number];
    const when = serviceMonth(y, m, service.billingLagMonths);
    const key = `${service.serviceId}:${when.year}:${when.month}`;
    const row = totals.get(key) ?? {
      serviceId: service.serviceId,
      ...when,
      cost: 0,
    };
    row.cost += -amount;
    totals.set(key, row);
  };
  for (const t of transactions) {
    if (t.deleted) continue;
    // A split parent's own category counts only when it has one (Actual
    // keeps the parent's; YNAB's parent is "Split"); its parts each count.
    if (!t.subtransactions?.length) add(t.categoryId, t.amount, t.date);
    for (const part of t.subtransactions ?? [])
      add(part.categoryId, part.amount, t.date);
  }
  return [...totals.values()].map((r) => ({
    ...r,
    cost: roundToCents(r.cost),
  }));
}

/** What a pull would write, and what it leaves for review. */
export function reconcileFeed(
  months: readonly FeedMonth[],
  existing: readonly ExistingReading[],
  /** The budget service the months came from. */
  source: UtilitySource,
): { changes: FeedChange[]; conflicts: FeedConflict[] } {
  const recorded = new Map(
    existing.map((r) => [`${r.serviceId}:${r.year}:${r.month}`, r]),
  );
  const changes: FeedChange[] = [];
  const conflicts: FeedConflict[] = [];
  for (const m of months) {
    const r = recorded.get(`${m.serviceId}:${m.year}:${m.month}`);
    if (!r) changes.push({ ...m, previous: null });
    else if (r.cost === m.cost) continue;
    else if (r.source === source) changes.push({ ...m, previous: r.cost });
    else conflicts.push({ ...m, previous: r.cost, previousSource: r.source });
  }
  return { changes, conflicts };
}
