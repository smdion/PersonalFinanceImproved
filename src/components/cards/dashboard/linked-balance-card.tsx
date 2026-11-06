"use client";

import { countsAsFeed } from "@/lib/pure/sync/simplefin-feeds";
import React, { memo, useState } from "react";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { Card, Metric } from "@/components/ui/card";
import { HelpTip } from "@/components/ui/help-tip";
import { Tooltip } from "@/components/ui/tooltip";
import { useUser, hasPermission } from "@/lib/context/user-context";
import { formatCurrency } from "@/lib/utils/format";
import { roundToCents } from "@/lib/utils/math";
import {
  balanceOnlyLine,
  groupCurrentBalances,
  noHoldingsNote,
  type CurrentGroup,
} from "@/lib/pure/accounts/current-balance-groups";
import { getDisplayConfig } from "@/lib/config/account-types";
import type { AccountCategory } from "@/lib/config/account-types";
import type { PortfolioTaxType } from "@/lib/config/enum-values";
import { previousTradingDay } from "@/lib/pure/investments/market-calendar";
import {
  gapLines,
  missingNote,
  missingReason,
  shortDay,
} from "@/lib/pure/net-worth/close-notes";
import { LoadingCard } from "./utils";

/** How the breakdown groups balances; the button steps through them in order. */
type Rollup = "category" | "institution" | "account";
const ROLLUPS: readonly Rollup[] = ["category", "institution", "account"];
const ROLLUP_LABELS: Record<Rollup, string> = {
  category: "category",
  institution: "institution",
  account: "account",
};

// Only the latest day: the fallback total and the "first sync" state.
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

/** The session a move covers, close to close: "Oct 29→30", "Oct 30→Nov 2". */
const sessionLabel = (day: string) => {
  const from = previousTradingDay(day);
  return from.slice(0, 7) === day.slice(0, 7)
    ? `${shortDay(from)}→${Number(day.slice(8))}`
    : `${shortDay(from)}→${shortDay(day)}`;
};

/** One short figure: money paid in or out, "~" while some of it is only
 *  seen in balances (institutions send transactions days late). */
function paidLine(c: {
  flows: number | null;
  unreported: { amount: number } | null;
}): string | null {
  const total = (c.flows ?? 0) + (c.unreported?.amount ?? 0);
  if (Math.abs(total) < 0.005) return null;
  return `${c.unreported ? "~" : ""}${total > 0 ? "+" : "−"}${formatCurrency(Math.abs(total), 0)} paid ${total > 0 ? "in" : "out"}`;
}

function unreportedDetail(c: {
  flows: number | null;
  unreported: { amount: number; names: string[] } | null;
}): string | null {
  if (!c.unreported) return null;
  const sign = (n: number) =>
    `${n >= 0 ? "+" : "−"}${formatCurrency(Math.abs(n), 0)}`;
  return `${c.flows ? `${sign(c.flows)} reported; ` : ""}about ${sign(c.unreported.amount)} at ${c.unreported.names.join(", ")} not reported yet: institutions send transactions days late, so it's read from balances less the market's move.`;
}

/** Where the total's figures come from: the snapshot, the institutions'
 *  newer reports, or both. */
function sourceLine(
  balances: readonly { source: "snapshot" | "reported" }[],
  snapshotDay: string,
): string {
  const snapshot = balances.some((b) => b.source === "snapshot");
  const reported = balances.some((b) => b.source === "reported");
  if (!reported) return `From your ${snapshotDay} snapshot,`;
  if (!snapshot) return "From institution reports,";
  return `From your ${snapshotDay} snapshot and newer reports,`;
}

/** "+$1,234.56" / "−$1,234.56". */
const signed = (n: number) =>
  `${n >= 0 ? "+" : "−"}${formatCurrency(Math.abs(n))}`;
const moveColor = (n: number | null) =>
  n === null || n === 0 ? "" : n > 0 ? "text-green-600" : "text-red-600";

type CurrentData = RouterOutputs["investments"]["getCurrentBalances"];
type CurrentFeed = CurrentData["feeds"][number];
type CurrentBalanceRow = CurrentData["balances"][number];

const BASIS_TEXT: Record<CurrentFeed["basis"], string> = {
  proven: "close",
  learned: "close (est.)",
  assumed: "close (assumed)",
  reported: "",
};

/** Hover detail, one line per feed: the close its data is from, then when
 *  it was reported. */
function feedDateLine(f: CurrentFeed): string {
  const reported = f.timeKnown
    ? `reported ${reportTime(f.reportedAt)}`
    : `no time reported; last seen ${reportTime(f.reportedAt)}`;
  const used = f.behindSnapshot ? " — your snapshot is newer" : "";
  if (f.basis === "reported") return `${f.institution} — ${reported}${used}`;
  return `${f.institution} — ${shortDay(f.dataDay)} ${BASIS_TEXT[f.basis]}, ${reported}${used}`;
}

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

/** Each close's market move, latest first, then each account's move over
 *  closes it sent no report for. */
