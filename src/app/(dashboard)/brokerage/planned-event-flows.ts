/** The Brokerage page's planned events as its projection reads them. */
import type {
  AccumOverride,
  LumpSumEvent,
} from "@/components/retirement-projection/types";
import { lumpSumTarget } from "@/components/retirement-projection/lump-sum-target";
import type {
  EngineYearProjection,
  PlannedBrokerageWithdrawal,
} from "@/lib/pure/engine/types";
import { formatCurrency } from "@/lib/utils/format";
import { roundToCents } from "@/lib/utils/math";

/** Each deposit as a Portfolio lump sum in its year's Changes, by year, and
 *  each withdrawal (an amount below $0) as a planned brokerage withdrawal.
 *  An event with no year or amount, or an amount of 0, is left out. */
export function plannedEventFlows(events: readonly LumpSumEvent[]) {
  const byYear = new Map<number, AccumOverride>();
  const withdrawals: PlannedBrokerageWithdrawal[] = [];
  for (const ls of events) {
    const year = parseInt(ls.year);
    const amount = parseFloat(ls.amount);
    if (isNaN(year) || isNaN(amount) || amount === 0) continue;
    const label = ls.label ? { label: ls.label } : {};
    if (amount < 0) {
      withdrawals.push({ id: ls.id, year, amount: -amount, ...label });
      continue;
    }
    let ov = byYear.get(year);
    if (!ov) {
      ov = { year, lumpSums: [] };
      byYear.set(year, ov);
    }
    ov.lumpSums!.push({
      id: ls.id,
      amount,
      targetAccount: ls.targetAccount,
      // Brokerage-page lump sums are Portfolio savings.
      targetParentCategory: "Portfolio" as const,
      ...lumpSumTarget(ls),
      ...label,
    });
  }
  const accumulationOverrides = Array.from(byYear.values()).sort(
    (a, b) => a.year - b.year,
  );
  return { accumulationOverrides, withdrawals };
}

const named = (label: string | undefined) =>
  label ? `Planned withdrawal "${label}"` : "A planned withdrawal";

/** The page's notes on its planned withdrawals: each one the projection drew
 *  only in part, and each one it didn't draw (it has no working year then). */
export function plannedWithdrawalNotes(result: {
  projectionByYear: readonly EngineYearProjection[];
  undrawnBrokerageWithdrawals?: readonly PlannedBrokerageWithdrawal[];
}): string[] {
  const partial = result.projectionByYear.flatMap((y) =>
    y.phase === "accumulation"
      ? (y.brokerageWithdrawals ?? [])
          .filter((w) => w.amount < roundToCents(w.requested))
          .map(
            (w) =>
              `${named(w.label)} in ${y.year}: ${formatCurrency(w.amount)} of ${formatCurrency(w.requested)} drawn, all the Portfolio brokerages hold.`,
          )
      : [],
  );
  const undrawn = (result.undrawnBrokerageWithdrawals ?? []).map(
    (w) =>
      `${named(w.label)} of ${formatCurrency(w.amount)} in ${w.year} isn't drawn: only a projected year before retirement draws one.`,
  );
  return [...partial, ...undrawn];
}
