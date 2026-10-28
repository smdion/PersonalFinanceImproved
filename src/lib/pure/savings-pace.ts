/**
 * Saved so far this year and where the year is heading, per tracked account
 * and for the household. Pure.
 *
 * Saved = contributions recorded in Performance for the year plus those
 * SimpleFIN has seen since the last fill (or, for an account with no feed,
 * the paycheck estimate the fill would add).
 *
 * Ledgr keeps only today's paycheck setup — not when it changed — so a
 * "plan to date" can't be known (an election raised in July, a goal added
 * in October). The card therefore follows the Contributions page:
 *   full year at today's setup (Current Salary view),
 *   year-end estimate = saved + unposted + what's still to come at today's
 *     setup (Year-End Estimate view: actual so far, the gap since the latest
 *     posted data, the rest of the year — the same formula),
 *   saved (Actual YTD view),
 * and judges only whether the latest contribution matches today's setup.
 */
import { roundToCents } from "@/lib/utils/math";
import type {
  LatestContribution,
  LatestContributionVerdict,
} from "./deposit-check";

export type PaceStatus =
  /** Saved the full year's plan already. */
  | "met"
  /** The latest contribution matches today's setup. */
  | "on_pace"
  /** The latest contribution differs from today's setup. */
  | "differs"
  /** The feed sent no contribution recently. */
  | "no_recent"
  /** No transactions to check (balance-only feed or none): estimated. */
  | "estimated"
  | "no_plan";

type PacePlan = {
  /** The year's plan at today's setup, employee + employer. */
  yearly: number;
  /** Of it, what's still to come after today. */
  remaining: number;
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
  /** The latest contribution vs today's setup; null when the feed sends no transactions. */
  latest: LatestContribution | null;
  /** The account's paycheck setup (null: none). */
  plan: PacePlan | null;
};

const FROM_LATEST: Record<LatestContributionVerdict, PaceStatus> = {
  matches: "on_pace",
  differs: "differs",
  none: "no_recent",
};

function status(a: PaceAccountInput, saved: number): PaceStatus {
  const yearly = a.plan?.yearly ?? 0;
  if (yearly <= 0) return "no_plan";
  if (saved >= yearly) return "met";
  return a.latest === null ? "estimated" : FROM_LATEST[a.latest.verdict];
}

/** The household: on pace only when every checked account is. */
function totalStatus(statuses: readonly PaceStatus[]): PaceStatus {
  const planned = statuses.filter((s) => s !== "no_plan");
  if (planned.length === 0) return "no_plan";
  if (planned.every((s) => s === "met")) return "met";
  for (const s of ["differs", "no_recent"] as const)
    if (planned.includes(s)) return s;
  return planned.some((s) => s === "on_pace") ? "on_pace" : "estimated";
}

export function savingsPace(accounts: readonly PaceAccountInput[]) {
  const rows = accounts
    .map((a) => {
      const saved = roundToCents(a.recorded + a.pending);
      return {
        performanceAccountId: a.performanceAccountId,
        label: a.label,
        saved,
        recorded: roundToCents(a.recorded),
        pending: roundToCents(a.pending),
        pendingEstimated: a.pendingEstimated,
        unposted: roundToCents(a.unposted),
        /** The full year at today's setup. */
        planYear: roundToCents(a.plan?.yearly ?? 0),
        /** Saved so far, what's on its way, and the rest of the year at today's setup. */
        yearEnd: roundToCents(saved + a.unposted + (a.plan?.remaining ?? 0)),
        status: status(a, saved),
        /** What the status was judged on (the card's hover). */
        latest: a.latest,
      };
    })
    .filter((r) => r.planYear > 0 || r.saved !== 0)
    .sort((x, y) => y.planYear - x.planYear || y.saved - x.saved);
  // Totals cover the accounts with a paycheck plan — the ones the
  // Contributions card lists (money in a no-plan account, e.g. an ESPP,
  // shows on its own row only).
  const planned = rows.filter((r) => r.planYear > 0);
  const sum = (k: "saved" | "unposted" | "planYear" | "yearEnd") =>
    roundToCents(planned.reduce((t, r) => t + r[k], 0));
  return {
    accounts: rows,
    total: {
      saved: sum("saved"),
      unposted: sum("unposted"),
      planYear: sum("planYear"),
      yearEnd: sum("yearEnd"),
      status: totalStatus(rows.map((r) => r.status)),
      estimated: planned.some((r) => r.pendingEstimated && r.pending !== 0),
    },
  };
}
