import { SinceSnapshotBanner } from "@/components/portfolio/account-live-data";
import { type SetStateAction, type Dispatch } from "react";
import { SkeletonChart } from "@/components/ui/skeleton";
import { type RouterOutputs } from "@/lib/trpc";
import dynamic from "next/dynamic";
import { CardBoundary } from "@/components/dashboard/utils";
import { NewSnapshotForm } from "@/components/portfolio/new-snapshot-form";
import { SlidePanel } from "@/components/ui/slide-panel";
import { AccountBalanceOverview } from "@/components/portfolio/account-balance-overview";
import { PortfolioQuickLook } from "@/components/portfolio/portfolio-quick-look";

// Code-split Recharts. PortfolioChart pulls in
// ~250KB of recharts code; lazy-loading moves it to a dedicated chunk.
const PortfolioChart = dynamic(
  () =>
    import("@/components/portfolio/portfolio-chart").then((m) => ({
      default: m.PortfolioChart,
    })),
  { loading: () => <SkeletonChart />, ssr: false },
);

export type PortfolioPanelsProps = {
  canEdit: boolean;
  invalidateSnapshotQueries: () => void;
  liveSinceSnapshot:
    RouterOutputs["investments"]["getLiveSinceSnapshot"] | undefined;
  setShowNewSnapshot: Dispatch<SetStateAction<boolean>>;
  showChart: boolean;
  showNewSnapshot: boolean;
  showQuickLook: boolean;
  snapshotTotals: RouterOutputs["netWorth"]["listSnapshotTotals"] | undefined;
};

export function PortfolioPanels({
  canEdit,
  invalidateSnapshotQueries,
  liveSinceSnapshot,
  setShowNewSnapshot,
  showChart,
  showNewSnapshot,
  showQuickLook,
  snapshotTotals,
}: PortfolioPanelsProps) {
  return (
    <>
      {/* Change since the latest snapshot: added vs markets */}
      <SinceSnapshotBanner />

      {/* Quick Look Stats Panel */}
      {showQuickLook && snapshotTotals && snapshotTotals.length >= 2 && (
        <PortfolioQuickLook snapshots={snapshotTotals} />
      )}

      {/* New Snapshot Form */}
      {canEdit && (
        <SlidePanel
          isOpen={showNewSnapshot}
          onClose={() => setShowNewSnapshot(false)}
          title="New Snapshot"
        >
          <NewSnapshotForm
            onClose={() => setShowNewSnapshot(false)}
            onSaved={() => {
              setShowNewSnapshot(false);
              invalidateSnapshotQueries();
            }}
          />
        </SlidePanel>
      )}

      {/* Portfolio value chart */}
      {showChart && snapshotTotals && snapshotTotals.length > 0 && (
        <CardBoundary title="Portfolio Chart">
          <PortfolioChart
            snapshots={snapshotTotals}
            live={liveSinceSnapshot?.points}
          />
        </CardBoundary>
      )}

      {/* Lightweight account balance overview */}
      <CardBoundary title="Account Balances">
        <AccountBalanceOverview />
      </CardBoundary>
    </>
  );
}
