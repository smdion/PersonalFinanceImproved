/**
 * Saved so far this year against the paycheck plan, per tracked account
 * and for the household. Pure.
 *
 * Saved = contributions recorded in Performance for the year plus those
 * SimpleFIN has seen since the last fill (or, for an account with no feed,
 * the paycheck estimate the fill would add). The plan to date is the
 * paycheck setup's yearly amount pro-rated to today, the same estimate the
 * fills use (estimateFromPaycheck).
 */
import { roundToCents } from "@/lib/utils/math";
import { estimateFromPaycheck, type ContributionMix } from "./flow-suggestions";

/**
 * Paydays make saving lumpy: half a month of the plan behind still counts
 * as on pace.
 */
export const PACE_SLACK_OF_YEAR = 1 / 24;

export type PaceStatus = "met" | "on_pace" | "behind" | "no_plan";

export type PaceAccountInput = {
  performanceAccountId: number;
  label: string;
  /** Contributions recorded in Performance this year (employee + employer). */
  recorded: number;
  /** Seen since the last fill, not yet recorded. */
  pending: number;
  /** Part of `pending` is a paycheck estimate (no feed, or balance-only). */
  pendingEstimated: boolean;
  /** The account's paycheck setup (null: none). */
  plan: ContributionMix | null;
};

function status(
  saved: number,
  planYear: number,
  planToDate: number,
): PaceStatus {
  if (planYear <= 0) return "no_plan";
  if (saved >= planYear) return "met";
  return saved >= planToDate - planYear * PACE_SLACK_OF_YEAR
    ? "on_pace"
    : "behind";
}

export function savingsPace(
  accounts: readonly PaceAccountInput[],
  today: string,
) {
  const yearStart = `${Number(today.slice(0, 4)) - 1}-12-31`;
  const rows = accounts
    .map((a) => {
      const yearly = a.plan
        ? a.plan.employeePreTax +
          a.plan.employeeRoth +
          a.plan.employeeOther +
          a.plan.employer
        : 0;
      const toDate = a.plan
        ? estimateFromPaycheck(a.plan, yearStart, today)
        : null;
      const planToDate = toDate ? toDate.employee + toDate.employer : 0;
      const saved = roundToCents(a.recorded + a.pending);
      return {
        performanceAccountId: a.performanceAccountId,
        label: a.label,
        saved,
        recorded: roundToCents(a.recorded),
        pending: roundToCents(a.pending),
        pendingEstimated: a.pendingEstimated,
        planYear: roundToCents(yearly),
        planToDate: roundToCents(planToDate),
        status: status(saved, yearly, planToDate),
      };
    })
    .filter((r) => r.planYear > 0 || r.saved !== 0)
    .sort((x, y) => y.planYear - x.planYear || y.saved - x.saved);
  const sum = (k: "saved" | "planYear" | "planToDate") =>
    roundToCents(rows.reduce((t, r) => t + r[k], 0));
  const saved = sum("saved");
  const planYear = sum("planYear");
  const planToDate = sum("planToDate");
  return {
    accounts: rows,
    total: {
      saved,
      planYear,
      planToDate,
      status: status(saved, planYear, planToDate),
      estimated: rows.some((r) => r.pendingEstimated && r.pending !== 0),
    },
  };
}

export type SavingsPace = ReturnType<typeof savingsPace>;
