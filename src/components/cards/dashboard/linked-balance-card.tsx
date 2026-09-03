"use client";

import React, { memo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, Metric } from "@/components/ui/card";
import { HelpTip } from "@/components/ui/help-tip";
import { formatCurrency, formatDate, formatPercent } from "@/lib/utils/format";
import { safeDivide, roundToCents } from "@/lib/utils/math";
import { getDisplayConfig } from "@/lib/config/account-types";
import type { AccountCategory } from "@/lib/config/account-types.types";
import type { PortfolioTaxType } from "@/lib/config/enum-values";
import { LoadingCard } from "./utils";

// Only need enough history to compute yesterday-vs-today for the trend arrow.
const HISTORY_DAYS = 2;

export type SimplefinAccountListItem = {
  id: number;
  orgName: string;
  isIncluded: boolean;
  lastBalance: number;
  linkedPerformanceAccountId: number | null;
  change: number | null;
  taxType: PortfolioTaxType | "mixed" | null;
  accountType: AccountCategory | null;
  subType: string | null;
  snapshotDate: string | null;
};

export type AccountTypeGroup = {
  key: string;
  label: string;
  balance: number;
  /** Signed drift vs. last snapshot for this group's matched accounts, deduped by performanceAccountId. 0 if nothing in the group is matched. */
  drift: number;
};

/**
 * Shared grouping engine behind summarizeByAccountType and
 * summarizeByInstitution — same balances/drift math, different bucketing
 * key/label, so the two rollups can never silently disagree on totals.
 */
function summarizeAccounts(
  accounts: SimplefinAccountListItem[],
  bucket: (a: SimplefinAccountListItem) => { key: string; label: string },
  unmatchedKey: string,
): AccountTypeGroup[] {
  const groups = new Map<
    string,
    { label: string; balance: number; changeByPerfId: Map<number, number> }
  >();
  for (const a of accounts) {
    if (!a.isIncluded) continue;
    const { key, label } = bucket(a);
    const group = groups.get(key) ?? {
      label,
      balance: 0,
      changeByPerfId: new Map<number, number>(),
    };
    group.balance += a.lastBalance;
    // Dedup by performanceAccountId within the group, same reasoning as
    // summarizeDrift: multiple SimpleFIN rows can share one matched
    // target and an identical `change`, so counting per row would
    // overcount this group's drift.
    if (
      a.linkedPerformanceAccountId != null &&
      a.change != null &&
      !group.changeByPerfId.has(a.linkedPerformanceAccountId)
    ) {
      group.changeByPerfId.set(a.linkedPerformanceAccountId, a.change);
    }
    groups.set(key, group);
  }
  return Array.from(groups.entries())
    .sort(([keyA, a], [keyB, b]) => {
      if (keyA === unmatchedKey) return 1;
      if (keyB === unmatchedKey) return -1;
      return b.balance - a.balance;
    })
    .map(([key, group]) => ({
      key,
      label: group.label,
      balance: group.balance,
      // Rounded to cents — summing several already-cents-rounded per-account
      // changes can still reintroduce sub-cent float noise (e.g. multiple
      // accounts under one group), which would otherwise show a "+$0.00"
      // badge next to sibling groups with no badge at all for a true zero.
      drift: roundToCents(
        Array.from(group.changeByPerfId.values()).reduce((s, c) => s + c, 0),
      ),
    }));
}

/**
 * Included accounts' own balances, bucketed by tracked-account type
 * (401k/IRA/HSA/Brokerage/ESPP/...) via getDisplayConfig — the same
 * canonical, subtype-aware labeling used everywhere else account types
 * are shown. Each group also carries its own drift figure. Sums to the
 * card's headline total; "Not matched" is always last regardless of
 * balance size, every other group sorts largest-first.
 */
export function summarizeByAccountType(
  accounts: SimplefinAccountListItem[],
): AccountTypeGroup[] {
  return summarizeAccounts(
    accounts,
    (a) => ({
      key: a.accountType ? `${a.accountType}::${a.subType ?? ""}` : "",
      label: a.accountType
        ? getDisplayConfig(a.accountType, a.subType).displayLabel
        : "Not matched",
    }),
    "",
  );
}

/**
 * Same balances/drift, bucketed by institution (orgName) instead of account
 * type — a different rollup of identical underlying accounts, so the two
 * views' totals always agree.
 */
