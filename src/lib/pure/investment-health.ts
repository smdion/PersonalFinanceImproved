/**
 * Monitors for the stored SimpleFIN investment data. Pure — the caller
 * gathers per-account facts; this decides what needs attention.
 */
import {
  HOLDINGS_BALANCE_GAP_FRACTION,
  HOLDINGS_STALE_DAYS,
} from "@/lib/config/investment-health";

export type AccountHealthInput = {
  label: string;
  /** Latest day holdings were reported (YYYY-MM-DD), or null if never. */
  holdingsAsOf: string | null;
  /** Sum of reported values of the funds held on that day. */
  holdingsValue: number | null;
  /** The account balance reported with those holdings. */
  balance: number | null;
};

export type HealthIssue = {
  account: string;
  kind: "holdings_stale" | "holdings_gap";
  message: string;
};

const DAY_MS = 86_400_000;

function daysBetween(fromDay: string, toDay: string): number {
  return Math.round(
    (Date.parse(`${toDay}T00:00:00Z`) - Date.parse(`${fromDay}T00:00:00Z`)) /
      DAY_MS,
  );
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
    if (a.holdingsValue !== null && a.balance !== null && a.balance > 0) {
      const gap = Math.abs(a.holdingsValue - a.balance) / a.balance;
      if (gap > HOLDINGS_BALANCE_GAP_FRACTION) {
        issues.push({
          account: a.label,
          kind: "holdings_gap",
          message: `${a.label}: holdings add up to ${Math.round(gap * 100)}% ${a.holdingsValue < a.balance ? "less" : "more"} than the balance`,
        });
      }
    }
  }
  return issues;
}
