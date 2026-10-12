/**
 * Saved so far this year against the paycheck plan, per tracked account
 * and for the household. Pure.
 *
 * Saved = contributions recorded in Performance for the year plus those
 * SimpleFIN has seen since the last fill (or, for an account with no feed,
 * the paycheck estimate the fill would add). The plan side comes from the
 * paycheck setup on each contribution's own schedule (paychecks walked from
 * the job's anchor payday, months, or once a year — see
 * contribRemainingFraction), the same rule as the Contributions page:
 *   plan to date      = the year's plan − what's still to come
 *   year-end estimate = saved + unposted + what's still to come
 *                       (the Year-End Estimate view's formula: actual so
 *                       far, the gap since the latest data at today's
 *                       rate, the rest of the year at today's rate).
 */
import { roundToCents } from "@/lib/utils/math";

export type PaceStatus = "met" | "on_pace" | "behind" | "no_plan";

export type PacePlan = {
  /** The year's plan, employee + employer. */
  yearly: number;
  /** Of it, what's still to come after today. */
  remaining: number;
  /** One contribution's worth (a paycheck, or a month): a deposit can post a contribution late. */
  perContribution: number;
};

export type PaceAccountInput = {
  performanceAccountId: number;
  label: string;
  /** Contributions recorded in Performance this year (employee + employer). */
  recorded: number;
  /** Seen since the last fill, not yet recorded. */
  pending: number;
  /** Part of `pending` is a paycheck estimate (no feed, or balance-only). */
  pendingEstimated: boolean;
  /**
   * The plan between the account's latest posted data and today — taken to
   * be on its way (a feed posts a paycheck's deposit after payday).
   */
  unposted: number;
  /** The account's paycheck setup (null: none). */
  plan: PacePlan | null;
};

function status(
  saved: number,
  yearly: number,
  planToDate: number,
  perContribution: number,
): PaceStatus {
  if (yearly <= 0) return "no_plan";
  if (saved >= yearly) return "met";
  return saved >= planToDate - perContribution ? "on_pace" : "behind";
}

export function savingsPace(accounts: readonly PaceAccountInput[]) {
  const rows = accounts
    .map((a) => {
      const yearly = a.plan?.yearly ?? 0;
      const remaining = a.plan?.remaining ?? 0;
      const perContribution = a.plan?.perContribution ?? 0;
      const planToDate = yearly - remaining;
      const saved = roundToCents(a.recorded + a.pending);
      const counted = saved + a.unposted;
      return {
        performanceAccountId: a.performanceAccountId,
        label: a.label,
        saved,
        recorded: roundToCents(a.recorded),
        pending: roundToCents(a.pending),
        pendingEstimated: a.pendingEstimated,
        planYear: roundToCents(yearly),
        planToDate: roundToCents(planToDate),
        perContribution: roundToCents(perContribution),
        unposted: roundToCents(a.unposted),
        /** Saved so far, plus what's on its way and the rest of the year at today's rate. */
        yearEnd: roundToCents(counted + remaining),
        status: status(counted, yearly, planToDate, perContribution),
      };
    })
    .filter((r) => r.planYear > 0 || r.saved !== 0)
    .sort((x, y) => y.planYear - x.planYear || y.saved - x.saved);
  const sum = (
    k:
      | "saved"
      | "unposted"
      | "planYear"
      | "planToDate"
      | "perContribution"
      | "yearEnd",
  ) => roundToCents(rows.reduce((t, r) => t + r[k], 0));
  const saved = sum("saved");
  const planYear = sum("planYear");
  const planToDate = sum("planToDate");
  return {
    accounts: rows,
    total: {
      saved,
      planYear,
      planToDate,
      yearEnd: sum("yearEnd"),
      unposted: sum("unposted"),
      status: status(
        saved + sum("unposted"),
        planYear,
        planToDate,
        sum("perContribution"),
      ),
      estimated: rows.some((r) => r.pendingEstimated && r.pending !== 0),
    },
  };
}

export type SavingsPace = ReturnType<typeof savingsPace>;
