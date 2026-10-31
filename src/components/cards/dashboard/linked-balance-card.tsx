"use client";

import { countsAsFeed } from "@/lib/pure/simplefin-feeds";
import React, { memo, useState } from "react";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { Card, Metric } from "@/components/ui/card";
import { HelpTip } from "@/components/ui/help-tip";
import { Tooltip } from "@/components/ui/tooltip";
import { useUser, hasPermission } from "@/lib/context/user-context";
import { summarizeBalanceDates } from "@/lib/pure/balance-dates";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import { roundToCents } from "@/lib/utils/math";
import { getDisplayConfig } from "@/lib/config/account-types";
import type { AccountCategory } from "@/lib/config/account-types.types";
import type { PortfolioTaxType } from "@/lib/config/enum-values";
import { LoadingCard } from "./utils";

/** How the breakdown groups balances; the button steps through them in order. */
type Rollup = "category" | "institution" | "account";
const ROLLUPS: readonly Rollup[] = ["category", "institution", "account"];
const ROLLUP_LABELS: Record<Rollup, string> = {
  category: "category",
  institution: "institution",
  account: "account",
};

// Only need enough history to compute yesterday-vs-today for the trend arrow.
const HISTORY_DAYS = 2;

export type SimplefinAccountListItem = {
  id: number;
  orgName: string;
  isIncluded: boolean;
  lastBalance: number;
  lastBalanceDate: Date | string | null;
  lastSeenAt: Date | string;
  linkedPerformanceAccountId: number | null;
  change: number | null;
  taxType: PortfolioTaxType | "mixed" | null;
  accountType: AccountCategory | null;
  subType: string | null;
  snapshotDate: string | null;
};

/** "Oct 29, 9:57 PM" in the household's zone. */
const reportTime = (at: Date | string) =>
  new Date(at).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

type CurrentFeed =
  RouterOutputs["investments"]["getCurrentBalances"]["feeds"][number];

const BASIS_TEXT: Record<CurrentFeed["basis"], string> = {
  proven: "close",
  learned: "close (est.)",
  assumed: "close (assumed)",
  reported: "",
};

/** One line per feed: the market close its data is from, then the report. */
function feedDateLine(f: CurrentFeed): string {
  const reported = f.timeKnown
    ? `reported ${reportTime(f.reportedAt)}`
    : `no time reported; last seen ${reportTime(f.reportedAt)}`;
  if (f.basis === "reported")
    return `${f.institution} — ${f.timeKnown ? reportTime(f.reportedAt) : reported}`;
  return `${f.institution} — ${shortDay(f.dataDay)} ${BASIS_TEXT[f.basis]}, ${reported}`;
}

function BalanceDatesFooter({
  accounts,
  feeds,
  accountCount,
  lastSyncedAt,
}: {
  accounts: SimplefinAccountListItem[] | undefined;
  feeds: readonly CurrentFeed[] | undefined;
  accountCount: number;
  lastSyncedAt: Date | string | null;
}) {
  const countLabel = `${accountCount} account${accountCount === 1 ? "" : "s"}`;
  const market = (feeds ?? []).filter(
    (f) => f.basis !== "reported" && f.timeKnown,
  );
  if (market.length === 0) {
    const summary = summarizeBalanceDates(
      (accounts ?? [])
        .filter((a) => a.isIncluded)
        .map((a) => ({
          institution: a.orgName,
          reportedAt: new Date(a.lastBalanceDate ?? a.lastSeenAt),
        })),
    );
    return (
      <p className="text-caption text-faint mt-1">
        {summary.newest
          ? `Reported through ${shortDay(summary.newest)}`
          : lastSyncedAt
            ? `As of ${formatDate(lastSyncedAt.toString(), "medium")}`
            : "Not yet synced"}
        {" · "}
        {countLabel}
      </p>
    );
  }
  const days = market.map((f) => f.dataDay).sort();
  const oldest = days[0]!;
  const newest = days[days.length - 1]!;
  const range =
    oldest === newest
      ? shortDay(oldest)
      : `${shortDay(oldest)}–${shortDay(newest)}`;
  const anyEstimate = market.some((f) => f.basis !== "proven");
  const lines = [...new Set((feeds ?? []).map(feedDateLine))];
  const behind = [
    ...new Set(
      (feeds ?? []).filter((f) => f.behindSnapshot).map((f) => f.institution),
    ),
  ];
  return (
    <div className="mt-1">
      <Tooltip
        side="top"
        lines={["The market close each balance is really from:", ...lines]}
      >
        <p className="text-caption text-faint w-fit cursor-help underline decoration-dotted underline-offset-2">
          Data from the {range} close{oldest === newest ? "" : "s"}
          {anyEstimate ? " (est.)" : ""} · {countLabel}
        </p>
      </Tooltip>
      {behind.length > 0 && (
        <p className="text-caption text-faint">
          Your snapshot is used for {behind.join(" and ")} until{" "}
          {behind.length === 1 ? "it reports" : "they report"} a newer close
        </p>
      )}
    </div>
  );
}

