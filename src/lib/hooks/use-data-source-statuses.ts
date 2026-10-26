"use client";

/**
 * Each data source's freshness — the sidebar "Data" indicator and the
 * Recommendations page's "Keep data current" read this, so they agree.
 * Reads only: syncing (and the sidebar's auto-sync) stays with the sidebar.
 */
import { trpc } from "@/lib/trpc";
import { useUser, hasPermission } from "@/lib/context/user-context";
import {
  evaluateDataSources,
  type DataSourceStatus,
} from "@/lib/pure/data-freshness";
import { localDateStr } from "@/lib/utils/date";

/** A sync time as ISO text — tRPC sends Dates as strings at runtime even
 *  where the type says Date, and Date#toString() isn't ISO. */
function toIso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function useDataSourceStatuses() {
  const freshness = trpc.settings.getDataFreshness.useQuery();
  const { data } = freshness;
  const { data: syncStatus } = trpc.sync.getSyncStatus.useQuery();
  const { data: simplefinStatus } = trpc.simplefin.getStatus.useQuery();
  const { data: secStatus } = trpc.sec.getStatus.useQuery();
  const { data: taxDataStatus } = trpc.settings.taxData.status.useQuery();
  const user = useUser();
  // Holdings checks name accounts and values: portfolio permission only.
  const { data: investmentHealth } = trpc.investments.getHealth.useQuery(
    undefined,
    {
      enabled: !!simplefinStatus?.connected && hasPermission(user, "portfolio"),
    },
  );
  const budgetApiCanSync = !!(syncStatus?.service && syncStatus.connected);
  const simplefinCanSync = !!simplefinStatus?.connected;
  const statuses: DataSourceStatus[] = data
    ? evaluateDataSources({
        balance: data.balanceDate
          ? { lastUpdated: data.balanceDate }
          : undefined,
        performance: data.performanceDate
          ? { lastUpdated: data.performanceDate }
          : undefined,
        basis: data.basisDate ? { lastUpdated: data.basisDate } : undefined,
        budgetApi: budgetApiCanSync
          ? { lastUpdated: toIso(syncStatus?.lastSynced) }
          : undefined,
        simplefin: simplefinCanSync
          ? {
              lastUpdated: toIso(simplefinStatus?.lastSyncedAt),
              error: simplefinStatus?.lastError ?? null,
              warnings: investmentHealth?.issues.map((i) => i.message),
            }
          : undefined,
        secFacts: secStatus?.connected
          ? { lastUpdated: secStatus.lastRun, error: secStatus.lastError }
          : undefined,
        // Current = checked now; late years or carried figures = warnings.
        taxData: taxDataStatus
          ? {
              lastUpdated: localDateStr(),
              warnings: taxDataStatus.summary ? [taxDataStatus.summary] : [],
            }
          : undefined,
      })
    : [];
  return {
    // Settled (loaded or failed) — a failing check must not hold a page
    // in its loading state.
    loaded: !freshness.isLoading,
    statuses,
    syncStatus,
    simplefinStatus,
    investmentHealth,
    budgetApiCanSync,
    simplefinCanSync,
  };
}
