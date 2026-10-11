"use client";

/**
 * Settings → General → Data sources: every source behind the sidebar's
 * "Data" indicator, with its rhythm, last update, problems and what was
 * collected. Reads the same status queries the sidebar uses — no polling.
 */
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { useUser, hasPermission } from "@/lib/context/user-context";
import { Card } from "@/components/ui/card";
import {
  budgetApiServiceLabel,
  formatDate,
  formatNumber,
  formatRelativeTime,
} from "@/lib/utils/format";
import { DATA_SOURCES, type DataSourceKey } from "@/lib/config/data-sources";
import { evaluateDataSources } from "@/lib/pure/data-freshness";

export function DataSourcesSettings() {
  const { data: freshness } = trpc.settings.getDataFreshness.useQuery();
  const { data: syncStatus } = trpc.sync.getSyncStatus.useQuery();
  const { data: simplefin } = trpc.simplefin.getStatus.useQuery();
  const { data: secStatus } = trpc.sec.getStatus.useQuery();
  const { data: stats } = trpc.simplefin.getCollectionStats.useQuery(
    undefined,
    { enabled: !!simplefin?.connected },
  );
  const user = useUser();
  const { data: health } = trpc.investments.getHealth.useQuery(undefined, {
    enabled: !!simplefin?.connected && hasPermission(user, "portfolio"),
  });
  if (!freshness) return null;

  const budgetConnected = !!(syncStatus?.service && syncStatus.connected);
  const statuses = new Map(
    evaluateDataSources({
      balance: freshness.balanceDate
        ? { lastUpdated: freshness.balanceDate }
        : undefined,
      performance: freshness.performanceDate
        ? { lastUpdated: freshness.performanceDate }
        : undefined,
      basis: freshness.basisDate
        ? { lastUpdated: freshness.basisDate }
        : undefined,
      budgetApi: budgetConnected
        ? { lastUpdated: syncStatus?.lastSynced?.toString() ?? null }
        : undefined,
      simplefin: simplefin?.connected
        ? {
            lastUpdated: simplefin.lastSyncedAt?.toString() ?? null,
            error: simplefin.lastError,
            warnings: health?.issues.map((i) => i.message),
          }
        : undefined,
      secFacts: secStatus?.connected
        ? { lastUpdated: secStatus.lastRun, error: secStatus.lastError }
        : undefined,
    }).map((s) => [s.source.key, s]),
  );

  const details: Partial<Record<DataSourceKey, React.ReactNode>> = {
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
        {health && health.needsReview > 0 && (
          <span className="block">
            {health.needsReview} investment{" "}
            {health.needsReview === 1 ? "row needs" : "rows need"} review in
            Settings → Integrations → SimpleFIN.
          </span>
        )}
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
                {status?.lastUpdated && (
                  <>
                    {" "}
                    · last updated{" "}
                    {source.mode === "automatic"
                      ? formatRelativeTime(status.lastUpdated)
                      : formatDate(status.lastUpdated, "medium")}
                  </>
                )}
                {" · "}
                <Link
                  href={source.href}
                  className="hover:text-primary underline"
                >
                  {source.mode === "manual" ? "Update" : "Settings"}
                </Link>
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