function snapshotDateLabel(
  accounts: SimplefinAccountListItem[] | undefined,
): string {
  const date = accounts?.find((a) => a.snapshotDate)?.snapshotDate;
  return date ? formatDate(date, "medium") : "your snapshot";
}

type CurrentSummary =
  RouterOutputs["investments"]["getCurrentBalances"]["summary"];

/** Under the total: which day it's estimated to, or that it's as reported. */
function currentLabel(s: CurrentSummary): string | undefined {
  if (!s.estimatedTo) return undefined;
  return `${s.estimateIsPartial ? "Partly estimated" : "Estimated"} to the ${shortDay(s.estimatedTo)} close`;
}

/** "Oct 30" from YYYY-MM-DD. */
const shortDay = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

type CurrentData = RouterOutputs["investments"]["getCurrentBalances"];
type CurrentBalanceRow = CurrentData["balances"][number];
type FeedMove = CurrentData["movement"]["byFeed"][number];
type CloseMove = CurrentData["movement"]["byClose"][number];

/** Which row a balance falls in, by the chosen rollup. */
function rollupBucket(
  rollup: Rollup,
  accounts: readonly SimplefinAccountListItem[],
  names: ReadonlyMap<number, string>,
): (b: CurrentBalanceRow) => { key: string; label: string } {
  return (b) => {
    const item =
      accounts.find((a) => b.feedIds.includes(a.id)) ??
      accounts.find(
        (a) =>
          b.performanceAccountId !== null &&
          a.linkedPerformanceAccountId === b.performanceAccountId,
      );
    if (b.performanceAccountId === null || !item)
      return { key: "", label: "Not matched" };
    if (rollup === "institution")
      return {
        key: item.orgName || "unknown",
        label: item.orgName || "Unknown",
      };
    if (rollup === "account")
      return {
        key: String(b.performanceAccountId),
        label: names.get(b.performanceAccountId) ?? item.orgName,
      };
    return item.accountType
      ? {
          key: `${item.accountType}::${item.subType ?? ""}`,
          label: getDisplayConfig(item.accountType, item.subType).displayLabel,
        }
      : { key: "", label: "Not matched" };
  };
}

type CurrentGroup = {
  key: string;
  label: string;
  /** Adds up to the card's total. */
  current: number;
  /** Change since the snapshot; null when nothing in it was in one. */
  since: number | null;
  /** Move into each feed's latest close; null with none known. */
  move: number | null;
  /** The closes those moves end at. */
  days: string[];
};

/** The card's figures by row: largest first, "Not matched" last. */
export function groupCurrentBalances(
  balances: readonly CurrentBalanceRow[],
  moves: readonly FeedMove[],
  bucket: (b: CurrentBalanceRow) => { key: string; label: string },
): CurrentGroup[] {
  const groups = new Map<string, CurrentGroup>();
  for (const b of balances) {
    const { key, label } = bucket(b);
    const g = groups.get(key) ?? {
      key,
      label,
      current: 0,
      since: null,
      move: null,
      days: [],
    };
    g.current = roundToCents(g.current + b.current);
    if (!b.noSnapshot)
      g.since = roundToCents((g.since ?? 0) + b.current - b.snapshot);
    for (const m of moves.filter((x) => b.feedIds.includes(x.feedId))) {
      g.move = roundToCents((g.move ?? 0) + m.move);
      if (!g.days.includes(m.day)) g.days = [...g.days, m.day].sort();
    }
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) =>
    a.key === "" ? 1 : b.key === "" ? -1 : b.current - a.current,
  );
}

