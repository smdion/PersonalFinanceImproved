"use client";

/**
 * Settings → General → Data sources: every source behind the sidebar's
 * "Data" indicator, with its rhythm, last update, problems and what was
 * collected. The statuses come from the sidebar's own hook
 * (useDataSourceStatuses), so the two always agree — no polling.
 */
import { FocusLink } from "@/components/ui/focus-link";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import {
  budgetApiServiceLabel,
  formatDate,
  formatNumber,
  formatRelativeTime,
} from "@/lib/utils/format";
import { DATA_SOURCES, type DataSourceKey } from "@/lib/config/data-sources";
import { useDataSourceStatuses } from "@/lib/hooks/use-data-source-statuses";

export function DataSourcesSettings() {
  // The statuses are the sidebar indicator's own (one judgement, every
  // source — tax data included); the queries below only add detail lines.
  const {
    loaded,
    statuses: list,
    syncStatus,
    simplefinStatus: simplefin,
    investmentHealth: health,
    budgetApiCanSync: budgetConnected,
  } = useDataSourceStatuses();
  const { data: secStatus } = trpc.sec.getStatus.useQuery();
  const { data: taxData } = trpc.settings.taxData.status.useQuery();
  const { data: stats } = trpc.simplefin.getCollectionStats.useQuery(
    undefined,
    { enabled: !!simplefin?.connected },
  );
  if (!loaded) return null;
  const statuses = new Map(list.map((s) => [s.source.key, s]));

  // Tax data: the years it covers and when the next year is due.
  const taxYears = (taxData?.sections ?? [])
    .map((s) => s.newestYear)
    .filter((y): y is number => y !== null);
  const nextDue = (taxData?.sections ?? [])
    .flatMap((s) => (s.upcoming ? [s.upcoming] : []))
    .sort((a, b) => a.due.localeCompare(b.due))[0];
  const details: Partial<Record<DataSourceKey, React.ReactNode>> = {
    taxData: taxYears.length > 0 && (
      <>
        Tax years through {Math.min(...taxYears)}.
        {nextDue &&
          ` ${nextDue.year} figures due by ${formatDate(nextDue.due, "medium")}.`}
      </>
    ),
    secFacts: secStatus?.connected && (
      <>
        Expense ratios and holdings from SEC filings for{" "}
        {secStatus.fundsWithFacts} funds.
        {secStatus.standInsToConfirm > 0 &&
          ` ${secStatus.standInsToConfirm} suggested stand-in${secStatus.standInsToConfirm === 1 ? "" : "s"} to confirm on Benchmarks.`}
        {secStatus.lastError && (
          <span className="block text-amber-600">{secStatus.lastError}</span>
        )}
      </>
    ),
    budgetApi: budgetConnected && syncStatus && (
      <>
        {budgetApiServiceLabel(syncStatus.service)} ·{" "}
        {syncStatus.autoSync.enabled
          ? `syncs when you open Ledgr and data is over ${syncStatus.autoSync.staleHours} h old`
          : "automatic sync is off — sync from the sidebar"}
      </>
    ),
    simplefin: simplefin?.connected && (
      <>
        Checks hourly, syncs once a day.
        {stats && (
          <>
            {" "}
            Collected {formatNumber(stats.holdings)} holdings
            {stats.holdingsAsOf &&
              ` (as of ${formatDate(stats.holdingsAsOf, "medium")})`}{" "}
            and {formatNumber(stats.transactions)} transactions across{" "}
            {stats.transactionAccounts} accounts
            {stats.oldestTransaction &&
              ` since ${formatDate(stats.oldestTransaction, "medium")}`}
            . Requests in the last 24 h: {stats.requestsLastDay} of{" "}
            {stats.dailyRequestLimit}.
            {stats.dataAsOf.length > 0 && (
              <span className="block">
                Data as of:{" "}
                {stats.dataAsOf
                  .map(
                    (d) =>
                      `${d.institution} ${formatDate(d.asOf, "medium").replace(`, ${new Date().getFullYear()}`, "")}`,
                  )
                  .join(" · ")}
              </span>
            )}
          </>
        )}
        {simplefin.lastError && (
          <span className="block text-amber-600">{simplefin.lastError}</span>
        )}
        {health?.issues.map((i) => (
          <span key={i.message} className="block text-amber-600">
            {i.message}
          </span>
        ))}
      </>
    ),
  };

  return (
    <Card title="Data sources">
      <p className="text-muted mb-3 text-xs">
        Where Ledgr&apos;s data comes from. A source needs attention only when
        it&apos;s late for its own rhythm or its last sync failed.
      </p>
      <div className="divide-subtle divide-y">
        {DATA_SOURCES.map((source) => {
          const status = statuses.get(source.key);
          const label =
            source.key === "budgetApi"
              ? `Budget (${budgetApiServiceLabel(syncStatus?.service)})`
              : source.label;
          return (
            <div key={source.key} className="py-2 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-primary font-medium">{label}</span>
                <span
                  className={`text-xs ${
                    !status
                      ? "text-faint"
                      : status.needsAttention
                        ? "text-amber-600"
                        : "text-green-600"
                  }`}
                >
                  {!status
                    ? source.mode === "automatic"
                      ? "Not connected"
                      : "Not entered yet"
                    : status.needsAttention
                      ? `Needs attention — ${status.reason}`
                      : "Current"}
                </span>
              </div>
              <div className="text-caption text-faint">
                {source.mode === "manual" ? "Entered by you" : "Automatic"} ·{" "}
                {source.rhythmLabel}
                {status?.lastUpdated && source.showsLastUpdated !== false && (
                  <>
                    {" "}
                    · last updated{" "}
                    {source.mode === "automatic"
                      ? formatRelativeTime(status.lastUpdated)
                      : formatDate(status.lastUpdated, "medium")}
                  </>
                )}
                {" · "}
                <FocusLink
                  focus={source.focus}
                  className="hover:text-primary underline"
                >
                  {source.mode === "manual" ? "Update" : "Settings"}
                </FocusLink>
              </div>
              {details[source.key] && (
                <div className="text-caption text-muted mt-0.5">
                  {details[source.key]}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
