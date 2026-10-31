"use client";

import { countsAsFeed } from "@/lib/pure/simplefin-feeds";
import React, { memo, useState } from "react";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { Card, Metric } from "@/components/ui/card";
import { HelpTip } from "@/components/ui/help-tip";
import { Tooltip } from "@/components/ui/tooltip";
import { useUser, hasPermission } from "@/lib/context/user-context";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { planExpectedNow, yearFraction } from "@/lib/pure/plan-pace";
import { useDashboardProjection } from "@/lib/hooks/use-dashboard-projection";
import { roundToCents } from "@/lib/utils/math";
import { getDisplayConfig } from "@/lib/config/account-types";
import type { AccountCategory } from "@/lib/config/account-types.types";
import type { PortfolioTaxType } from "@/lib/config/enum-values";
import { previousTradingDay } from "@/lib/pure/market-calendar";
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

/** "Oct 30" from YYYY-MM-DD. */
const shortDay = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

/** The session a move covers, close to close: "Oct 29→30", "Oct 30→Nov 2". */
const sessionLabel = (day: string) => {
  const from = previousTradingDay(day);
  return from.slice(0, 7) === day.slice(0, 7)
    ? `${shortDay(from)}→${Number(day.slice(8))}`
    : `${shortDay(from)}→${shortDay(day)}`;
};

/** "Fidelity", "Fidelity and Voya", "Fidelity, Voya and Vanguard". */
const listNames = (names: readonly string[]) =>
  names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

/** "Fidelity" from "Fidelity Investments": notes stay on one line; the
 *  full name is in the hover text. */
const shortName = (name: string) => name.split(/\s+/)[0] ?? name;

/** The note beside a close with accounts missing. */
function missingNote(
  c: { day: string; missing: readonly string[] },
  target: string | undefined,
): string | null {
  if (c.missing.length === 0) return null;
  const who = listNames([...new Set(c.missing.map(shortName))]);
  return c.day === target
    ? `${who} ${c.missing.length === 1 ? "change" : "changes"} not in yet`
    : `excludes ${who}`;
}

/** Hover text for a close with accounts missing. */
function missingReason(
  c: { day: string; missing: readonly string[] },
  target: string | undefined,
): string | undefined {
  if (c.missing.length === 0) return undefined;
  const who = listNames(c.missing);
  const one = c.missing.length === 1;
  return c.day === target
    ? `${who}'s ${shortDay(c.day)} ${one ? "balance is" : "balances are"} in; the change needs ${one ? "its" : "their"} ${shortDay(c.day)} fund prices, which arrive with the next sync. This total leaves ${one ? "it" : "them"} out until then.`
    : `${who} didn't report a price for ${shortDay(c.day)}, so ${one ? "its" : "their"} change isn't in this total.`;
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

/** Where the plan expected the money by the card's close. */
function paceOf(a: {
  balance: number;
  fromYear: number;
  year: number;
  target: string;
  rate: number;
  contributions: number;
  actual: number;
}) {
  const expected = planExpectedNow({
    yearStartBalance: a.balance,
    annualRate: a.rate,
    yearContributions: a.contributions,
    fraction: yearFraction(a.target, a.year),
  });
  return { ...a, expected, gap: a.actual - expected };
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

type CurrentGroup = {
  key: string;
  label: string;
  /** Adds up to the card's total. */
  current: number;
  /** Move into the card's close; null when any fund in it can't be told
   *  (a partial sum would read as the whole). */
  move: number | null;
};

/** The card's figures by row: largest first, "Not matched" last. */
export function groupCurrentBalances(
  balances: readonly CurrentBalanceRow[],
  bucket: (b: CurrentBalanceRow) => { key: string; label: string },
): CurrentGroup[] {
  const groups = new Map<string, CurrentGroup & { unknown: boolean }>();
  for (const b of balances) {
    const { key, label } = bucket(b);
    const g = groups.get(key) ?? {
      key,
      label,
      current: 0,
      move: 0,
      unknown: false,
    };
    g.current = roundToCents(g.current + b.current);
    if (b.market && b.move !== null)
      g.move = roundToCents((g.move ?? 0) + b.move);
    else if (b.market) g.unknown = true;
    groups.set(key, g);
  }
  return [...groups.values()]
    .map(({ unknown, ...g }) => ({ ...g, move: unknown ? null : g.move }))
    .sort((a, b) =>
      a.key === "" ? 1 : b.key === "" ? -1 : b.current - a.current,
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
  const planYears =
    useDashboardProjection().data?.result?.projectionByYear ?? undefined;

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
  // Only while the plan's first year is the year after the finalized one
  // and it's still saving: otherwise the two don't line up.
  const planYear = planYears?.[0];
  const pace =
    summary &&
    target &&
    current?.lastFinalized &&
    planYear?.phase === "accumulation" &&
    planYear.year === current.lastFinalized.year + 1
      ? paceOf({
          balance: current.lastFinalized.balance,
          fromYear: current.lastFinalized.year,
          year: planYear.year,
          target,
          rate: planYear.annualizedReturnRate,
          contributions:
            (planYear.totalEmployee + planYear.totalEmployer) /
            (planYear.proRateFraction || 1),
          actual: summary.total,
        })
      : null;

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

      {/* Actual vs the plan, from a starting point it can't move. */}
      {pace && (
        <p
          className="text-caption text-muted -mt-1 mb-2"
          title={`Your ${pace.fromYear} ending balance grown at the plan's ${formatPercent(pace.rate, 1)} for the part of this year gone by, plus the ${formatCurrency(pace.contributions)} a year it plans to contribute. Your own contributions and returns may differ.`}
        >
          The plan expected {formatCurrency(pace.expected, 0)} by now ·{" "}
          <span className={moveColor(pace.gap)}>
            {formatCurrency(Math.abs(pace.gap), 0)}{" "}
            {pace.gap >= 0 ? "ahead" : "behind"}
          </span>
        </p>
      )}

      {/* Each close's market move, latest first. */}
      {current && current.movement.length > 0 && (
        <p className="text-caption text-faint">
          Daily change by market close (not sync date)
        </p>
      )}
      {current && current.movement.length > 0 && (
        <div className="text-caption mb-2 grid grid-cols-[auto_auto_minmax(0,1fr)] gap-x-2">
          {current.movement.map((c) => (
            <div key={c.day} className="contents">
              <span className="text-muted">{sessionLabel(c.day)}</span>
              <span
                className={`text-right tabular-nums ${c.known === 0 ? "text-faint" : moveColor(c.move)}`}
              >
                {c.known === 0 ? "—" : signed(c.move)}
              </span>
              <span
                className="text-faint break-words"
                title={missingReason(c, target)}
              >
                {[
                  missingNote(c, target),
                  c.flows
                    ? `${c.flows > 0 ? "+" : "−"}${formatCurrency(Math.abs(c.flows))} paid ${c.flows > 0 ? "in" : "out"}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </div>
          ))}
        </div>
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
            {groups.map((g) => (
              <div key={g.key} className="contents">
                <span className="break-words">{g.label}</span>
                <span className="text-right whitespace-nowrap tabular-nums">
                  {formatCurrency(g.current)}
                </span>
                <span
                  className={`text-right whitespace-nowrap tabular-nums ${moveColor(g.move)}`}
                  title={
                    g.move === null && target
                      ? `Waiting for a fund's ${shortDay(target)} price from the institution`
                      : undefined
                  }
                >
                  {g.move === null ? "—" : signed(g.move)}
                </span>
              </div>
            ))}
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