export function summarizeByInstitution(
  accounts: SimplefinAccountListItem[],
): AccountTypeGroup[] {
  return summarizeAccounts(
    accounts,
    (a) => ({ key: a.orgName || "unknown", label: a.orgName || "Unknown" }),
    "unknown",
  );
}

/**
 * Drift summary across matched tracked accounts. Deduped by
 * linkedPerformanceAccountId — many-to-one matching means several
 * SimpleFIN accounts can share one target and an identical `change`
 * value, so counting per row would overcount. Deliberately not filtered
 * by isIncluded: matching is a data-comparison concept independent of
 * whether an account currently counts toward the total.
 */
export function summarizeDrift(accounts: SimplefinAccountListItem[]): {
  groupCount: number;
  driftedCount: number;
  totalDrift: number;
} {
  const changeByPerfId = new Map<number, number>();
  for (const a of accounts) {
    if (a.linkedPerformanceAccountId == null || a.change == null) continue;
    if (!changeByPerfId.has(a.linkedPerformanceAccountId)) {
      changeByPerfId.set(a.linkedPerformanceAccountId, a.change);
    }
  }
  let driftedCount = 0;
  let totalDrift = 0;
  for (const change of changeByPerfId.values()) {
    if (change !== 0) driftedCount++;
    totalDrift += change;
  }
  return {
    groupCount: changeByPerfId.size,
    driftedCount,
    totalDrift: roundToCents(totalDrift),
  };
}

/** balance is the category's CURRENT total — used only to back out its prior
 *  balance (balance - drift) so the badge can show percent *changed*, not
 *  percent of the portfolio total (a different, already-confusing number). */
function DriftBadge({ drift, balance }: { drift: number; balance: number }) {
  if (drift === 0) return null;
  const prevBalance = balance - drift;
  const driftPct = safeDivide(drift, prevBalance, null);
  return (
    <span
      className={`text-caption ${drift > 0 ? "text-green-600" : "text-red-600"}`}
    >
      ({drift > 0 ? "+" : "-"}
      {formatCurrency(Math.abs(drift))}
      {driftPct !== null &&
        ` / ${drift > 0 ? "+" : "-"}${formatPercent(Math.abs(driftPct), 1)}`}
      )
    </span>
  );
}