/** Moves by the market close they end at — not by when Ledgr synced. */
function DailyMovement({
  closes,
  institutionOf,
}: {
  closes: readonly CloseMove[];
  institutionOf: ReadonlyMap<number, string>;
}) {
  return (
    <div className="text-caption text-muted mb-2 space-y-0.5">
      {closes.map((c) => {
        const who = [
          ...new Set(c.feedIds.map((id) => institutionOf.get(id) ?? "")),
        ]
          .filter(Boolean)
          .join(", ");
        const markets =
          c.flows === null ? null : roundToCents(c.move - c.flows);
        return (
          <div key={c.day}>
            <span className="text-primary">{shortDay(c.day)} close</span>{" "}
            <span className={c.move >= 0 ? "text-green-600" : "text-red-600"}>
              {c.move >= 0 ? "+" : "−"}
              {formatCurrency(Math.abs(c.move))}
            </span>
            <span className="text-faint"> · {who}</span>
            <span className="text-faint">
              {c.flows === null
                ? " · may include deposits"
                : c.flows !== 0
                  ? ` · markets ${markets! >= 0 ? "+" : "−"}${formatCurrency(Math.abs(markets!))}, ${c.flows > 0 ? "money in" : "money out"} ${formatCurrency(Math.abs(c.flows))}`
                  : ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function LinkedBalanceCardImpl() {
  const [rollupBy, setRollupBy] = useState<Rollup>("category");
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
  // Transaction-level detail (what you added, recent activity) needs the
  // portfolio permission; everyone else sees the balance-only card.
  const canSeeActivity = hasPermission(useUser(), "portfolio");
  const flowsSince = accounts?.find((a) => a.snapshotDate)?.snapshotDate;
  const { data: flows } = trpc.investments.getSnapshotFlows.useQuery(
    { since: flowsSince ?? "" },
    { enabled: isConnected && canSeeActivity && !!flowsSince },
  );
  const { data: current } = trpc.investments.getCurrentBalances.useQuery(
    undefined,
    { enabled: isConnected },
  );

  if (statusLoading) return <LoadingCard title="Current Balances" />;
  // No SimpleFIN connection configured — omit the card entirely rather
  // than showing an empty/setup-nag widget. Setup lives in Settings.
  if (!isConnected) return null;
  if (historyLoading) return <LoadingCard title="Current Balances" />;
  if (!history || history.length === 0) {
    return (
      <Card title="Current Balances" href="/settings">
        <p className="text-faint text-sm">
          Connected — the first daily balance will appear after the next sync.
        </p>
      </Card>
    );
  }

  const latest = history[history.length - 1];
  if (!latest) return null;

  const balances = current?.balances ?? [];
  const summary = current?.summary;
  const movement = current?.movement;
  const nextRollup = ROLLUPS[(ROLLUPS.indexOf(rollupBy) + 1) % ROLLUPS.length]!;
  const groups = groupCurrentBalances(
    balances,
    movement?.byFeed ?? [],
    rollupBucket(
      rollupBy,
      accounts ?? [],
      new Map((matchableAccounts ?? []).map((m) => [m.id, m.label])),
    ),
  );
  const inSnapshot = balances.filter((b) => !b.noSnapshot);
  const snapshotTotal = roundToCents(
    inSnapshot.reduce((t, b) => t + b.snapshot, 0),
  );
  const since = roundToCents(
    inSnapshot.reduce((t, b) => t + (b.current - b.snapshot), 0),
  );
  const outsideSnapshot = roundToCents(
    balances.filter((b) => b.noSnapshot).reduce((t, b) => t + b.current, 0),
  );
  const allBehind =
    summary !== undefined &&
    summary.comparedCount === 0 &&
    summary.behindCount > 0;
  const snapshotLabel = snapshotDateLabel(accounts);
  const institutionOf = new Map(
    (current?.feeds ?? []).map((f) => [f.id, f.institution]),
  );

  // Coverage against every tracked account (not just the ones already
  // matched): how much of net worth this total represents.
  const totalTracked = matchableAccounts?.length ?? 0;
  const linkedCount = accounts
    ? new Set(
        accounts
          .filter(countsAsFeed)
          .map((a) => a.linkedPerformanceAccountId)
          .filter((id): id is number => id != null),
      ).size
    : 0;

  return (
    <Card
      title={
        <>
          Current Balances
          <HelpTip text="Your latest snapshot plus what has changed since. Each account's figure is the newest Ledgr has: what the institution reported or, when your snapshot is newer, your snapshot — then moved to the latest market close where the holdings can be priced (an estimate; never saved). Moves are dated by the market close the data is from, not by when Ledgr synced." />
        </>
      }
      href="/settings"
    >
      <Metric
        value={formatCurrency(summary?.total ?? latest.totalBalance)}
        label={summary ? currentLabel(summary) : undefined}
      />

      {/* Snapshot → now: the line that ties this to Net Worth. */}
      {inSnapshot.length > 0 && (
        <p className="text-caption text-muted mb-1">
          {snapshotLabel} snapshot {formatCurrency(snapshotTotal)}{" "}
          <span className={since >= 0 ? "text-green-600" : "text-red-600"}>
            {since >= 0 ? "+" : "−"}
            {formatCurrency(Math.abs(since))}
          </span>{" "}
          since
          {outsideSnapshot !== 0 &&
            ` · ${formatCurrency(outsideSnapshot)} not in your snapshot`}
        </p>
      )}

      {/* What you added vs what markets did since the snapshot — only when
          stored transactions reach back to it and every account caught up. */}
      {flows?.covered && summary?.behindCount === 0 && (
        <p className="text-caption text-muted mb-1">
          {flows.added >= 0 ? "You added " : "You took out "}
          {formatCurrency(Math.abs(flows.added))} · markets{" "}
          {since - flows.added >= 0 ? "+" : "−"}
          {formatCurrency(Math.abs(roundToCents(since - flows.added)))}
          {flows.uncertainCount > 0 && (
            <span className="text-faint">
              {" "}
              (estimated — {flows.uncertainCount}{" "}
              {flows.uncertainCount === 1 ? "transaction" : "transactions"}{" "}
              Ledgr wasn&apos;t sure about)
            </span>
          )}
        </p>
      )}

      {allBehind && (
        <p className="text-caption text-muted mb-1">
          Your snapshot is the latest figure for every account. Changes show as
          newer closes arrive.
        </p>
      )}

      {movement && movement.byClose.length > 0 && (
        <DailyMovement
          closes={movement.byClose}
          institutionOf={institutionOf}
        />
      )}

      {canSeeActivity && flows && flows.recent.length > 0 && (
        <div className="mb-2 space-y-0.5">
          {flows.recent.map((r) => (
            <div
              key={r.id}
              className="text-caption text-faint flex justify-between gap-2"
            >
              <span className="truncate">
                {shortDay(r.posted)} · {r.institution} — {r.label}
              </span>
              <span className="shrink-0">{formatCurrency(r.amount)}</span>
            </div>
          ))}
        </div>
      )}

      {totalTracked > 0 && (
        <p className="text-caption text-muted">
          {linkedCount} of {totalTracked} tracked accounts linked via SimpleFIN
        </p>
      )}

      {/* The same figures as the total, by group: each row's balance, its
          change since the snapshot, and its move into its latest close. */}
      {groups.length > 0 && (
        <div className="border-subtle mt-3 space-y-1 border-t pt-3">
          <div className="flex justify-end">
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setRollupBy(nextRollup);
              }}
              className="bg-surface-elevated hover:bg-surface-strong text-muted rounded-full px-2 py-0.5 text-xs transition-colors"
            >
              By {ROLLUP_LABELS[nextRollup]}
            </button>
          </div>
          <div className="text-faint grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-x-1.5 gap-y-1 text-xs">
            <span />
            <span className="text-right">Now</span>
            <span className="text-right">Last close</span>
            {groups.map((g) => (
              <div key={g.key} className="contents">
                <span className="break-words">{g.label}</span>
                <span
                  className="text-right whitespace-nowrap tabular-nums"
                  title={
                    g.since === null
                      ? undefined
                      : `${g.since >= 0 ? "+" : "−"}${formatCurrency(Math.abs(g.since))} since your snapshot`
                  }
                >
                  {formatCurrency(g.current)}
                </span>
                <span
                  className={`text-right whitespace-nowrap tabular-nums ${
                    g.move === null || g.move === 0
                      ? ""
                      : g.move > 0
                        ? "text-green-600"
                        : "text-red-600"
                  }`}
                >
                  {g.move === null
                    ? "—"
                    : `${g.move >= 0 ? "+" : "−"}${formatCurrency(Math.abs(g.move))}`}
                  {g.days.length > 0 && (
                    <span className="text-faint">
                      {" "}
                      {g.days.map(shortDay).join("/")}
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Freshness footer: how current the balances are, by the
          institutions' own dates (not when Ledgr synced). Hover lists each
          institution; amber only when one falls a trading day behind. */}
      <BalanceDatesFooter
        accounts={accounts}
        feeds={current?.feeds}
        accountCount={latest.accountCount}
        lastSyncedAt={status?.lastSyncedAt ?? null}
      />
    </Card>
  );
}

export const LinkedBalanceCard = memo(LinkedBalanceCardImpl);