function DailyChanges({
  movement,
  target,
  reports,
  unpriced,
}: {
  movement: CurrentData["movement"];
  target: string | undefined;
  reports: CurrentData["closeReports"];
  unpriced: CurrentData["unpricedMoves"];
}) {
  if (movement.length === 0) return null;
  return (
    <>
      <p className="text-caption text-faint">
        Daily change by market close (not sync date)
      </p>
      <div className="text-caption mb-2 grid grid-cols-[auto_auto_minmax(0,1fr)] gap-x-2">
        {movement.map((c) => (
          <div key={c.day} className="contents">
            <span className="text-muted">{sessionLabel(c.day)}</span>
            <span
              className={`text-right tabular-nums ${c.known === 0 ? "text-faint" : moveColor(c.move)}`}
            >
              {c.known === 0 ? "—" : signed(c.move)}
            </span>
            <span
              className="text-faint break-words"
              title={[
                missingReason(c, target, reports, unpriced),
                unreportedDetail(c),
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {[missingNote(c, target, reports, unpriced), paidLine(c)]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>
        ))}
      </div>
      {gapLines(reports).length > 0 && (
        <div className="text-caption text-faint mb-2">
          {gapLines(reports).map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      )}
    </>
  );
}

/** The total by group: each row's balance and its move into the card's
 *  close; a row with no holdings also shows its balance's change. */
function GroupRows({
  groups,
  target,
}: {
  groups: readonly CurrentGroup[];
  target: string | undefined;
}) {
  return groups.map((g) => (
    <div key={g.key} className="contents">
      <span className="break-words">{g.label}</span>
      <span className="text-right whitespace-nowrap tabular-nums">
        {formatCurrency(g.current)}
      </span>
      <span
        className={`text-right whitespace-nowrap tabular-nums ${moveColor(g.move)}`}
        title={
          g.noHoldings
            ? noHoldingsNote(g.noHoldings.institutions)
            : g.move === null && target
              ? `Waiting for a fund's ${shortDay(target)} price from the institution`
              : undefined
        }
      >
        {g.move === null ? "—" : signed(g.move)}
      </span>
      {g.noHoldings && (
        <span className="col-span-3 text-right">
          {balanceOnlyLine(g.noHoldings.balance)}
        </span>
      )}
    </div>
  ));
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
  // What was paid in since the snapshot needs the portfolio permission.
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
  const target = current?.target;
  const nextRollup = ROLLUPS[(ROLLUPS.indexOf(rollupBy) + 1) % ROLLUPS.length]!;
  const groups = groupCurrentBalances(
    balances,
    rollupBucket(
      rollupBy,
      accounts ?? [],
      new Map((matchableAccounts ?? []).map((m) => [m.id, m.label])),
    ),
  );
  const inSnapshot = balances.filter((b) => !b.noSnapshot);
  const since = roundToCents(
    inSnapshot.reduce((t, b) => t + (b.current - b.snapshot), 0),
  );
  const snapshotDate = current?.snapshotDate;

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
  const feedLines = [...new Set((current?.feeds ?? []).map(feedDateLine))];

  return (
    <Card
      title={
        <>
          Current Balances
          <HelpTip text="Each account at the latest market close: your snapshot, or an institution's report once it's from a later close, moved forward by each fund's own price where needed (an estimate; never saved). Daily moves are what each close's prices did to your funds — dated by the market close, not by when Ledgr synced — with money paid in or out shown beside them." />
        </>
      }
      href="/settings"
    >
      <Metric
        value={formatCurrency(summary?.total ?? latest.totalBalance)}
        label={
          target
            ? `At the ${shortDay(target)} close${summary?.estimatedTo ? " (est.)" : ""}`
            : undefined
        }
      />

      {/* Where the total comes from, and the change since the snapshot
          (ties this to Net Worth). */}
      {inSnapshot.length > 0 && snapshotDate && (
        <p className="text-caption text-muted mb-2">
          {sourceLine(inSnapshot, shortDay(snapshotDate))}{" "}
          <span className={moveColor(since)}>{signed(since)}</span>{" "}
          {inSnapshot.every((b) => b.source === "snapshot")
            ? "since"
            : `since your ${shortDay(snapshotDate)} snapshot`}
          {flows?.covered && flows.added !== 0 && (
            <span className="text-faint">
              {" "}
              ({flows.added > 0 ? "you added" : "you took out"}{" "}
              {formatCurrency(Math.abs(flows.added))})
            </span>
          )}
        </p>
      )}

      {current && (
        <DailyChanges
          movement={current.movement}
          target={target}
          reports={current.closeReports}
          unpriced={current.unpricedMoves}
        />
      )}

      {/* The total by group: each row's balance and its move into the
          card's close. */}
      {groups.length > 0 && (
        <div className="border-subtle mt-2 border-t pt-2">
          <div className="text-faint grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-1.5 gap-y-1 text-xs">
            {/* The rollup switch sits in the header row's free cell. */}
            <span>
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
            </span>
            <span className="text-right">Now</span>
            <span className="text-right">
              {target ? sessionLabel(target) : ""}
            </span>
            <GroupRows groups={groups} target={target} />
          </div>
        </div>
      )}

      {/* Where each figure comes from, on hover. */}
      <Tooltip
        side="top"
        lines={["Each institution's latest data:", ...feedLines]}
      >
        <p className="text-caption text-faint mt-1 w-fit cursor-help underline decoration-dotted underline-offset-2">
          {totalTracked > 0
            ? `${linkedCount} of ${totalTracked} tracked accounts linked`
            : `${latest.accountCount} accounts`}
        </p>
      </Tooltip>
    </Card>
  );
}

export const LinkedBalanceCard = memo(LinkedBalanceCardImpl);
