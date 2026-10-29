/**
 * Utilities cost feed: a month's utility cost from the synced budget's
 * transactions (YNAB or Actual — the normalized BudgetTransaction shape, so
 * nothing here is service-specific).
 *
 * - A transaction (or a part of a split) counts toward a service when its
 *   category is the one that service is mapped to. A month's cost is its
 *   bills less any refunds or credits (the category's own net spend); a
 *   month that nets to a credit isn't written.
 * - Bills are paid after the month they cover: the service month is the
 *   payment month minus the service's billing lag.
 * - Cost only — usage is never set (the budget has no meter readings).
 * - Never overwrites a cost someone else wrote: it fills empty months and
 *   refreshes the months the same budget service wrote; a different
 *   recorded cost from anyone else is returned as a conflict to review.
 *
 * Every month is whole only because the sync fetches from 1 January of
 * the previous year (sync/core.ts) — a rolling start date would make the
 * first payment month partial.
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

type ExistingReading = {
  serviceId: number;
  year: number;
  month: number;
  cost: number;
  source: UtilitySource | null;
};

type FeedMonth = {
  serviceId: number;
  year: number;
  month: number;
  cost: number;
  /** Bills paid toward the month — more than one usually means a bill
   *  paid early or late landed in the wrong month. */
  payments: number;
};

type FeedChange = FeedMonth & {
  /** The cost recorded now; null when the month has no reading. */
  previous: number | null;
};

type FeedConflict = FeedMonth & {
  previous: number;
  /** Who wrote the recorded cost (null = before sources were tracked,
   *  treated as typed in). */
  previousSource: UtilitySource | null;
};

/** Two costs are the same to the cent. */
export function sameCost(a: number, b: number): boolean {
  return Math.round(a * 100) === Math.round(b * 100);
}

/** `month` (1–12) shifted back `lag` months, across year boundaries. */
export function serviceMonth(
  year: number,
  month: number,
  lag: number,
): { year: number; month: number } {
  const index = year * 12 + (month - 1) - lag;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/** Net cost per service per service month, from the budget's
 *  transactions (a month that nets to a credit has cost ≤ 0). Throws when
 *  two services are mapped to one category. */
export function feedMonths(
  transactions: readonly BudgetTransaction[],
  services: readonly FeedService[],
): FeedMonth[] {
  const byCategory = new Map<string, FeedService>();
  for (const s of services) {
    if (byCategory.has(s.categoryId))
      throw new Error(
        `Two utilities are fed from one budget category (${s.categoryId})`,
      );
    byCategory.set(s.categoryId, s);
  }
  const totals = new Map<string, FeedMonth>();
  const add = (categoryId: string | null, amount: number, date: string) => {
    const service = categoryId ? byCategory.get(categoryId) : undefined;
    if (!service) return;
    const [y, m] = date.split("-").map(Number) as [number, number];
    const when = serviceMonth(y, m, service.billingLagMonths);
    const key = `${service.serviceId}:${when.year}:${when.month}`;
    const row = totals.get(key) ?? {
      serviceId: service.serviceId,
      ...when,
      cost: 0,
      payments: 0,
    };
    row.cost -= amount; // outflows are negative
    if (amount < 0) row.payments++;
    totals.set(key, row);
  };
  for (const t of transactions) {
    // Deleted rows aren't bills (transfers carry no category, so they
    // never match a utility).
    if (t.deleted) continue;
    // A split parent counts only when it has no parts (Actual keeps the
    // parent's own category; YNAB's is "Split") — its parts each count.
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
): {
  changes: FeedChange[];
  conflicts: FeedConflict[];
  /** Months that net to a credit (refunds ≥ bills): not written. */
  credits: FeedMonth[];
  /** Months this service filled before that no longer have any bills in
   *  the budget (a payment deleted or recategorized, an account closed) —
   *  shown, never removed. */
  gone: ExistingReading[];
} {
  const key = (r: { serviceId: number; year: number; month: number }) =>
    `${r.serviceId}:${r.year}:${r.month}`;
  const recorded = new Map(existing.map((r) => [key(r), r]));
  const fed = new Set(months.map(key));
  const changes: FeedChange[] = [];
  const conflicts: FeedConflict[] = [];
  const credits: FeedMonth[] = [];
  for (const m of months) {
    if (m.cost <= 0) {
      credits.push(m);
      continue;
    }
    const r = recorded.get(key(m));
    if (!r) changes.push({ ...m, previous: null });
    else if (sameCost(r.cost, m.cost)) continue;
    else if (r.source === source) changes.push({ ...m, previous: r.cost });
    else conflicts.push({ ...m, previous: r.cost, previousSource: r.source });
  }
  // Only within the window the budget covers (from its earliest month on
  // for that service); older months are simply past what was synced.
  const firstFed = new Map<number, number>();
  for (const m of months) {
    const i = m.year * 12 + m.month;
    firstFed.set(m.serviceId, Math.min(firstFed.get(m.serviceId) ?? i, i));
  }
  const gone = existing.filter(
    (r) =>
      r.source === source &&
      !fed.has(key(r)) &&
      firstFed.has(r.serviceId) &&
      r.year * 12 + r.month >= firstFed.get(r.serviceId)!,
  );
  return { changes, conflicts, credits, gone };
}
