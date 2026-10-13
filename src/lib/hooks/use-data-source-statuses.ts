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

export function useDataSourceStatuses() {
  const { data } = trpc.settings.getDataFreshness.useQuery();
  const { data: syncStatus } = trpc.sync.getSyncStatus.useQuery();
  const { data: simplefinStatus } = trpc.simplefin.getStatus.useQuery();
  const { data: secStatus } = trpc.sec.getStatus.useQuery();
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
          ? { lastUpdated: syncStatus?.lastSynced?.toString() ?? null }
          : undefined,
        simplefin: simplefinCanSync
          ? {
              lastUpdated: simplefinStatus?.lastSyncedAt?.toString() ?? null,
              error: simplefinStatus?.lastError ?? null,
              warnings: investmentHealth?.issues.map((i) => i.message),
            }
          : undefined,
        secFacts: secStatus?.connected
          ? { lastUpdated: secStatus.lastRun, error: secStatus.lastError }
          : undefined,
      })
    : [];
  return {
    loaded: Boolean(data),
    statuses,
    syncStatus,
    simplefinStatus,
    investmentHealth,
    budgetApiCanSync,
    simplefinCanSync,
  };
}
