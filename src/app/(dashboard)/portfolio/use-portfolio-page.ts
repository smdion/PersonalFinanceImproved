import { useState, useCallback, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useUser, hasPermission } from "@/lib/context/user-context";
import { useFocusReveal } from "@/lib/hooks/use-focus";
import { EDIT_LOCK_KEYS, useEditLock } from "@/components/ui/edit-lock-toggle";
import { useYearEndTargetingInput } from "@/lib/hooks/use-year-end-targeting";
import { usePortfolioSnapshotMutations } from "@/components/portfolio/use-portfolio-snapshot-mutations";
import { usePortfolioSync } from "./use-portfolio-sync";

export function usePortfolioPage() {
  const user = useUser();
  const canEdit = hasPermission(user, "portfolio");
  const targeting = useYearEndTargetingInput();
  const summary = trpc.networth.computeSummary.useQuery(targeting);
  const { data } = summary;
  const [snapshotPage, setSnapshotPage] = useState(1);
  const [snapshotDateFrom, setSnapshotDateFrom] = useState("");
  const [snapshotDateTo, setSnapshotDateTo] = useState("");
  const [showNewSnapshot, setShowNewSnapshot] = useState(false);
  const [expandedSnapshot, setExpandedSnapshot] = useState<number | null>(null);
  // One padlock for the whole "fix a wrong balance in the latest snapshot"
  // panel — locked by default, same pattern as the Budget/Performance
  // editable surfaces. Replaces a per-value pencil affordance.
  const [snapshotEditLocked, toggleSnapshotEditLock] = useEditLock(
    EDIT_LOCK_KEYS.portfolioSnapshotEditLocked,
  );
  const [showHistory, setShowHistory] = useState(false);
  // Holding history is collapsed like the other sections, and opens when
  // a link lands on it (Benchmarks → "Your mix, in index funds").
  const [showHoldings, setShowHoldings] = useFocusReveal("holdingHistory");
  const [showChart, setShowChart] = useState(false);
  const [showQuickLook, setShowQuickLook] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [sortCol, setSortCol] = useState<
    "date" | "total" | "accounts" | "change" | "changePct" | null
  >(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const snapshotPageSize = showAll ? 1000 : 52;
  // Dashed live line after the latest snapshot — hidden (no error) without
  // the portfolio permission it needs.
  const { data: liveSinceSnapshot } =
    trpc.investments.getLiveSinceSnapshot.useQuery(undefined, {
      retry: false,
    });
  const { data: snapshotTotals } = trpc.networth.listSnapshotTotals.useQuery(
    undefined,
    {
      enabled: showChart || showQuickLook,
    },
  );
  const { data: paginatedSnapshots } = trpc.networth.listSnapshots.useQuery({
    page: showAll ? 1 : snapshotPage,
    pageSize: snapshotPageSize,
    dateFrom: snapshotDateFrom || undefined,
    dateTo: snapshotDateTo || undefined,
    sortCol: sortCol ?? undefined,
    sortDir: sortDir,
  });
  const {
    deleteSnapshot,
    resyncPush,
    updateAccountBalance,
    invalidateSnapshotQueries,
  } = usePortfolioSnapshotMutations();

  const {
    budgetApiConnected,
    syncServiceLabel,
    clearSyncPending,
    syncPending,
    handleBalanceEdit,
    syncPendingSnapshot,
  } = usePortfolioSync(updateAccountBalance, resyncPush);

  const snapshotDate = data?.snapshotDate;

  // Memoize snapshot delta computation and sorting — must be before early returns
  const toggleSort = useCallback(
    (col: "date" | "total" | "accounts" | "change" | "changePct") => {
      if (sortCol === col) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortCol(col);
        setSortDir(col === "date" ? "asc" : "desc");
      }
    },
    [sortCol],
  );

  // Server computes delta/deltaPct and handles sorting — client just reads the result
  const rawSnapshots = useMemo(
    () => paginatedSnapshots?.snapshots ?? [],
    [paginatedSnapshots?.snapshots],
  );

  const sortOf = (col: NonNullable<typeof sortCol>) =>
    sortCol !== col ? "none" : sortDir === "asc" ? "ascending" : "descending";

  return {
    user,
    canEdit,
    summary,
    data,
    snapshotPage,
    setSnapshotPage,
    snapshotDateFrom,
    setSnapshotDateFrom,
    snapshotDateTo,
    setSnapshotDateTo,
    showNewSnapshot,
    setShowNewSnapshot,
    expandedSnapshot,
    setExpandedSnapshot,
    snapshotEditLocked,
    toggleSnapshotEditLock,
    showHistory,
    setShowHistory,
    showHoldings,
    setShowHoldings,
    showChart,
    setShowChart,
    showQuickLook,
    setShowQuickLook,
    showAll,
    setShowAll,
    liveSinceSnapshot,
    snapshotTotals,
    paginatedSnapshots,
    deleteSnapshot,
    resyncPush,
    invalidateSnapshotQueries,
    budgetApiConnected,
    syncServiceLabel,
    clearSyncPending,
    syncPending,
    handleBalanceEdit,
    syncPendingSnapshot,
    snapshotDate,
    toggleSort,
    rawSnapshots,
    sortOf,
  };
}
