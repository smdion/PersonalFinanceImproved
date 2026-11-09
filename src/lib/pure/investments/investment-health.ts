/**
 * Monitors for the stored SimpleFIN investment data. Pure — the caller
 * gathers per-account facts; this decides what needs attention.
 */
import {
  HOLDINGS_BALANCE_GAP_FRACTION,
  HOLDINGS_GAP_GRACE_DAYS,
  HOLDINGS_STALE_DAYS,
} from "@/lib/config/investment-health";
import { MS_PER_DAY } from "@/lib/constants";

type AccountHealthInput = {
  label: string;
  /** Latest day holdings were reported (YYYY-MM-DD), or null if never. */
  holdingsAsOf: string | null;
  /** Sum of reported values of the funds held on that day. */
  holdingsValue: number | null;
  /** The account balance reported with those holdings. */
  balance: number | null;
  /** First day of the unbroken run of gaps up to the latest report
   *  (holdingsGapSince); null with no gap now. */
  gapSince: string | null;
};

type HealthIssue = {
  account: string;
  kind: "holdings_stale" | "holdings_gap";
  message: string;
};

function daysBetween(fromDay: string, toDay: string): number {
  return Math.round(
    (Date.parse(`${toDay}T00:00:00Z`) - Date.parse(`${fromDay}T00:00:00Z`)) /
      MS_PER_DAY,
  );
}

/** Holdings vs balance as a share of the balance; null when unknown. */
function holdingsGap(
  holdingsValue: number | null,
  balance: number | null,
): number | null {
  if (holdingsValue === null || balance === null || balance <= 0) return null;
  return Math.abs(holdingsValue - balance) / balance;
}

/**
 * The day the current gap began: the earliest report in the unbroken run
 * of gaps ending at the latest one. A report that can't be compared
 * neither extends nor breaks the run. Null when the latest has no gap.
 */
export function holdingsGapSince(
  reports: readonly {
    asOf: string;
    holdingsValue: number | null;
    balance: number | null;
  }[],
): string | null {
  let since: string | null = null;
  const newestFirst = [...reports].sort((a, b) => b.asOf.localeCompare(a.asOf));
  for (const r of newestFirst) {
    const gap = holdingsGap(r.holdingsValue, r.balance);
    if (gap === null) continue;
    if (gap <= HOLDINGS_BALANCE_GAP_FRACTION) break;
    since = r.asOf;
  }
  return since;
}

export function investmentHealthIssues(
  accounts: readonly AccountHealthInput[],
  today: string,
): HealthIssue[] {
  const issues: HealthIssue[] = [];
  for (const a of accounts) {
    if (a.holdingsAsOf === null) continue; // never reported holdings
    const age = daysBetween(a.holdingsAsOf, today);
    if (age > HOLDINGS_STALE_DAYS) {
      issues.push({
        account: a.label,
        kind: "holdings_stale",
        message: `${a.label}: holdings last reported ${age} days ago`,
      });
    }
    const gap = holdingsGap(a.holdingsValue, a.balance);
    if (gap !== null && gap > HOLDINGS_BALANCE_GAP_FRACTION && a.gapSince) {
      const days = daysBetween(a.gapSince, today);
      if (days > HOLDINGS_GAP_GRACE_DAYS) {
        issues.push({
          account: a.label,
          kind: "holdings_gap",
          message: `${a.label}: holdings have added up to ${Math.round(gap * 100)}% ${a.holdingsValue! < a.balance! ? "less" : "more"} than the balance for ${days} days`,
        });
      }
    }
  }
  return issues;
}