function LinkedBalanceCardImpl() {
  const [rollupBy, setRollupBy] = useState<"category" | "institution">(
    "category",
  );
  const { data: status, isLoading: statusLoading } =
    trpc.simplefin.getStatus.useQuery();
  const isConnected = status?.connected ?? false;

  const { data: history, isLoading: historyLoading } =
    trpc.simplefin.listBalanceHistory.useQuery(
      { days: HISTORY_DAYS },
      { enabled: isConnected },
    );
  const { data: accounts } = trpc.simplefin.listAccounts.useQuery(undefined, {
    enabled: isConnected,
  });
  // The universe to measure coverage against: every tracked account that
  // could in principle be linked (same list Settings' match picker uses),
  // not just the ones already matched — otherwise "N/N" is trivially 100%.
  const { data: matchableAccounts } =
    trpc.simplefin.listMatchableAccounts.useQuery(undefined, {
      enabled: isConnected,
    });

  if (statusLoading) return <LoadingCard title="Live Balance" />;
  // No SimpleFIN connection configured — omit the card entirely rather
  // than showing an empty/setup-nag widget. Setup lives in Settings.
  if (!isConnected) return null;
  if (historyLoading) return <LoadingCard title="Live Balance" />;
  if (!history || history.length === 0) {
    return (
      <Card title="Live Balance" href="/settings">
        <p className="text-faint text-sm">
          Connected — the first daily balance will appear after the next sync.
        </p>
      </Card>
    );
  }

  const latest = history[history.length - 1];
  const previous = history.length > 1 ? history[history.length - 2] : null;
  if (!latest) return null;
  const delta = previous ? latest.totalBalance - previous.totalBalance : null;

  const accountTypeGroups = accounts
    ? rollupBy === "category"
      ? summarizeByAccountType(accounts)
      : summarizeByInstitution(accounts)
    : [];
  const drift = accounts ? summarizeDrift(accounts) : null;
  const snapshotDate = accounts?.find((a) => a.snapshotDate)?.snapshotDate;
  const snapshotLabel = snapshotDate
    ? formatDate(snapshotDate, "medium")
    : "your last snapshot";

  // Coverage against every tracked account (not just the ones already
  // matched) — this is a linkage question, not an accuracy one. Matched
  // accounts routinely differing from the last snapshot is expected
  // (SimpleFIN updates daily, snapshots are manual/weekly) — that's what
  // the drift figure above already communicates, not a problem to flag
  // here. This line only answers "how much of my net worth does this
  // total actually represent."
  const totalTracked = matchableAccounts?.length ?? 0;
  const linkedCount = accounts
    ? new Set(
        accounts
          .map((a) => a.linkedPerformanceAccountId)
          .filter((id): id is number => id != null),
      ).size
    : 0;

  // Percent changed since the last snapshot — divide by the PRIOR balance
  // (current total minus this drift), not the current total, matching
  // DriftBadge's per-category math below. Dividing by the current total
  // understates the percent whenever the drift is a meaningful share of it.
  const priorTotal = drift ? latest.totalBalance - drift.totalDrift : null;
  const driftPercent =
    drift && drift.totalDrift !== 0 && priorTotal !== null && priorTotal !== 0
      ? drift.totalDrift / priorTotal
      : null;

  return (
    <Card
      title={
        <>
          Live Balance
          <HelpTip text="Daily total of accounts linked via SimpleFIN Bridge. Updates once a day and is separate from the manually-curated Net Worth figure above. Balances reflect what each institution last reported to SimpleFIN, which can itself lag your bank by a day or more — this is not a real-time figure." />
        </>
      }
      href="/settings"
    >
      <Metric
        value={formatCurrency(latest.totalBalance)}
        trend={
          delta !== null && delta !== 0
            ? {
                isPositive: delta > 0,
                value: `${formatCurrency(Math.abs(delta))} vs. yesterday`,
              }
            : undefined
        }
      />

      {/* Drift is the headline of the card body — how much your linked
          accounts have moved since your last manual snapshot, not another
          restatement of balances you can already see above. */}
      {drift && drift.groupCount > 0 && (
        <div className="mb-2">
          <span
            className={`text-xl font-semibold ${
              drift.totalDrift === 0
                ? "text-muted"
                : drift.totalDrift > 0
                  ? "text-green-600"
                  : "text-red-600"
            }`}
          >
            {drift.totalDrift === 0
              ? "No change"
              : `${drift.totalDrift > 0 ? "+" : "-"}${formatCurrency(Math.abs(drift.totalDrift))}`}
            {driftPercent !== null &&
              ` (${drift.totalDrift > 0 ? "+" : "-"}${formatPercent(Math.abs(driftPercent), 1)})`}
          </span>
          <span className="text-caption text-muted ml-2">
            vs. {snapshotLabel}
          </span>
        </div>
      )}

      {/* Coverage against every tracked account — not just the matched
          ones — answers "does this total represent all of net worth,"
          not "is everything currently in sync" (drift is expected). */}
      {totalTracked > 0 && (
        <p className="text-caption text-muted">
          {linkedCount} of {totalTracked} tracked accounts linked via SimpleFIN
        </p>
      )}

      {/* Account-type breakdown is reference detail, not the headline —
          kept small/muted so it doesn't compete with the drift figure above. */}
      {accounts && accountTypeGroups.length > 0 && (
        <div className="border-subtle mt-3 space-y-1 border-t pt-3">
          <div className="flex justify-end">
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setRollupBy(
                  rollupBy === "category" ? "institution" : "category",
                );
              }}
              className="bg-surface-elevated hover:bg-surface-strong text-muted rounded-full px-2 py-0.5 text-xs transition-colors"
            >
              By {rollupBy === "category" ? "institution" : "category"}
            </button>
          </div>
          {accountTypeGroups.map(
            ({ key, label, balance, drift: groupDrift }) => (
              <div
                key={key || "unmatched"}
                className="text-faint flex justify-between text-xs"
              >
                <span>{label}</span>
                <span className="flex items-center gap-1.5">
                  {formatCurrency(balance)}
                  <DriftBadge drift={groupDrift} balance={balance} />
                </span>
              </div>
            ),
          )}
        </div>
      )}

      {/* Freshness footer — same position (bottom of card) and format
          ("Updated <medium date>") as the Net Worth card's footer. */}
      <p className="text-caption text-faint mt-1">
        {status?.lastSyncedAt
          ? `As of ${formatDate(status.lastSyncedAt.toString(), "medium")}`
          : "Not yet synced"}
        {" · "}
        {latest.accountCount} account{latest.accountCount === 1 ? "" : "s"}
      </p>
    </Card>
  );
}

export const LinkedBalanceCard = memo(LinkedBalanceCardImpl);
