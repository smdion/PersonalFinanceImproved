/**
 * Money put away so far this year per tracked account, live: what
 * Performance records, what SimpleFIN has seen since the last fill (or the
 * paycheck estimate for an account without transactions), and what's on its
 * way (the plan between the latest posted transaction and today). The
 * Contributions page's Actual YTD / Year-End Estimate views and its
 * per-account status read this — one computation, see contribution router.
 */
import { and, eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { addDays, localDateStr } from "@/lib/utils/date";
import { roundToCents } from "@/lib/utils/math";
import {
  checkLatestContribution,
  type LatestContribution,
} from "@/lib/pure/deposit-check";
import {
  RECENT_ACTIVITY_DAYS,
  sentTransactions,
} from "@/lib/pure/simplefin-feeds";
import type { PaceAccountInput } from "@/lib/pure/savings-pace";
import { loadContributionMix } from "@/server/helpers/contribution-mix";
import { loadTrackedAccountNames } from "@/server/helpers/account-names";
import { toNumber } from "@/server/helpers/transforms";
import { loadClassifiedTransactions, loadFeedContext } from "./_shared";
import { loadPerformanceSuggestions } from "./fills";

type Db = Parameters<typeof loadFeedContext>[0];

export type LiveContribution = {
  performanceAccountId: number;
  label: string;
  recorded: { employee: number; employer: number };
  /** Seen since the last fill (or estimated from the paycheck setup). */
  pending: { employee: number; employer: number };
  pendingEstimated: boolean;
  /** The plan between the latest posted transaction and today. */
  unposted: { employee: number; employer: number };
  /** The latest contribution vs today's setup (null: no transactions to check). */
  latest: LatestContribution | null;
  /** The day the latest contribution actually arrived (null: none seen). */
  latestContributionDay: string | null;
  plan: { yearly: number; remaining: number } | null;
};

const dayDate = (day: string) => new Date(`${day}T12:00:00Z`);

export async function loadLiveContributions(
  db: Db,
  today: string = localDateStr(),
): Promise<LiveContribution[]> {
  const year = Number(today.slice(0, 4));
  const recentSince = addDays(today, -RECENT_ACTIVITY_DAYS);
  const [rows, pending, names, context, recent] = await Promise.all([
    db
      .select({
        performanceAccountId: schema.accountPerformance.performanceAccountId,
        totalContributions: schema.accountPerformance.totalContributions,
        employerContributions: schema.accountPerformance.employerContributions,
      })
      .from(schema.accountPerformance)
      .where(
        and(
          eq(schema.accountPerformance.year, year),
          eq(schema.accountPerformance.isActive, true),
        ),
      ),
    loadPerformanceSuggestions(db, year),
    loadTrackedAccountNames(db),
    loadFeedContext(db),
    loadClassifiedTransactions(db, { since: recentSince }),
  ]);
  const feedIdsOf = (id: number) =>
    context.feeds.filter((f) => f.performanceAccountId === id).map((f) => f.id);
  const contributionsOf = (id: number) => {
    const ids = feedIdsOf(id);
    return recent.filter(
      (r) =>
        ids.includes(r.simplefinAccountId) &&
        r.posted >= recentSince &&
        r.kind === "contribution" &&
        !r.pending &&
        !r.voided,
    );
  };
  // The day each account's latest contribution actually arrived: a month
  // whose contribution is in counts as done (see monthsDoneYtd), so the rest
  // of the year isn't counted from it again.
  const contributedThrough = new Map<number, string>();
  for (const id of new Set(context.feeds.map((f) => f.performanceAccountId))) {
    const latest = checkLatestContribution(contributionsOf(id), 0).latest;
    if (latest) contributedThrough.set(id, latest.day);
  }
  const mix = await loadContributionMix(db, dayDate(today), contributedThrough);
  // An account whose feed sends transactions is known only through its
  // latest posted one; the plan between then and today is on its way — the
  // gap the Year-End Estimate view fills ("stale periods").
  const lastPosted = new Map<number, string>();
  for (const f of context.feeds) {
    const day = context.lastTransactionDay.get(f.id);
    if (
      day &&
      day < today &&
      day > (lastPosted.get(f.performanceAccountId) ?? "")
    )
      lastPosted.set(f.performanceAccountId, day);
  }
  const mixAt = new Map(
    await Promise.all(
      [...new Set(lastPosted.values())].map(
        async (day) =>
          [
            day,
            await loadContributionMix(db, dayDate(day), contributedThrough),
          ] as const,
      ),
    ),
  );
  const ids = new Set([
    ...rows.map((r) => r.performanceAccountId),
    ...mix.keys(),
  ]);
  return [...ids].map((id) => {
    const mine = pending.filter((p) => p.performanceAccountId === id);
    const m = mix.get(id);
    const yearly = m
      ? m.employeePreTax + m.employeeRoth + m.employeeOther + m.employer
      : 0;
    const estimated = mine.some((p) => p.estimate !== null);
    const posted = lastPosted.get(id);
    const then = posted ? mixAt.get(posted)?.get(id) : undefined;
    // A paycheck estimate already runs to today: nothing in between.
    const unposted =
      m && then && !estimated
        ? Math.max(0, then.remainingThisYear - m.remainingThisYear)
        : 0;
    const employerShare = yearly > 0 ? m!.employer / yearly : 0;
    const feedIds = context.feeds
      .filter((f) => f.performanceAccountId === id)
      .map((f) => f.id);
    const mineRows = rows.filter((r) => r.performanceAccountId === id);
    const recordedTotal = mineRows.reduce(
      (t, r) => t + toNumber(r.totalContributions),
      0,
    );
    const recordedEmployer = mineRows.reduce(
      (t, r) => t + toNumber(r.employerContributions),
      0,
    );
    return {
      performanceAccountId: id,
      label: names.get(id) ?? "",
      recorded: {
        employee: roundToCents(recordedTotal - recordedEmployer),
        employer: roundToCents(recordedEmployer),
      },
      pending: {
        employee: roundToCents(mine.reduce((t, p) => t + p.added.employee, 0)),
        employer: roundToCents(mine.reduce((t, p) => t + p.added.employer, 0)),
      },
      pendingEstimated: estimated,
      unposted: {
        employee: roundToCents(unposted * (1 - employerShare)),
        employer: roundToCents(unposted * employerShare),
      },
      // Only a feed that sends transactions can show the latest deposit.
      latest:
        m && sentTransactions(feedIds, context.lastTransactionDay, recentSince)
          ? (() => {
              const check = checkLatestContribution(
                contributionsOf(id),
                m.perContribution,
              );
              return {
                verdict: check.verdict,
                deposit: check.latest,
                expected: roundToCents(m.perContribution),
              };
            })()
          : null,
      latestContributionDay: contributedThrough.get(id) ?? null,
      plan: m ? { yearly, remaining: m.remainingThisYear } : null,
    };
  });
}

/** Employee and employer money in so far this year, through today (recorded + new + on its way). */
export function liveYearToDate(c: LiveContribution): {
  contributions: number;
  employerMatch: number;
} {
  return {
    contributions: roundToCents(
      c.recorded.employee + c.pending.employee + c.unposted.employee,
    ),
    employerMatch: roundToCents(
      c.recorded.employer + c.pending.employer + c.unposted.employer,
    ),
  };
}

/** The pace view of one account (lib/pure/savings-pace). */
export function toPaceInput(c: LiveContribution): PaceAccountInput {
  return {
    performanceAccountId: c.performanceAccountId,
    label: c.label,
    recorded: c.recorded.employee + c.recorded.employer,
    pending: c.pending.employee + c.pending.employer,
    pendingEstimated: c.pendingEstimated,
    unposted: c.unposted.employee + c.unposted.employer,
    latest: c.latest,
    plan: c.plan,
  };
}
